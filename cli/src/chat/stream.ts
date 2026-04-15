/**
 * Dual-protocol streaming adapter.
 *
 * Both A2A (default) and AG-UI protocols produce a common StreamEvent stream
 * that the REPL consumes protocol-agnostically.
 *
 * A2A:  JSON-RPC 2.0 via native fetch + SSE (POST to supervisor root)
 *       method: "message/stream" for streaming, "message/send" for non-streaming
 * AG-UI: @ag-ui/client to POST <streamEndpoint> (e.g. /api/agui/stream)
 *
 * Callers (runner.ts) resolve the correct endpoint via /.well-known/agent.json
 * discovery and pass it directly — no serverUrl-based construction here.
 */

import type { Agent } from "../agents/types.js";

// ---------------------------------------------------------------------------
// Common event types
// ---------------------------------------------------------------------------

export type StreamEventType = "token" | "started" | "done" | "error" | "tool" | "state";

export interface TokenEvent {
  type: "token";
  text: string;
}

export interface StartedEvent {
  type: "started";
  taskId?: string;
}

export interface DoneEvent {
  type: "done";
  response?: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export interface ToolEvent {
  type: "tool";
  name: string;
  input?: unknown;
  output?: unknown;
}

export interface StateEvent {
  type: "state";
  data: unknown;
}

export type StreamEvent =
  | TokenEvent
  | StartedEvent
  | DoneEvent
  | ErrorEvent
  | ToolEvent
  | StateEvent;

// ---------------------------------------------------------------------------
// StreamAdapter interface
// ---------------------------------------------------------------------------

export interface SendPayload {
  prompt: string;
  systemContext?: string;
  sessionId: string;
  agentName: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface StreamAdapter {
  /**
   * Connect to the agent and yield StreamEvents.
   */
  connect(payload: SendPayload): AsyncIterable<StreamEvent>;
}

// ---------------------------------------------------------------------------
// A2A adapter (JSON-RPC 2.0 — A2A protocol v0.3+)
// ---------------------------------------------------------------------------

/**
 * A2A protocol adapter using JSON-RPC 2.0 over native fetch + SSE.
 *
 * Sends: POST to the supervisor root with JSON-RPC envelope:
 *   { jsonrpc: "2.0", id, method: "message/stream", params: { message } }
 * Receives: SSE `data:` lines, each containing a JSON-RPC result with:
 *   - kind: "task"            → task submitted / state change
 *   - kind: "artifact-update" → streaming text chunks
 *   - kind: "status-update"   → completed / failed
 */
export class A2aAdapter implements StreamAdapter {
  constructor(
    private readonly agent: Agent,
    /** Base URL of the A2A supervisor (e.g. http://localhost:8000) */
    private readonly endpoint: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  async *connect(payload: SendPayload): AsyncIterable<StreamEvent> {
    const token = await this.getAccessToken();
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Strip /tasks/send suffix if present (legacy discovery docs may include it)
    const baseUrl = this.endpoint.replace(/\/tasks\/send\/?$/, "");

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: payload.sessionId,
      method: "message/stream",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: payload.prompt }],
          messageId,
        },
        metadata: {
          systemContext: payload.systemContext,
          agent: payload.agentName,
        },
      },
    });

    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body,
    });

    if (!res.ok) {
      yield {
        type: "error",
        message: `A2A request failed: ${res.status} ${res.statusText}`,
      };
      return;
    }

    if (!res.body) {
      yield { type: "error", message: "No response body from A2A endpoint" };
      return;
    }

    yield { type: "started" };
    yield* this.parseSSE(res.body);
  }

  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") {
            yield { type: "done", response: fullText };
            return;
          }

          let envelope: Record<string, unknown>;
          try {
            envelope = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }

          // JSON-RPC error
          if (envelope.error) {
            const err = envelope.error as Record<string, unknown>;
            yield { type: "error", message: String(err.message ?? "A2A error") };
            return;
          }

          const result = envelope.result as Record<string, unknown> | undefined;
          if (!result) continue;

          const mapped = this.mapResult(result);
          if (mapped) {
            if (mapped.type === "token") fullText += (mapped as TokenEvent).text;
            yield mapped;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done", response: fullText };
  }

  /**
   * Map a JSON-RPC result to a StreamEvent.
   *
   * Event kinds from the supervisor:
   *   - task (state: submitted)       → started
   *   - artifact-update               → token / tool
   *   - status-update (completed)     → done
   *   - status-update (failed)        → error
   */
  private mapResult(result: Record<string, unknown>): StreamEvent | null {
    const kind = result.kind as string | undefined;

    // ── task submitted ──────────────────────────────────────────────────
    if (kind === "task") {
      const status = result.status as Record<string, unknown> | undefined;
      const state = status?.state as string | undefined;
      if (state === "submitted") {
        return { type: "started", taskId: result.id as string | undefined };
      }
      if (state === "completed") return { type: "done" };
      if (state === "failed") {
        return { type: "error", message: String(status?.error ?? "Task failed") };
      }
      return null;
    }

    // ── artifact update (streaming text chunks) ─────────────────────────
    if (kind === "artifact-update") {
      const artifact = result.artifact as Record<string, unknown> | undefined;
      if (!artifact) return null;

      const name = artifact.name as string | undefined;
      const meta = artifact.metadata as Record<string, unknown> | undefined;

      // Tool notification events → map to tool events
      if (name === "tool_notification_start") {
        const source = meta?.sourceAgent as string | undefined;
        return { type: "tool", name: source ?? "unknown" };
      }
      if (name === "tool_notification_end") {
        return null; // suppress end notifications
      }

      // Skip final_result if we already streamed — it's a duplicate of the accumulated text
      if (name === "final_result") return null;

      // Text chunks from streaming_result
      const parts = artifact.parts as Array<Record<string, unknown>> | undefined;
      if (parts) {
        const texts = parts
          .filter((p) => p.kind === "text" && typeof p.text === "string")
          .map((p) => p.text as string);
        if (texts.length > 0) {
          return { type: "token", text: texts.join("") };
        }
      }
      return null;
    }

    // ── status update (terminal states) ─────────────────────────────────
    if (kind === "status-update") {
      const status = result.status as Record<string, unknown> | undefined;
      const state = status?.state as string | undefined;
      if (state === "completed") return { type: "done" };
      if (state === "failed") {
        return { type: "error", message: String(status?.error ?? "Task failed") };
      }
      return null;
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// AG-UI adapter
// ---------------------------------------------------------------------------

/**
 * AG-UI protocol adapter using @ag-ui/client.
 *
 * Sends: POST <serverUrl>/api/agui/stream
 * Receives: AG-UI SSE event stream.
 */
export class AguiAdapter implements StreamAdapter {
  constructor(
    private readonly agent: Agent,
    /** Full URL of the AG-UI stream endpoint (e.g. http://localhost:8000/api/agui/stream) */
    private readonly streamEndpoint: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  async *connect(payload: SendPayload): AsyncIterable<StreamEvent> {
    // Dynamically import @ag-ui/client to avoid startup cost when not needed
    const { HttpAgent } = await import("@ag-ui/client");
    const token = await this.getAccessToken();

    const agent = new HttpAgent({
      url: this.streamEndpoint,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    yield { type: "started" };
    let fullText = "";

    // Convert rxjs Observable to AsyncIterable via a queued subscription
    const observable = agent.run({
      threadId: payload.sessionId,
      runId: payload.sessionId,
      messages: [
        {
          role: "user",
          content: payload.prompt,
          id: payload.sessionId,
        },
      ],
      tools: [],
      context: [],
    } as Parameters<typeof agent.run>[0]);

    const queue: Array<StreamEvent | null> = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const subscription = observable.subscribe({
      next: (ev) => {
        const mapped = this.mapAguiEvent(ev as Record<string, unknown>);
        if (mapped) queue.push(mapped);
        resolve?.();
        resolve = null;
      },
      error: (err: unknown) => {
        queue.push({ type: "error", message: String(err) });
        done = true;
        resolve?.();
        resolve = null;
      },
      complete: () => {
        done = true;
        queue.push(null); // sentinel
        resolve?.();
        resolve = null;
      },
    });

    try {
      while (true) {
        if (queue.length === 0 && !done) {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
        if (queue.length === 0) break;
        const item = queue.shift() ?? null;
        if (item === null) break;
        if (item.type === "token") fullText += (item as TokenEvent).text;
        yield item;
      }
    } finally {
      subscription.unsubscribe();
    }

    yield { type: "done", response: fullText };
  }

  private mapAguiEvent(ev: Record<string, unknown>): StreamEvent | null {
    const type = ev.type as string | undefined;

    switch (type) {
      case "TEXT_MESSAGE_CHUNK":
        if (typeof ev.delta === "string") {
          return { type: "token", text: ev.delta };
        }
        break;
      case "RUN_STARTED":
        return { type: "started", taskId: (ev.runId as string | undefined) ?? undefined };
      case "RUN_FINISHED":
        return { type: "done" };
      case "RUN_ERROR":
        return { type: "error", message: String(ev.message ?? "AG-UI error") };
      case "TOOL_CALL_START":
        return { type: "tool", name: String(ev.toolCallName ?? "unknown") };
      case "STATE_SNAPSHOT":
      case "STATE_DELTA":
        return { type: "state", data: ev.snapshot ?? ev.delta };
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the appropriate StreamAdapter for the given protocol.
 *
 * @param protocol     "a2a" | "agui"
 * @param agent        The target CAIPE server agent
 * @param taskEndpoint Full URL for A2A tasks/send OR AG-UI stream endpoint
 * @param getAccessToken Async function returning a live Bearer token
 */
export function createAdapter(
  protocol: "a2a" | "agui",
  agent: Agent,
  taskEndpoint: string,
  getAccessToken: () => Promise<string>,
): StreamAdapter {
  if (protocol === "agui") {
    return new AguiAdapter(agent, taskEndpoint, getAccessToken);
  }
  return new A2aAdapter(agent, taskEndpoint, getAccessToken);
}
