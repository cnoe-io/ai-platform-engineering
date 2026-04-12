/**
 * Unit tests for stream adapters.
 *
 * Tests:
 *  - A2aAdapter: mock SSE → StreamEvent mapping
 *  - AguiAdapter: mock events → StreamEvent mapping
 *  - createAdapter factory returns correct type
 *  - Token accumulation across events
 */

import { describe, it, expect, mock } from "bun:test";
import { A2aAdapter, AguiAdapter, createAdapter } from "../src/chat/stream";
import type { SendPayload } from "../src/chat/stream";
import { DEFAULT_AGENT } from "../src/agents/types";

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
  it("maps A2A text parts to token events", async () => {
    const mockEvents = [
      // Simulated SSE event with text part
      `data: ${JSON.stringify({
        status: {
          state: "working",
          message: { role: "assistant", parts: [{ type: "text", text: "Hello " }] },
        },
      })}\n\n`,
      `data: ${JSON.stringify({
        status: {
          state: "working",
          message: { role: "assistant", parts: [{ type: "text", text: "world!" }] },
        },
      })}\n\n`,
      `data: ${JSON.stringify({ status: { state: "completed" } })}\n\n`,
    ].join("");

    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(mockEvents));
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(mockBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    ) as typeof fetch;

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
    global.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as typeof fetch;

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
            `data: ${JSON.stringify({ status: { state: "working", message: { role: "assistant", parts: [{ type: "text", text: "hi" }] } } })}\n\n` +
              `data: [DONE]\n\n`,
          ),
        );
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(mockBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    ) as typeof fetch;

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

  it("maps artifact text parts to token events", async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ artifact: { parts: [{ type: "text", text: "artifact-text" }] } })}\n\n` +
              `data: [DONE]\n\n`,
          ),
        );
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(mockBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      ),
    ) as typeof fetch;

    try {
      const adapter = new A2aAdapter(DEFAULT_AGENT, SERVER_URL, getToken);
      const events = [];
      for await (const ev of adapter.connect(PAYLOAD)) {
        events.push(ev);
      }

      const tokenEv = events.find((e) => e.type === "token") as { text: string } | undefined;
      expect(tokenEv?.text).toBe("artifact-text");
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
  it("A2aAdapter accumulates full response in done event", async () => {
    const parts = ["Hello", ", ", "world", "!"];
    const events = parts
      .map(
        (text) =>
          `data: ${JSON.stringify({
            status: {
              state: "working",
              message: { role: "assistant", parts: [{ type: "text", text }] },
            },
          })}`,
      )
      .join("\n\n");

    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events + "\n\ndata: [DONE]\n\n"));
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(mockBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      ),
    ) as typeof fetch;

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
