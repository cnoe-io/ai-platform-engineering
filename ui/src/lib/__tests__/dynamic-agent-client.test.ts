/**
 * @jest-environment node
 */

import { DynamicAgentClient } from "../dynamic-agent-client";

const mockFetch = jest.fn();

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encoded = chunks.map((chunk) => encoder.encode(chunk));
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < encoded.length) {
        controller.enqueue(encoded[index++]);
      } else {
        controller.close();
      }
    },
  });
}

async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

beforeAll(() => {
  global.fetch = mockFetch;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("DynamicAgentClient.cancelStream", () => {
  it("aborts local streaming and sends an authenticated cancel request", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ cancelled: true }),
    });

    const client = new DynamicAgentClient({
      proxyUrl: "/api/dynamic-agents/chat",
      accessToken: "token-123",
    });

    await expect(client.cancelStream("conversation-1", "agent-1")).resolves.toBe(true);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dynamic-agents/chat/cancel",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token-123",
        },
        body: JSON.stringify({
          agent_id: "agent-1",
          session_id: "conversation-1",
        }),
      }),
    );
  });

  it("returns false when the cancel request fails or returns a non-ok response", async () => {
    const client = new DynamicAgentClient({ proxyUrl: "/api/dynamic-agents/chat" });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" });
    await expect(client.cancelStream("conversation-1", "agent-1")).resolves.toBe(false);

    mockFetch.mockRejectedValueOnce(new Error("network down"));
    await expect(client.cancelStream("conversation-1", "agent-1")).resolves.toBe(false);
  });
});

describe("DynamicAgentClient.sendMessageStream", () => {
  it("posts to start-stream and maps structured SSE content/tool events", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: sseStream([
        'event: content\ndata: {"text":"hello","namespace":["agent-a"]}\n\n',
        'event: tool_start\ndata: {"tool_name":"search","tool_call_id":"call-1","args":{"q":"rbac"},"namespace":[]}\n\n',
        "event: done\ndata: {}\n\n",
      ]),
      status: 200,
      statusText: "OK",
    });

    const client = new DynamicAgentClient({
      proxyUrl: "/api/dynamic-agents/chat",
      accessToken: "jwt",
    });

    const events = await collect(
      client.sendMessageStream("Summarize RBAC", "conversation-1", "agent-1"),
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dynamic-agents/chat/start-stream",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: "Bearer jwt",
        },
        body: JSON.stringify({
          message: "Summarize RBAC",
          conversation_id: "conversation-1",
          agent_id: "agent-1",
        }),
      }),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "content",
      content: "hello",
      namespace: ["agent-a"],
    });
    expect(events[1]).toMatchObject({
      type: "tool_start",
      toolData: {
        tool_name: "search",
        tool_call_id: "call-1",
        args: { q: "rbac" },
      },
    });
  });

  it("maps JSON and raw error events as terminal stream events", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          'event: error\ndata: {"error":"boom","namespace":["child"]}\n\n',
        ]),
        status: 200,
        statusText: "OK",
      })
      .mockResolvedValueOnce({
        ok: true,
        body: sseStream(["event: error\ndata: raw failure\n\n"]),
        status: 200,
        statusText: "OK",
      });

    const client = new DynamicAgentClient({ proxyUrl: "/api/dynamic-agents/chat" });

    await expect(
      collect(client.sendMessageStream("first", "conversation-1", "agent-1")),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "error",
        content: "Error: boom",
        displayContent: "Error: boom",
        isFinal: true,
        namespace: ["child"],
      }),
    ]);

    await expect(
      collect(client.sendMessageStream("second", "conversation-1", "agent-1")),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "error",
        content: "Error: raw failure",
        namespace: [],
      }),
    ]);
  });

  it("skips malformed structured events and supports data lines without a space", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: sseStream([
        "event: content\ndata: not-json\n\n",
        'event: warning\ndata:{"message":"watch this","namespace":[]}\n\n',
        "event: done\ndata: {}\n\n",
      ]),
      status: 200,
      statusText: "OK",
    });

    const client = new DynamicAgentClient({ proxyUrl: "/api/dynamic-agents/chat" });

    await expect(
      collect(client.sendMessageStream("warn", "conversation-1", "agent-1")),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "warning",
        warningData: { message: "watch this" },
        displayContent: "watch this",
      }),
    ]);
  });

  it("throws session-expired and HTTP errors before streaming", async () => {
    const client = new DynamicAgentClient({ proxyUrl: "/api/dynamic-agents/chat" });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "expired",
    });
    await expect(
      collect(client.sendMessageStream("hello", "conversation-1", "agent-1")),
    ).rejects.toThrow("Session expired");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "backend unavailable",
    });
    await expect(
      collect(client.sendMessageStream("hello", "conversation-1", "agent-1")),
    ).rejects.toThrow("HTTP error: 503 Service Unavailable. backend unavailable");
  });

  it("throws when the response body is not readable", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
      status: 200,
      statusText: "OK",
    });

    const client = new DynamicAgentClient({ proxyUrl: "/api/dynamic-agents/chat" });

    await expect(
      collect(client.sendMessageStream("hello", "conversation-1", "agent-1")),
    ).rejects.toThrow("Response body is not readable");
  });
});
