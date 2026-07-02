/**
 * Unit tests for the AG-UI stream adapter.
 *
 * Tests:
 *  - AguiAdapter: AG-UI SSE → StreamEvent mapping
 *  - Token accumulation across TEXT_MESSAGE_CONTENT events
 *  - Tool event mapping from TOOL_CALL_START
 *  - Error handling for RUN_ERROR and non-200 responses
 *  - Terminal events (RUN_FINISHED) stop the stream
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT } from "../src/agents/types";
import { AguiAdapter, createAdapter } from "../src/chat/stream";
import type { SendPayload } from "../src/chat/stream";

const SERVER_URL = "https://caipe.test/api/v1/chat/stream/start";
const PAYLOAD: SendPayload = {
  prompt: "hello",
  systemContext: "",
  sessionId: "test-session",
  agentName: "default",
  history: [],
};

const getToken = async () => "test-bearer-token";

// Helper: build an AG-UI SSE frame
const sseFrame = (eventType: string, payload: Record<string, unknown>): string => {
  const data = JSON.stringify({ type: eventType, ...payload });
  return `event: ${eventType}\ndata: ${data}\n\n`;
};

// ── AguiAdapter ───────────────────────────────────────────────────────────────

describe("AguiAdapter", () => {
  it("maps TEXT_MESSAGE_CONTENT to token events", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseFrame("RUN_STARTED", { runId: "r1" }) +
            sseFrame("TEXT_MESSAGE_START", { messageId: "m1", role: "assistant" }) +
            sseFrame("TEXT_MESSAGE_CONTENT", { messageId: "m1", delta: "Hello " }) +
            sseFrame("TEXT_MESSAGE_CONTENT", { messageId: "m1", delta: "world!" }) +
            sseFrame("TEXT_MESSAGE_END", { messageId: "m1" }) +
            sseFrame("RUN_FINISHED", { runId: "r1", outcome: "success" }),
          ),
        );
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(mockBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      ),
    ) as unknown as typeof fetch;

    try {
      const adapter = new AguiAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }

      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(2);
      expect((tokens[0] as { text: string }).text).toBe("Hello ");
      expect((tokens[1] as { text: string }).text).toBe("world!");

      const done = events.find((e) => e.type === "done");
      expect(done).toBeDefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("emits error event on non-200 response", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    ) as unknown as typeof fetch;

    try {
      const adapter = new AguiAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }

      const errEv = events.find((e) => e.type === "error");
      expect(errEv).toBeDefined();
      expect((errEv as { message: string }).message).toContain("500");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("maps TOOL_CALL_START to tool events", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseFrame("RUN_STARTED", { runId: "r1" }) +
            sseFrame("TOOL_CALL_START", { toolCallId: "tc1", toolCallName: "search_github" }) +
            sseFrame("TOOL_CALL_END", { toolCallId: "tc1" }) +
            sseFrame("RUN_FINISHED", { runId: "r1", outcome: "success" }),
          ),
        );
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(mockBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      ),
    ) as unknown as typeof fetch;

    try {
      const adapter = new AguiAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }

      const toolEv = events.find((e) => e.type === "tool");
      expect(toolEv).toBeDefined();
      expect((toolEv as { name: string }).name).toBe("search_github");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("maps RUN_ERROR to error events and stops stream", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseFrame("RUN_STARTED", { runId: "r1" }) +
            sseFrame("RUN_ERROR", { message: "Agent execution failed" }),
          ),
        );
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(mockBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      ),
    ) as unknown as typeof fetch;

    try {
      const adapter = new AguiAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }

      const errEv = events.find((e) => e.type === "error");
      expect(errEv).toBeDefined();
      expect((errEv as { message: string }).message).toContain("Agent execution failed");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses agentName from payload when agent name is 'default'", async () => {
    let capturedBody = "";
    const originalFetch = global.fetch;
    global.fetch = vi.fn((url, init) => {
      capturedBody = (init?.body as string) ?? "";
      return Promise.resolve(new Response("error", { status: 503 }));
    }) as unknown as typeof fetch;

    try {
      const customPayload: SendPayload = { ...PAYLOAD, agentName: "my-agent" };
      const adapter = new AguiAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      for await (const _ of adapter.connect(customPayload)) { /* drain */ }

      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(body.agent_id).toBe("my-agent");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── createAdapter factory ─────────────────────────────────────────────────────

describe("createAdapter", () => {
  it("returns AguiAdapter", () => {
    const adapter = createAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
    expect(adapter).toBeInstanceOf(AguiAdapter);
  });
});

// ── Token accumulation ────────────────────────────────────────────────────────

describe("token accumulation", () => {
  it("accumulates full response across multiple TEXT_MESSAGE_CONTENT events", async () => {
    const parts = ["Hello", ", ", "world", "!"];
    const frames = parts
      .map((delta) => sseFrame("TEXT_MESSAGE_CONTENT", { messageId: "m1", delta }))
      .join("");

    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseFrame("RUN_STARTED", { runId: "r1" }) +
            frames +
            sseFrame("RUN_FINISHED", { runId: "r1", outcome: "success" }),
          ),
        );
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(mockBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      ),
    ) as unknown as typeof fetch;

    try {
      const adapter = new AguiAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const collected = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        collected.push(ev);
      }

      const tokens = collected.filter((e) => e.type === "token").map((e) => (e as { text: string }).text);
      expect(tokens.join("")).toBe("Hello, world!");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
