/**
 * Custom SSE protocol adapter.
 *
 * Consumes the legacy custom SSE format (event types: content, tool_start,
 * tool_end, input_required, warning, error, done) and translates them into
 * protocol-agnostic StreamCallbacks.
 *
 * Refactored from DynamicAgentClient.sendMessageStream + mapToStreamEvent.
 */

import type { StreamAdapter } from "./adapter";
import type { StreamCallbacks, StreamParams, RawStreamEvent } from "./callbacks";
import type { InputFieldDefinition } from "@/components/dynamic-agents/sse-types";
import { parseSSEStream, type RawSSEEvent } from "./parse-sse";

// ═══════════════════════════════════════════════════════════════
// CustomStreamAdapter
// ═══════════════════════════════════════════════════════════════

export class CustomStreamAdapter implements StreamAdapter {
  private baseUrl: string;
  private accessToken?: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, accessToken?: string) {
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async cancelStream(conversationId: string, agentId: string): Promise<boolean> {
    this.abort();

    const cancelUrl = `${this.baseUrl}/cancel`;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.accessToken) {
        headers["Authorization"] = `Bearer ${this.accessToken}`;
      }

      const response = await fetch(cancelUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ agent_id: agentId, session_id: conversationId }),
      });

      if (!response.ok) {
        console.error(`[CustomAdapter] Cancel failed: ${response.status}`);
        return false;
      }

      const result = await response.json();
      return result.cancelled ?? false;
    } catch (error) {
      console.error("[CustomAdapter] Cancel error:", error);
      return false;
    }
  }

  async streamMessage(params: StreamParams, callbacks: StreamCallbacks): Promise<void> {
    const url = `${this.baseUrl}/start-stream`;
    const body = JSON.stringify({
      message: params.message,
      conversation_id: params.conversationId,
      agent_id: params.agentId,
    });

    await this._stream(url, body, callbacks);
  }

  async resumeStream(params: StreamParams, callbacks: StreamCallbacks): Promise<void> {
    const url = `${this.baseUrl}/resume-stream`;
    const body = JSON.stringify({
      conversation_id: params.conversationId,
      agent_id: params.agentId,
      form_data: params.formData,
    });

    await this._stream(url, body, callbacks);
  }

  // ── Private: shared stream loop ────────────────────────────

  private async _stream(url: string, body: string, callbacks: StreamCallbacks): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Session expired: Your authentication token has expired. " +
            "Please save your work and log in again.",
          );
        }
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `HTTP error: ${response.status} ${response.statusText}. ${errorBody || "(empty)"}`,
        );
      }

      for await (const raw of parseSSEStream(response)) {
        this._emitRawEvent(raw, callbacks);
        const terminal = this._dispatchEvent(raw, callbacks);
        if (terminal) break;
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // Client-side abort — not an error
        return;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  // ── Private: event dispatch ────────────────────────────────

  /**
   * Dispatch a single raw SSE event to the appropriate callback.
   * Returns true if this is a terminal event (stream should stop).
   */
  private _dispatchEvent(raw: RawSSEEvent, callbacks: StreamCallbacks): boolean {
    const { event, data } = raw;

    try {
      switch (event) {
        case "content": {
          const parsed = JSON.parse(data);
          callbacks.onContent?.(parsed.text ?? "", parsed.namespace ?? []);
          return false;
        }

        case "tool_start": {
          const parsed = JSON.parse(data);
          callbacks.onToolStart?.(
            parsed.tool_call_id,
            parsed.tool_name,
            parsed.args,
            parsed.namespace ?? [],
          );
          return false;
        }

        case "tool_end": {
          const parsed = JSON.parse(data);
          callbacks.onToolEnd?.(
            parsed.tool_call_id,
            undefined, // custom protocol doesn't include tool_name in tool_end
            parsed.error,
            parsed.namespace ?? [],
          );
          return false;
        }

        case "input_required": {
          const parsed = JSON.parse(data);
          callbacks.onInputRequired?.(
            parsed.interrupt_id,
            parsed.prompt,
            parsed.fields as InputFieldDefinition[],
            parsed.agent,
          );
          return true; // terminal — stream pauses for user input
        }

        case "warning": {
          const parsed = JSON.parse(data);
          callbacks.onWarning?.(parsed.message, parsed.namespace ?? []);
          return false;
        }

        case "done": {
          callbacks.onDone?.();
          return true;
        }

        case "error": {
          const parsed = JSON.parse(data);
          callbacks.onError?.(parsed.error || "Unknown error");
          return true;
        }

        default:
          // Unknown event type — skip
          return false;
      }
    } catch (e) {
      console.error(`[CustomAdapter] Failed to parse ${event} data:`, e, data);
      return false;
    }
  }

  /**
   * Emit a raw event for persistence / replay.
   */
  private _emitRawEvent(raw: RawSSEEvent, callbacks: StreamCallbacks): void {
    if (!callbacks.onRawEvent) return;

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(raw.data);
    } catch {
      parsedData = raw.data;
    }

    const rawEvent: RawStreamEvent = {
      type: raw.event,
      data: parsedData,
      timestamp: Date.now(),
    };
    callbacks.onRawEvent(rawEvent);
  }
}
