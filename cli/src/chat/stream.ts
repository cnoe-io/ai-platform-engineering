/**
 * Dual-protocol streaming adapter.
 *
 * Both A2A (default) and AG-UI protocols produce a common StreamEvent stream
 * that the REPL consumes protocol-agnostically.
 *
 * A2A:  native fetch + EventSource to POST <serverUrl>/tasks/send (SSE)
 * AG-UI: @ag-ui/client to POST <serverUrl>/api/agui/stream (SSE)
 */

import type { Agent } from "../agents/types.js";
import { endpoints } from "../platform/config.js";

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
// A2A adapter
// ---------------------------------------------------------------------------

/**
 * A2A protocol adapter using native fetch + manual SSE parsing.
 *
 * Sends: POST <serverUrl>/tasks/send
 * Receives: SSE stream with A2A task lifecycle events.
 */
export class A2aAdapter implements StreamAdapter {
  constructor(
    private readonly agent: Agent,
    private readonly serverUrl: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  async *connect(payload: SendPayload): AsyncIterable<StreamEvent> {
    const ep = endpoints(this.serverUrl);
    const token = await this.getAccessToken();

    const body = JSON.stringify({
      id: payload.sessionId,
      message: {
        role: "user",
        parts: [{ type: "text", text: payload.prompt }],
      },
      metadata: {
        systemContext: payload.systemContext,
        agent: payload.agentName,
      },
    });

    const res = await fetch(ep.a2aTask, {
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

  private async *parseSSE(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<StreamEvent> {
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

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }

          const mapped = this.mapA2AEvent(event);
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

  private mapA2AEvent(event: Record<string, unknown>): StreamEvent | null {
    const status = event["status"] as Record<string, unknown> | undefined;
    const state = status?.["state"];

    // Text delta
    const message = status?.["message"] as Record<string, unknown> | undefined;
    const parts = message?.["parts"] as Array<Record<string, unknown>> | undefined;
    if (parts) {
      for (const part of parts) {
        if (part["type"] === "text" && typeof part["text"] === "string") {
          return { type: "token", text: part["text"] };
        }
      }
    }

    // Artifacts
    const artifact = event["artifact"] as Record<string, unknown> | undefined;
    if (artifact) {
      const parts2 = artifact["parts"] as Array<Record<string, unknown>> | undefined;
      if (parts2) {
        for (const part of parts2) {
          if (part["type"] === "text" && typeof part["text"] === "string") {
            return { type: "token", text: part["text"] };
          }
        }
      }
    }

    if (state === "completed") return { type: "done" };
    if (state === "failed") {
      const msg = status?.["error"] ?? "Task failed";
      return { type: "error", message: String(msg) };
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
    private readonly serverUrl: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  async *connect(payload: SendPayload): AsyncIterable<StreamEvent> {
    // Dynamically import @ag-ui/client to avoid startup cost when not needed
    const aguiMod = await import("@ag-ui/client");
    const ep = endpoints(this.serverUrl);
    const token = await this.getAccessToken();

    const client = new aguiMod.Client({
      url: ep.aguiStream,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    yield { type: "started" };
    let fullText = "";

    const events = client.run({
      messages: [
        {
          role: "user",
          content: payload.prompt,
        },
      ],
      context: payload.systemContext,
      agentName: payload.agentName,
      runId: payload.sessionId,
    });

    for await (const ev of events) {
      const mapped = this.mapAguiEvent(ev as Record<string, unknown>);
      if (mapped) {
        if (mapped.type === "token") fullText += (mapped as TokenEvent).text;
        yield mapped;
      }
    }

    yield { type: "done", response: fullText };
  }

  private mapAguiEvent(ev: Record<string, unknown>): StreamEvent | null {
    const type = ev["type"] as string | undefined;

    switch (type) {
      case "TEXT_MESSAGE_CHUNK":
        if (typeof ev["delta"] === "string") {
          return { type: "token", text: ev["delta"] };
        }
        break;
      case "RUN_STARTED":
        return { type: "started", taskId: ev["runId"] as string | undefined };
      case "RUN_FINISHED":
        return { type: "done" };
      case "RUN_ERROR":
        return { type: "error", message: String(ev["message"] ?? "AG-UI error") };
      case "TOOL_CALL_START":
        return { type: "tool", name: String(ev["toolCallName"] ?? "unknown") };
      case "STATE_SNAPSHOT":
      case "STATE_DELTA":
        return { type: "state", data: ev["snapshot"] ?? ev["delta"] };
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
 * @param protocol "a2a" | "agui"
 * @param agent    The target CAIPE server agent
 * @param serverUrl The CAIPE server base URL
 * @param getAccessToken Async function returning a live Bearer token
 */
export function createAdapter(
  protocol: "a2a" | "agui",
  agent: Agent,
  serverUrl: string,
  getAccessToken: () => Promise<string>,
): StreamAdapter {
  if (protocol === "agui") {
    return new AguiAdapter(agent, serverUrl, getAccessToken);
  }
  return new A2aAdapter(agent, serverUrl, getAccessToken);
}
