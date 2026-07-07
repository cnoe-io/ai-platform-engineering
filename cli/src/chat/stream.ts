/**
 * AG-UI streaming adapter for dynamic agents.
 *
 * Calls POST <authUrl>/api/v1/chat/stream/start with body:
 *   { message, conversation_id, agent_id, protocol: "agui" }
 *
 * Receives AG-UI SSE events and maps them to common StreamEvents consumed
 * by the REPL and headless runner.
 */
// assisted-by claude code claude-sonnet-4-6

import type { Agent } from "../agents/types.js";

// ---------------------------------------------------------------------------
// Common event types
// ---------------------------------------------------------------------------

export type StreamEventType =
  | "token"
  | "started"
  | "done"
  | "error"
  | "interrupted"
  | "tool"
  | "state";

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

/** Agent paused for human input — not a failure; user should reply in the same session. */
export interface InterruptedEvent {
  type: "interrupted";
  reason?: string;
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
  | InterruptedEvent
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
// AG-UI adapter — direct fetch to /api/v1/chat/stream/start
// ---------------------------------------------------------------------------

/**
 * Calls the dynamic agents streaming endpoint via the caipe-ui BFF.
 *
 * Body: { message, conversation_id, agent_id, protocol: "agui" }
 * Events: AG-UI SSE — RUN_STARTED, TEXT_MESSAGE_CONTENT, TOOL_CALL_START,
 *         TOOL_CALL_END, RUN_FINISHED, RUN_ERROR, CUSTOM
 */
export class AguiAdapter implements StreamAdapter {
  // Maps local sessionId → server-assigned conversation _id
  private readonly conversationIds = new Map<string, string>();

  constructor(
    private readonly agent: Agent,
    /** Full URL of the stream endpoint (e.g. http://localhost:3000/api/v1/chat/stream/start) */
    private readonly streamEndpoint: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  /**
   * Ensure the conversation exists in the BFF before streaming.
   * Returns the server-assigned conversation _id to use in subsequent stream calls.
   */
  private async ensureConversation(
    sessionId: string,
    agentId: string,
    token: string,
  ): Promise<string> {
    const cached = this.conversationIds.get(sessionId);
    if (cached) return cached;

    // Derive conversations URL from stream endpoint:
    // http://localhost:3000/api/v1/chat/stream/start → http://localhost:3000/api/chat/conversations
    const base = this.streamEndpoint.replace(/\/api\/v1\/chat\/stream\/start$/, "");
    const url = `${base}/api/chat/conversations`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "CLI session",
          client_type: "cli",
          agent_id: agentId,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to create conversation (${res.status}): ${text}`);
      }
      const json = (await res.json()) as { data?: { conversation?: { _id?: string } } };
      const serverId = json?.data?.conversation?._id;
      if (!serverId) throw new Error("Server did not return conversation _id");
      this.conversationIds.set(sessionId, serverId);
      return serverId;
    } catch (err) {
      throw new Error(
        `Conversation setup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async *connect(payload: SendPayload): AsyncIterable<StreamEvent> {
    const token = await this.getAccessToken();
    const agentId = this.agent.name === "default" ? payload.agentName : this.agent.name;

    let conversationId: string;
    try {
      conversationId = await this.ensureConversation(payload.sessionId, agentId, token);
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }

    const body = JSON.stringify({
      message: payload.prompt,
      conversation_id: conversationId,
      agent_id: agentId,
      protocol: "agui",
    });

    const res = await fetch(this.streamEndpoint, {
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
        message: `Stream request failed: ${res.status} ${res.statusText}`,
      };
      return;
    }

    if (!res.body) {
      yield { type: "error", message: "No response body" };
      return;
    }

    yield { type: "started" };
    yield* this.parseSSE(res.body);
  }

  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    // Current SSE frame fields
    let eventType = "";
    let dataLines: string[] = [];
    let fullText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          } else if (line === "") {
            // Blank line — dispatch accumulated frame
            if (dataLines.length > 0) {
              const raw = dataLines.join("\n");
              dataLines = [];
              const et = eventType;
              eventType = "";

              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(raw) as Record<string, unknown>;
              } catch {
                continue;
              }

              const ev = this.mapEvent(et || (parsed.type as string) || "", parsed);
              if (ev) {
                if (ev.type === "token") fullText += (ev as TokenEvent).text;
                yield ev;
                if (ev.type === "done" || ev.type === "error") return;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done", response: fullText };
  }

  private mapEvent(eventType: string, parsed: Record<string, unknown>): StreamEvent | null {
    switch (eventType) {
      case "RUN_STARTED":
        return { type: "started", taskId: (parsed.runId as string | undefined) ?? undefined };

      case "TEXT_MESSAGE_START":
      case "TEXT_MESSAGE_END":
        return null;

      case "TEXT_MESSAGE_CONTENT":
        return { type: "token", text: (parsed.delta as string) ?? "" };

      case "TOOL_CALL_START":
        return {
          type: "tool",
          name: (parsed.toolCallName as string) ?? "unknown",
        };

      case "TOOL_CALL_ARGS":
      case "TOOL_CALL_RESULT":
        return null;

      case "TOOL_CALL_END":
        return null;

      case "RUN_FINISHED": {
        const outcome = parsed.outcome as string | undefined;
        if (outcome === "interrupt") {
          const interrupt = parsed.interrupt as Record<string, unknown> | undefined;
          const reason = interrupt?.reason as string | undefined;
          return { type: "interrupted", reason };
        }
        return { type: "done" };
      }

      case "RUN_ERROR":
        return {
          type: "error",
          message: (parsed.message as string) ?? "Unknown error",
        };

      case "CUSTOM": {
        const name = parsed.name as string | undefined;
        if (name === "WARNING") {
          const val = parsed.value as Record<string, unknown> | undefined;
          // Emit warnings as tokens so they appear inline
          return { type: "token", text: `\n> ⚠ ${(val?.message as string) ?? ""}` };
        }
        if (name === "INPUT_REQUIRED") {
          return { type: "interrupted" };
        }
        return null;
      }

      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an AG-UI StreamAdapter.
 *
 * @param agent        The target CAIPE server agent
 * @param streamEndpoint Full URL of the stream/start endpoint
 * @param getAccessToken Async function returning a live Bearer token
 */
export function createAdapter(
  agent: Agent,
  streamEndpoint: string,
  getAccessToken: () => Promise<string>,
): StreamAdapter {
  return new AguiAdapter(agent, streamEndpoint, getAccessToken);
}
