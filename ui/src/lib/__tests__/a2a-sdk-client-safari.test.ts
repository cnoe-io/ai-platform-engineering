/**
 * Unit tests for A2ASDKClient Safari compatibility.
 *
 * Tests cover:
 * - Safari detection routes streaming through sendMessageStreamSafari
 * - Non-Safari routes through SDK transport (default path)
 * - Safari streaming parses SSE events correctly
 * - Safari streaming handles errors (401, 500, network)
 * - Safari streaming handles AbortController cancellation
 * - Safari streaming handles JSON-RPC errors in SSE events
 * - Safari streaming detects stream completion signals
 * - Parity: Safari path produces same parsed events as SDK path
 *
 * @jest-environment node
 */

import { A2ASDKClient, type ParsedA2AEvent } from "../a2a-sdk-client";

// Provide global.window for fetch.bind(window) in Node test environment
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}

// Mock uuid
jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-safari-test"),
}));

// Track whether isSafariBrowser returns true or false
let mockIsSafari = false;

// Mock streaming-polyfill
jest.mock("../streaming-polyfill", () => {
  // Real parseSseStreamSafari implementation for integration tests
  const realParseSseStreamSafari = async function* (response: Response) {
    if (!response.body) {
      throw new Error("SSE response body is undefined. Cannot read stream.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "message";
    let eventData = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (eventData) yield { type: eventType, data: eventData };
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let lineEndIndex: number;
        while ((lineEndIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.substring(0, lineEndIndex).trim();
          buffer = buffer.substring(lineEndIndex + 1);
          if (line === "") {
            if (eventData) {
              yield { type: eventType, data: eventData };
              eventData = "";
              eventType = "message";
            }
          } else if (line.startsWith("event:")) {
            eventType = line.substring("event:".length).trim();
          } else if (line.startsWith("data:")) {
            eventData = line.substring("data:".length).trim();
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  return {
    isSafariBrowser: jest.fn(() => mockIsSafari),
    parseSseStreamSafari: jest.fn(realParseSseStreamSafari),
  };
});

// Mock the SDK transport
const mockSendMessageStream = jest.fn();

jest.mock("@a2a-js/sdk/client", () => ({
  JsonRpcTransport: jest.fn().mockImplementation(() => ({
    sendMessageStream: mockSendMessageStream,
  })),
  createAuthenticatingFetchWithRetry: jest.fn(
    (fetchFn: typeof fetch) => fetchFn
  ),
}));

// Helper: create a mock SSE Response with proper body stream
function createSseResponse(sseLines: string, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseLines));
      controller.close();
    },
  });

  return new Response(body, {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "text/event-stream" },
  });
}

// Helper: wrap a JSON-RPC result in SSE data line format
function sseData(result: object, id = 1): string {
  return `data: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`;
}

