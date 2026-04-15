/**
 * Unit tests for stream adapters.
 *
 * Tests:
 *  - A2aAdapter: mock SSE → StreamEvent mapping
 *  - AguiAdapter: mock events → StreamEvent mapping
 *  - createAdapter factory returns correct type
 *  - Token accumulation across events
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT } from "../src/agents/types";
import { A2aAdapter, AguiAdapter, createAdapter } from "../src/chat/stream";
import type { SendPayload } from "../src/chat/stream";

const SERVER_URL = "https://caipe.test";
const PAYLOAD: SendPayload = {
  prompt: "hello",
  systemContext: "",
  sessionId: "test-session",
  agentName: "default",
  history: [],
};

const getToken = async () => "test-bearer-token";

// ── A2aAdapter ────────────────────────────────────────────────────────────────

describe("A2aAdapter", () => {
  // Helper: wrap a result in a JSON-RPC SSE data line
  const rpc = (result: unknown) =>
    `data: ${JSON.stringify({ jsonrpc: "2.0", id: "test-session", result })}\n\n`;

  it("maps streaming artifact-update text to token events", async () => {
    const mockEvents = [
      rpc({ kind: "task", id: "t1", status: { state: "submitted" } }),
      rpc({
        kind: "artifact-update",
        artifact: {
          name: "streaming_result",
          metadata: { is_final_answer: true },
          parts: [{ kind: "text", text: "Hello " }],
        },
        lastChunk: false,
      }),
      rpc({
        kind: "artifact-update",
        artifact: {
          name: "streaming_result",
          metadata: { is_final_answer: true },
          parts: [{ kind: "text", text: "world!" }],
        },
        append: true,
        lastChunk: false,
      }),
      rpc({ kind: "status-update", status: { state: "completed" } }),
    ].join("");

    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(mockEvents));
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(mockBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    ) as unknown as typeof fetch;

    try {
      const adapter = new A2aAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
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
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as unknown as typeof fetch;

    try {
      const adapter = new A2aAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
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

  it("handles [DONE] sentinel correctly", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${rpc({
              kind: "artifact-update",
              artifact: { name: "streaming_result", parts: [{ kind: "text", text: "hi" }] },
              lastChunk: false,
            })}data: [DONE]\n\n`,
          ),
        );
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(mockBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    ) as unknown as typeof fetch;

    try {
      const adapter = new A2aAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }

      const done = events.find((e) => e.type === "done");
      expect(done).toBeDefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("skips final_result artifacts to avoid duplicate output", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${rpc({
              kind: "artifact-update",
              artifact: { name: "final_result", parts: [{ kind: "text", text: "artifact-text" }] },
              lastChunk: true,
            })}data: [DONE]\n\n`,
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
      const adapter = new A2aAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }

      // final_result is skipped — only started and done events
      const tokenEv = events.find((e) => e.type === "token");
      expect(tokenEv).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("strips /tasks/send suffix from legacy discovery endpoints", async () => {
    const originalFetch = global.fetch;
    let capturedUrl = "";
    global.fetch = vi.fn((url: string | URL | Request) => {
      capturedUrl = String(url);
      return Promise.resolve(new Response("Server Error", { status: 500 }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new A2aAdapter(DEFAULT_AGENT, "http://localhost:8000/tasks/send", getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }
      expect(capturedUrl).toBe("http://localhost:8000");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("maps tool_notification_start to tool events", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            rpc({
              kind: "artifact-update",
              artifact: {
                name: "tool_notification_start",
                metadata: { sourceAgent: "composing_answer" },
                parts: [{ kind: "text", text: "Composing..." }],
              },
              lastChunk: false,
            }) + rpc({ kind: "status-update", status: { state: "completed" } }),
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
      const adapter = new A2aAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }
      const toolEv = events.find((e) => e.type === "tool");
      expect(toolEv).toBeDefined();
      expect((toolEv as { name: string }).name).toBe("composing_answer");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── createAdapter factory ─────────────────────────────────────────────────────

describe("createAdapter", () => {
  it("returns A2aAdapter for protocol=a2a", () => {
    const adapter = createAdapter("a2a", DEFAULT_AGENT, SERVER_URL, getToken);
    expect(adapter).toBeInstanceOf(A2aAdapter);
  });

  it("returns AguiAdapter for protocol=agui", () => {
    const adapter = createAdapter("agui", DEFAULT_AGENT, SERVER_URL, getToken);
    expect(adapter).toBeInstanceOf(AguiAdapter);
  });
});

// ── Token accumulation ────────────────────────────────────────────────────────

describe("token accumulation", () => {
  // Helper: wrap a result in a JSON-RPC SSE data line
  const rpc = (result: unknown) =>
    `data: ${JSON.stringify({ jsonrpc: "2.0", id: "test-session", result })}\n\n`;

  it("A2aAdapter accumulates full response in done event", async () => {
    const parts = ["Hello", ", ", "world", "!"];
    const events = parts
      .map((text) =>
        rpc({
          kind: "artifact-update",
          artifact: {
            name: "streaming_result",
            metadata: { is_final_answer: true },
            parts: [{ kind: "text", text }],
          },
          append: true,
          lastChunk: false,
        }),
      )
      .join("");

    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${events}data: [DONE]\n\n`));
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
      const adapter = new A2aAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const collected = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        collected.push(ev);
      }

      const doneEv = collected.find((e) => e.type === "done") as { response?: string } | undefined;
      expect(doneEv?.response).toBe("Hello, world!");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
