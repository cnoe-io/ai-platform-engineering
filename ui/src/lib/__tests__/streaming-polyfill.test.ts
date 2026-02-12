/**
 * Unit tests for Safari streaming compatibility polyfill.
 *
 * Tests cover:
 * - Safari browser detection (isSafariBrowser)
 * - SSE stream parsing (parseSseStreamSafari)
 * - Edge cases: chunked data, multi-line events, comments, empty streams
 * - Parity with the SDK's parseSseStream behavior
 *
 * @jest-environment node
 */

import { isSafariBrowser, parseSseStreamSafari, type SseEvent } from "../streaming-polyfill";

// Helper: create a mock Response with a ReadableStream body from SSE text chunks
function createMockSseResponse(chunks: string[]): Response {
  let chunkIndex = 0;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// Helper: collect all events from the async generator
async function collectEvents(response: Response): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of parseSseStreamSafari(response)) {
    events.push(event);
  }
  return events;
}

describe("streaming-polyfill", () => {
  describe("isSafariBrowser", () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
      // Reset the cached detection state by re-importing
      // We need to reset the module-level `safariDetected` variable
      jest.resetModules();
      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it("should return false in jsdom (not Safari)", () => {
      // jsdom's navigator.userAgent does not include "Safari"
      // Re-import to reset cached state
      const { isSafariBrowser: freshDetect } = require("../streaming-polyfill");
      expect(freshDetect()).toBe(false);
    });

    it("should return true for Safari user agent", () => {
      Object.defineProperty(global, "navigator", {
        value: {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        },
        writable: true,
        configurable: true,
      });

      const { isSafariBrowser: freshDetect } = require("../streaming-polyfill");
      expect(freshDetect()).toBe(true);
    });

    it("should return false for Chrome user agent (contains Safari but also Chrome)", () => {
      Object.defineProperty(global, "navigator", {
        value: {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        writable: true,
        configurable: true,
      });

      const { isSafariBrowser: freshDetect } = require("../streaming-polyfill");
      expect(freshDetect()).toBe(false);
    });

    it("should return false for Chromium-based Edge (contains Safari and Chromium)", () => {
      Object.defineProperty(global, "navigator", {
        value: {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0 Chromium/120",
        },
        writable: true,
        configurable: true,
      });

      const { isSafariBrowser: freshDetect } = require("../streaming-polyfill");
      expect(freshDetect()).toBe(false);
    });

    it("should return true for iOS Safari user agent", () => {
      Object.defineProperty(global, "navigator", {
        value: {
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        },
        writable: true,
        configurable: true,
      });

      const { isSafariBrowser: freshDetect } = require("../streaming-polyfill");
      expect(freshDetect()).toBe(true);
    });

    it("should return false when navigator is undefined (Node/SSR)", () => {
      Object.defineProperty(global, "navigator", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const { isSafariBrowser: freshDetect } = require("../streaming-polyfill");
      expect(freshDetect()).toBe(false);
    });

    it("should cache the result after first call", () => {
      Object.defineProperty(global, "navigator", {
        value: {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        },
        writable: true,
        configurable: true,
      });

      const { isSafariBrowser: freshDetect } = require("../streaming-polyfill");
      const first = freshDetect();
      expect(first).toBe(true);

      // Change UA — should still return cached value
      Object.defineProperty(global, "navigator", {
        value: {
          userAgent: "Mozilla/5.0 Chrome/120.0.0.0",
        },
        writable: true,
        configurable: true,
      });
      const second = freshDetect();
      expect(second).toBe(true); // still cached as Safari
    });
  });

  describe("parseSseStreamSafari", () => {
    it("should throw if response body is undefined", async () => {
      const response = { body: null } as unknown as Response;

      await expect(async () => {
        for await (const _ of parseSseStreamSafari(response)) {
          // consume
        }
      }).rejects.toThrow("SSE response body is undefined");
    });

    it("should parse a single SSE event", async () => {
      const response = createMockSseResponse([
        "data: {\"jsonrpc\":\"2.0\",\"result\":{\"kind\":\"task\"}}\n\n",
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message"); // default type
      expect(events[0].data).toBe('{"jsonrpc":"2.0","result":{"kind":"task"}}');
    });

    it("should parse multiple SSE events in a single chunk", async () => {
      const response = createMockSseResponse([
        'data: {"event":"one"}\n\ndata: {"event":"two"}\n\n',
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(2);
      expect(events[0].data).toBe('{"event":"one"}');
      expect(events[1].data).toBe('{"event":"two"}');
    });

    it("should handle events split across multiple chunks", async () => {
      // The SSE event is split across two chunks mid-line
      const response = createMockSseResponse([
        'data: {"split":',
        '"across_chunks"}\n\n',
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"split":"across_chunks"}');
    });

    it("should handle event split at newline boundary", async () => {
      const response = createMockSseResponse([
        'data: {"event":"one"}\n',
        "\n", // empty line completing the event
        'data: {"event":"two"}\n\n',
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(2);
      expect(events[0].data).toBe('{"event":"one"}');
      expect(events[1].data).toBe('{"event":"two"}');
    });

    it("should handle custom event types", async () => {
      const response = createMockSseResponse([
        "event: error\ndata: {\"code\":500}\n\n",
        "event: custom\ndata: {\"type\":\"custom\"}\n\n",
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("error");
      expect(events[0].data).toBe('{"code":500}');
      expect(events[1].type).toBe("custom");
      expect(events[1].data).toBe('{"type":"custom"}');
    });

    it("should reset event type to 'message' after each event", async () => {
      const response = createMockSseResponse([
        "event: custom\ndata: first\n\n",
        "data: second\n\n", // no event: line, should default to "message"
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("custom");
      expect(events[1].type).toBe("message");
    });

    it("should ignore SSE comment lines (starting with ':')", async () => {
      const response = createMockSseResponse([
        ": this is a comment\ndata: actual_data\n\n",
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe("actual_data");
    });

    it("should handle empty stream (no events)", async () => {
      const response = createMockSseResponse([]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(0);
    });

    it("should yield remaining buffered event when stream ends after newline", async () => {
      // Stream ends with data and one newline (event data parsed) but no
      // trailing double-newline (event not terminated). The data is in
      // eventData when the stream closes, so it should be yielded.
      const response = createMockSseResponse([
        'data: {"incomplete":"event"}\n',
      ]);

      const events = await collectEvents(response);
      // After the newline, eventData is set. On stream close, remaining eventData is yielded.
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"incomplete":"event"}');
    });

    it("should NOT yield incomplete data line without newline", async () => {
      // Stream ends mid-line (no newline at all). The data stays in buffer
      // and never gets parsed into eventData, so nothing is yielded.
      const response = createMockSseResponse([
        'data: {"incomplete":"event"}',
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(0);
    });

    it("should handle stream with only empty lines (heartbeat)", async () => {
      const response = createMockSseResponse(["\n\n\n\n"]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(0);
    });

    it("should handle stream with comments and heartbeats only", async () => {
      const response = createMockSseResponse([
        ": heartbeat\n\n: another heartbeat\n\n",
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(0);
    });

    it("should parse a realistic A2A streaming session", async () => {
      // Simulate a real A2A streaming session with multiple event types
      const ssePayload = [
        // Task submitted
        'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"task","id":"task-001","status":{"state":"submitted"}}}\n\n',
        // Streaming result (first chunk, append=false)
        'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-001","artifact":{"name":"streaming_result","parts":[{"kind":"text","text":"Hello "}]},"append":false}}\n\n',
        // Streaming result (continuation, append=true)
        'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-001","artifact":{"name":"streaming_result","parts":[{"kind":"text","text":"World!"}]},"append":true}}\n\n',
        // Final result
        'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"artifact-update","taskId":"task-001","artifact":{"name":"final_result","parts":[{"kind":"text","text":"Hello World!"}]},"append":false}}\n\n',
        // Status complete
        'data: {"jsonrpc":"2.0","id":1,"result":{"kind":"status-update","taskId":"task-001","status":{"state":"completed"},"final":true}}\n\n',
      ];

      const response = createMockSseResponse(ssePayload);
      const events = await collectEvents(response);

      expect(events).toHaveLength(5);

      // Verify each event's data is valid JSON
      events.forEach((event) => {
        expect(() => JSON.parse(event.data)).not.toThrow();
      });

      // Verify task submitted
      const task = JSON.parse(events[0].data);
      expect(task.result.kind).toBe("task");
      expect(task.result.status.state).toBe("submitted");

      // Verify first streaming (append=false)
      const firstStream = JSON.parse(events[1].data);
      expect(firstStream.result.artifact.name).toBe("streaming_result");
      expect(firstStream.result.append).toBe(false);

      // Verify second streaming (append=true)
      const secondStream = JSON.parse(events[2].data);
      expect(secondStream.result.append).toBe(true);

      // Verify final result
      const finalResult = JSON.parse(events[3].data);
      expect(finalResult.result.artifact.name).toBe("final_result");

      // Verify completion status
      const status = JSON.parse(events[4].data);
      expect(status.result.kind).toBe("status-update");
      expect(status.result.final).toBe(true);
    });

    it("should handle multi-byte UTF-8 characters split across chunks", async () => {
      const emoji = "Hello 👋 World";
      const encoder = new TextEncoder();
      const encoded = encoder.encode(`data: ${emoji}\n\n`);

      // Split in the middle of the emoji (which is 4 bytes)
      const splitPoint = 9; // mid-emoji
      const chunk1 = encoded.slice(0, splitPoint);
      const chunk2 = encoded.slice(splitPoint);

      let chunkIndex = 0;
      const chunks = [chunk1, chunk2];

      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIndex < chunks.length) {
            controller.enqueue(chunks[chunkIndex]);
            chunkIndex++;
          } else {
            controller.close();
          }
        },
      });

      const response = new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe(emoji);
    });

    it("should handle rapid small chunks (byte-by-byte)", async () => {
      const sseText = 'data: {"test":"rapid"}\n\n';
      const encoder = new TextEncoder();
      const encoded = encoder.encode(sseText);

      // Create byte-by-byte chunks
      const byteChunks: Uint8Array[] = [];
      for (let i = 0; i < encoded.length; i++) {
        byteChunks.push(encoded.slice(i, i + 1));
      }

      let chunkIndex = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIndex < byteChunks.length) {
            controller.enqueue(byteChunks[chunkIndex]);
            chunkIndex++;
          } else {
            controller.close();
          }
        },
      });

      const response = new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"test":"rapid"}');
    });

    it("should handle events with extra whitespace in field values", async () => {
      const response = createMockSseResponse([
        "event:   custom_type  \ndata:   some data  \n\n",
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("custom_type");
      expect(events[0].data).toBe("some data");
    });

    it("should ignore lines that are not data, event, or comments", async () => {
      const response = createMockSseResponse([
        "id: 123\nretry: 5000\ndata: valid_data\n\n",
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe("valid_data");
    });

    it("should handle SSE error event from A2A backend", async () => {
      const response = createMockSseResponse([
        'event: error\ndata: {"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal error"}}\n\n',
      ]);

      const events = await collectEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      const parsed = JSON.parse(events[0].data);
      expect(parsed.error.code).toBe(-32603);
      expect(parsed.error.message).toBe("Internal error");
    });

    it("should not yield empty data events", async () => {
      const response = createMockSseResponse([
        // Empty data line followed by double newline
        "data: \n\n",
        // Valid data
        "data: valid\n\n",
      ]);

      const events = await collectEvents(response);
      // "data: " with trailing space, trimmed = empty string, so eventData is empty and not yielded
      // Actually, "data: " trimmed is "" which is falsy, so it should not be yielded
      // But "data: valid" should yield
      // Let's check: the parser checks `if (eventData)` before yielding
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe("valid");
    });
  });
});