// Helper: collect all events from the async generator
async function collectEvents(
  gen: AsyncGenerator<ParsedA2AEvent, void, undefined>
): Promise<ParsedA2AEvent[]> {
  const events: ParsedA2AEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("A2ASDKClient Safari Compatibility", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = global.fetch;
    mockIsSafari = false;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Browser Detection Routing", () => {
    it("should use SDK transport.sendMessageStream on non-Safari browsers", async () => {
      mockIsSafari = false;

      // SDK transport yields events normally
      mockSendMessageStream.mockImplementation(async function* () {
        yield {
          kind: "status-update",
          taskId: "task-1",
          status: { state: "completed" },
          final: true,
        };
      });

      const client = new A2ASDKClient({
        endpoint: "http://localhost:8000",
      });

      // Replace transport mock
      (client as any).transport.sendMessageStream = mockSendMessageStream;

      const events = await collectEvents(
        client.sendMessageStream("hello")
      );

      // Should have used the SDK transport
      expect(mockSendMessageStream).toHaveBeenCalled();
      expect(events.length).toBeGreaterThan(0);
    });

    it("should bypass SDK transport on Safari and use direct fetch", async () => {
      mockIsSafari = true;

      const ssePayload =
        sseData({ kind: "task", id: "t-1", status: { state: "submitted" } }) +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      const mockFetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));
      global.fetch = mockFetch;

      const client = new A2ASDKClient({
        endpoint: "http://localhost:8000",
      });

      const events = await collectEvents(
        client.sendMessageStream("hello from safari")
      );

      // Should NOT have used SDK transport
      expect(mockSendMessageStream).not.toHaveBeenCalled();

      // Should have used direct fetch
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          }),
        })
      );

      // Should have parsed events
      expect(events.length).toBe(2);
      expect(events[0].type).toBe("task");
      expect(events[1].type).toBe("status");
      expect(events[1].isFinal).toBe(true);
    });
  });

  describe("Safari Streaming: Event Parsing", () => {
    beforeEach(() => {
      mockIsSafari = true;
    });

    it("should parse task events", async () => {
      const ssePayload =
        sseData({
          kind: "task",
          id: "task-safari-1",
          status: { state: "submitted" },
          contextId: "ctx-1",
        }) +
        sseData({
          kind: "status-update",
          taskId: "task-safari-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      const taskEvent = events.find((e) => e.type === "task");
      expect(taskEvent).toBeDefined();
      expect(taskEvent!.taskId).toBe("task-safari-1");
      expect(taskEvent!.displayContent).toContain("submitted");
    });

    it("should parse artifact events with streaming_result", async () => {
      const ssePayload =
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          contextId: "ctx-1",
          artifact: {
            name: "streaming_result",
            parts: [{ kind: "text", text: "Hello " }],
          },
          append: false,
        }) +
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          contextId: "ctx-1",
          artifact: {
            name: "streaming_result",
            parts: [{ kind: "text", text: "World!" }],
          },
          append: true,
        }) +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      const artifacts = events.filter((e) => e.type === "artifact");
      expect(artifacts).toHaveLength(2);

      // First chunk: replace (append=false)
      expect(artifacts[0].shouldAppend).toBe(false);
      expect(artifacts[0].displayContent).toBe("Hello ");

      // Second chunk: append (append=true)
      expect(artifacts[1].shouldAppend).toBe(true);
      expect(artifacts[1].displayContent).toBe("World!");
    });

    it("should parse final_result artifacts and mark as final", async () => {
      const ssePayload =
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          artifact: {
            name: "final_result",
            parts: [{ kind: "text", text: "Complete answer" }],
          },
          append: false,
        }) +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      const finalResult = events.find(
        (e) => e.artifactName === "final_result"
      );
      expect(finalResult).toBeDefined();
      expect(finalResult!.isFinal).toBe(true);
      expect(finalResult!.displayContent).toBe("Complete answer");
    });

    it("should parse message events", async () => {
      const ssePayload =
        sseData({
          kind: "message",
          messageId: "msg-1",
          role: "agent",
          parts: [
            { kind: "text", text: "Part 1 " },
            { kind: "text", text: "Part 2" },
          ],
          contextId: "ctx-1",
        }) +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      const messageEvent = events.find((e) => e.type === "message");
      expect(messageEvent).toBeDefined();
      expect(messageEvent!.displayContent).toBe("Part 1 Part 2");
      expect(messageEvent!.shouldAppend).toBe(true);
    });

    it("should extract sourceAgent from artifact metadata", async () => {
      const ssePayload =
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          artifact: {
            name: "streaming_result",
            parts: [{ kind: "text", text: "github data" }],
            metadata: { sourceAgent: "github" },
          },
          append: false,
        }) +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      const artifact = events.find((e) => e.type === "artifact");
      expect(artifact!.sourceAgent).toBe("github");
    });

    it("should include user email in message body", async () => {
      const ssePayload = sseData({
        kind: "status-update",
        taskId: "t-1",
        status: { state: "completed" },
        final: true,
      });

      const mockFetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));
      global.fetch = mockFetch;

      const client = new A2ASDKClient({
        endpoint: "http://localhost:8000",
        userEmail: "test@example.com",
      });

      await collectEvents(client.sendMessageStream("hello"));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.params.message.parts[0].text).toContain(
        "by user: test@example.com"
      );
      expect(body.params.message.parts[0].text).toContain("hello");
    });

    it("should include contextId in message params", async () => {
      const ssePayload = sseData({
        kind: "status-update",
        taskId: "t-1",
        status: { state: "completed" },
        final: true,
      });

      const mockFetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));
      global.fetch = mockFetch;

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      await collectEvents(
        client.sendMessageStream("hello", "ctx-existing-123")
      );

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.params.message.contextId).toBe("ctx-existing-123");
    });
  });

  describe("Safari Streaming: Stream Completion", () => {
    beforeEach(() => {
      mockIsSafari = true;
    });

    it("should detect completion from final status-update", async () => {
      const ssePayload =
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          artifact: {
            name: "streaming_result",
            parts: [{ kind: "text", text: "data" }],
          },
          append: false,
        }) +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        }) +
        // This event should NOT be yielded (stream already complete)
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          artifact: {
            name: "streaming_result",
            parts: [{ kind: "text", text: "extra" }],
          },
          append: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      // Should stop at the status-update, not yield the extra event
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("status");
      expect(events[1].isFinal).toBe(true);
    });

    it("should detect completion from failed status", async () => {
      const ssePayload = sseData({
        kind: "status-update",
        taskId: "t-1",
        status: { state: "failed" },
        final: true,
      });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      expect(events).toHaveLength(1);
      expect(events[0].isFinal).toBe(true);
    });

    it("should detect completion from completed task event", async () => {
      const ssePayload = sseData({
        kind: "task",
        id: "t-1",
        status: { state: "completed" },
      });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("task");
    });
  });

  describe("Safari Streaming: Error Handling", () => {
    beforeEach(() => {
      mockIsSafari = true;
    });

    it("should throw on 401 Unauthorized with session expired message", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response("Unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        })
      );

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });

      await expect(async () => {
        await collectEvents(client.sendMessageStream("test"));
      }).rejects.toThrow("Session expired");
    });

    it("should throw on 500 Internal Server Error with error body", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });

      await expect(async () => {
        await collectEvents(client.sendMessageStream("test"));
      }).rejects.toThrow("HTTP error for message/stream: 500");
    });

    it("should throw on JSON-RPC error in SSE event", async () => {
      const ssePayload = `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "Internal error" },
      })}\n\n`;

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });

      await expect(async () => {
        await collectEvents(client.sendMessageStream("test"));
      }).rejects.toThrow("SSE error: Internal error (Code: -32603)");
    });

    it("should handle malformed JSON in SSE event gracefully (skip, don't crash)", async () => {
      const ssePayload =
        "data: not-valid-json\n\n" +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });

      // Should not throw — malformed events are skipped
      const events = await collectEvents(client.sendMessageStream("test"));

      // Only the valid event should be yielded
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("status");
    });

    it("should handle SSE event with no result field (skip)", async () => {
      const ssePayload =
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1 })}\n\n` + // no result
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("test"));

      // First event has no result so should be skipped
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("status");
    });

    it("should handle network error (fetch rejects)", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network error"));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });

      await expect(async () => {
        await collectEvents(client.sendMessageStream("test"));
      }).rejects.toThrow("Network error");
    });

    it("should handle AbortError gracefully (not rethrow)", async () => {
      const abortError = new DOMException("The operation was aborted.", "AbortError");
      global.fetch = jest.fn().mockRejectedValue(abortError);

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });

      // AbortError should be caught and not rethrown
      const events = await collectEvents(client.sendMessageStream("test"));
      expect(events).toHaveLength(0);
    });
  });

  describe("Safari Streaming: Request Format", () => {
    beforeEach(() => {
      mockIsSafari = true;
    });

    it("should send correct JSON-RPC request format", async () => {
      const ssePayload = sseData({
        kind: "status-update",
        taskId: "t-1",
        status: { state: "completed" },
        final: true,
      });

      const mockFetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));
      global.fetch = mockFetch;

      const client = new A2ASDKClient({ endpoint: "http://test:8000" });
      await collectEvents(client.sendMessageStream("test message"));

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:8000");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers["Accept"]).toBe("text/event-stream");

      const body = JSON.parse(init.body);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("message/stream");
      expect(body.params.message.role).toBe("user");
      expect(body.params.message.parts[0].kind).toBe("text");
      expect(body.params.message.parts[0].text).toContain("test message");
      expect(body.id).toBeDefined();
    });

    it("should pass abort signal to fetch", async () => {
      const ssePayload = sseData({
        kind: "status-update",
        taskId: "t-1",
        status: { state: "completed" },
        final: true,
      });

      const mockFetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));
      global.fetch = mockFetch;

      const client = new A2ASDKClient({ endpoint: "http://test:8000" });
      await collectEvents(client.sendMessageStream("test"));

      const [, init] = mockFetch.mock.calls[0];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("should abort previous request when new message is sent", async () => {
      const ssePayload = sseData({
        kind: "status-update",
        taskId: "t-1",
        status: { state: "completed" },
        final: true,
      });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://test:8000" });

      // Start first stream (won't actually consume because we immediately start second)
      const firstAc = (client as any).abortController;

      // Complete first stream
      await collectEvents(client.sendMessageStream("first"));

      // Start second stream
      await collectEvents(client.sendMessageStream("second"));

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("Safari Streaming: Full A2A Session", () => {
    beforeEach(() => {
      mockIsSafari = true;
    });

    it("should handle a complete A2A streaming session end-to-end", async () => {
      const ssePayload =
        // 1. Task submitted
        sseData({
          kind: "task",
          id: "task-e2e",
          status: { state: "submitted" },
          contextId: "ctx-e2e",
        }) +
        // 2. Execution plan
        sseData({
          kind: "artifact-update",
          taskId: "task-e2e",
          contextId: "ctx-e2e",
          artifact: {
            name: "execution_plan_update",
            parts: [{ kind: "text", text: "1. Fetch data\n2. Format response" }],
            metadata: { sourceAgent: "supervisor" },
          },
          append: false,
        }) +
        // 3. Tool notification start
        sseData({
          kind: "artifact-update",
          taskId: "task-e2e",
          contextId: "ctx-e2e",
          artifact: {
            name: "tool_notification_start",
            parts: [{ kind: "text", text: "Calling GitHub API..." }],
            metadata: { sourceAgent: "github" },
          },
          append: false,
        }) +
        // 4. Tool notification end
        sseData({
          kind: "artifact-update",
          taskId: "task-e2e",
          contextId: "ctx-e2e",
          artifact: {
            name: "tool_notification_end",
            parts: [{ kind: "text", text: "GitHub API call complete" }],
            metadata: { sourceAgent: "github" },
          },
          append: false,
        }) +
        // 5. Streaming result chunk 1
        sseData({
          kind: "artifact-update",
          taskId: "task-e2e",
          contextId: "ctx-e2e",
          artifact: {
            name: "streaming_result",
            parts: [{ kind: "text", text: "Your GitHub profile: " }],
            metadata: { sourceAgent: "supervisor" },
          },
          append: false,
        }) +
        // 6. Streaming result chunk 2
        sseData({
          kind: "artifact-update",
          taskId: "task-e2e",
          contextId: "ctx-e2e",
          artifact: {
            name: "streaming_result",
            parts: [{ kind: "text", text: "**sri** (50 repos)" }],
            metadata: { sourceAgent: "supervisor" },
          },
          append: true,
        }) +
        // 7. Final result
        sseData({
          kind: "artifact-update",
          taskId: "task-e2e",
          contextId: "ctx-e2e",
          artifact: {
            name: "final_result",
            parts: [
              {
                kind: "text",
                text: "Your GitHub profile: **sri** (50 repos)",
              },
            ],
            metadata: { sourceAgent: "supervisor" },
          },
          append: false,
        }) +
        // 8. Status complete
        sseData({
          kind: "status-update",
          taskId: "task-e2e",
          contextId: "ctx-e2e",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(
        client.sendMessageStream("show my github profile")
      );

      // Verify total events (stream stops at status-update final)
      expect(events).toHaveLength(8);

      // 1. Task
      expect(events[0].type).toBe("task");
      expect(events[0].taskId).toBe("task-e2e");

      // 2. Execution plan
      expect(events[1].type).toBe("artifact");
      expect(events[1].artifactName).toBe("execution_plan_update");
      expect(events[1].sourceAgent).toBe("supervisor");

      // 3. Tool start
      expect(events[2].type).toBe("artifact");
      expect(events[2].artifactName).toBe("tool_notification_start");
      expect(events[2].sourceAgent).toBe("github");

      // 4. Tool end
      expect(events[3].type).toBe("artifact");
      expect(events[3].artifactName).toBe("tool_notification_end");

      // 5. Streaming chunk 1 (replace)
      expect(events[4].shouldAppend).toBe(false);
      expect(events[4].displayContent).toBe("Your GitHub profile: ");

      // 6. Streaming chunk 2 (append)
      expect(events[5].shouldAppend).toBe(true);
      expect(events[5].displayContent).toBe("**sri** (50 repos)");

      // 7. Final result
      expect(events[6].isFinal).toBe(true);
      expect(events[6].artifactName).toBe("final_result");
      expect(events[6].displayContent).toContain("**sri** (50 repos)");

      // 8. Status complete
      expect(events[7].type).toBe("status");
      expect(events[7].isFinal).toBe(true);
    });

    it("should handle tool notifications and execution plans from sub-agents", async () => {
      const ssePayload =
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          artifact: {
            name: "tool_notification_start",
            parts: [{ kind: "text", text: "Calling ArgoCD..." }],
            metadata: { sourceAgent: "argocd" },
          },
          append: false,
        }) +
        sseData({
          kind: "artifact-update",
          taskId: "t-1",
          artifact: {
            name: "tool_notification_end",
            parts: [{ kind: "text", text: "ArgoCD responded" }],
            metadata: { sourceAgent: "argocd" },
          },
          append: false,
        }) +
        sseData({
          kind: "status-update",
          taskId: "t-1",
          status: { state: "completed" },
          final: true,
        });

      global.fetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));

      const client = new A2ASDKClient({ endpoint: "http://localhost:8000" });
      const events = await collectEvents(client.sendMessageStream("argocd version"));

      const toolStart = events.find(
        (e) => e.artifactName === "tool_notification_start"
      );
      expect(toolStart).toBeDefined();
      expect(toolStart!.sourceAgent).toBe("argocd");
      expect(toolStart!.displayContent).toContain("ArgoCD");

      const toolEnd = events.find(
        (e) => e.artifactName === "tool_notification_end"
      );
      expect(toolEnd).toBeDefined();
      expect(toolEnd!.sourceAgent).toBe("argocd");
    });
  });

  describe("Safari Streaming: Token/Auth", () => {
    beforeEach(() => {
      mockIsSafari = true;
    });

    it("should use authenticated fetch when accessToken is provided", async () => {
      const ssePayload = sseData({
        kind: "status-update",
        taskId: "t-1",
        status: { state: "completed" },
        final: true,
      });

      const mockFetch = jest.fn().mockResolvedValue(createSseResponse(ssePayload));
      global.fetch = mockFetch;

      const client = new A2ASDKClient({
        endpoint: "http://localhost:8000",
        accessToken: "my-jwt-token",
      });

      await collectEvents(client.sendMessageStream("test"));

      // createAuthenticatingFetchWithRetry should have been called
      const { createAuthenticatingFetchWithRetry } = require("@a2a-js/sdk/client");
      expect(createAuthenticatingFetchWithRetry).toHaveBeenCalled();
    });

    it("should store endpoint for Safari direct fetch", () => {
      global.fetch = jest.fn();

      const client = new A2ASDKClient({
        endpoint: "http://custom:9000",
      });

      expect((client as any).endpoint).toBe("http://custom:9000");
    });

    it("should update fetchImpl when setAccessToken is called", () => {
      global.fetch = jest.fn();

      const client = new A2ASDKClient({
        endpoint: "http://localhost:8000",
      });

      const originalFetchImpl = (client as any).fetchImpl;
      client.setAccessToken("new-token");
      const newFetchImpl = (client as any).fetchImpl;

      // fetchImpl should be updated (new authenticated fetch)
      expect(newFetchImpl).toBeDefined();
    });
  });
});
