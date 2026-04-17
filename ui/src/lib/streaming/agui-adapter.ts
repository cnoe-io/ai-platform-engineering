/**
 * AG-UI protocol adapter.
 *
 * Consumes the AG-UI SSE format (RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*,
 * RUN_FINISHED, RUN_ERROR, CUSTOM) and translates them into protocol-agnostic
 * StreamCallbacks.
 *
 * Owns AG-UI-specific state:
 * - currentNamespace: set by CUSTOM(NAMESPACE_CONTEXT), applied to subsequent events
 * - toolCallIdToName: maps TOOL_CALL_START ids to names for TOOL_CALL_END lookup
 * - runId: captured from RUN_STARTED for interrupt correlation
 *
 * Routes (flat, conversation_id + protocol in body):
 *   POST /api/v1/chat/stream/start
 *   POST /api/v1/chat/stream/resume
 *   POST /api/v1/chat/stream/cancel
 */

import type { StreamAdapter } from "./adapter";
import type { StreamCallbacks, StreamParams, RawStreamEvent } from "./callbacks";
import type { InputFieldDefinition } from "@/components/dynamic-agents/sse-types";
import { parseSSEStream, type RawSSEEvent } from "./parse-sse";

/** Flat API route prefix for chat streaming. */
const STREAM_BASE = "/api/v1/chat/stream";
const CANCEL_URL = `${STREAM_BASE}/cancel`;

// ═══════════════════════════════════════════════════════════════
// AG-UI event type constants
// ═══════════════════════════════════════════════════════════════

const AGUI = {
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  TOOL_CALL_START: "TOOL_CALL_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",
  CUSTOM: "CUSTOM",
} as const;

// CUSTOM event names
const CUSTOM_NAMESPACE_CONTEXT = "NAMESPACE_CONTEXT";
const CUSTOM_WARNING = "WARNING";
const CUSTOM_TOOL_ERROR = "TOOL_ERROR";
// Supervisor legacy HITL format (fallback)
const CUSTOM_INPUT_REQUIRED = "INPUT_REQUIRED";

// ═══════════════════════════════════════════════════════════════
// AGUIStreamAdapter
// ═══════════════════════════════════════════════════════════════

export class AGUIStreamAdapter implements StreamAdapter {
  private accessToken?: string;
  private abortController: AbortController | null = null;

  // ── Protocol state (reset per stream) ──────────────────────
  private currentNamespace: string[] = [];
  private toolCallIdToName = new Map<string, string>();
  private runId = "";

  constructor(accessToken?: string) {
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

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.accessToken) {
        headers["Authorization"] = `Bearer ${this.accessToken}`;
      }

      const response = await fetch(CANCEL_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          conversation_id: conversationId,
          agent_id: agentId,
        }),
      });

      if (!response.ok) {
        console.error(`[AGUIAdapter] Cancel failed: ${response.status}`);
        return false;
      }

      const result = await response.json();
      return result.cancelled ?? false;
    } catch (error) {
      console.error("[AGUIAdapter] Cancel error:", error);
      return false;
    }
  }

  async streamMessage(params: StreamParams, callbacks: StreamCallbacks): Promise<void> {
    const url = `${STREAM_BASE}/start`;
    const body = JSON.stringify({
      message: params.message,
      conversation_id: params.conversationId,
      agent_id: params.agentId,
      protocol: "agui",
      ...(params.clientContext && { client_context: params.clientContext }),
    });

    await this._stream(url, body, callbacks);
  }

  async resumeStream(params: StreamParams, callbacks: StreamCallbacks): Promise<void> {
    const url = `${STREAM_BASE}/resume`;
    const body = JSON.stringify({
      conversation_id: params.conversationId,
      agent_id: params.agentId,
      form_data: params.formData,
      protocol: "agui",
      ...(params.clientContext && { client_context: params.clientContext }),
    });

    await this._stream(url, body, callbacks);
  }

  // ── Private: shared stream loop ────────────────────────────

  private async _stream(url: string, body: string, callbacks: StreamCallbacks): Promise<void> {
    // Reset protocol state for each stream
    this.currentNamespace = [];
    this.toolCallIdToName.clear();
    this.runId = "";

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
   * Returns true if this is a terminal event.
   */
  private _dispatchEvent(raw: RawSSEEvent, callbacks: StreamCallbacks): boolean {
    // AG-UI uses the event: field as the event type
    const eventType = raw.event;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      console.error(`[AGUIAdapter] Failed to parse event data:`, raw.data);
      return false;
    }

    switch (eventType) {
      // ── Lifecycle ──────────────────────────────────────────
      case AGUI.RUN_STARTED:
        this.runId = (parsed.runId as string) || "";
        return false;

      case AGUI.RUN_FINISHED:
        return this._handleRunFinished(parsed, callbacks);

      case AGUI.RUN_ERROR:
        callbacks.onError?.((parsed.message as string) || "Unknown error");
        return true;

      // ── Text messages ──────────────────────────────────────
      case AGUI.TEXT_MESSAGE_START:
        // Internal state only — adapter tracks messageId
        return false;

      case AGUI.TEXT_MESSAGE_CONTENT:
        callbacks.onContent?.(
          (parsed.delta as string) || "",
          this.currentNamespace,
        );
        return false;

      case AGUI.TEXT_MESSAGE_END:
        // Internal state only
        return false;

      // ── Tool calls ─────────────────────────────────────────
      case AGUI.TOOL_CALL_START: {
        const toolCallId = parsed.toolCallId as string;
        const toolCallName = parsed.toolCallName as string;
        this.toolCallIdToName.set(toolCallId, toolCallName);
        callbacks.onToolStart?.(
          toolCallId,
          toolCallName,
          undefined, // args come in TOOL_CALL_ARGS, not needed for timeline
          this.currentNamespace,
        );
        return false;
      }

      case AGUI.TOOL_CALL_ARGS:
        // Args arrive separately in AG-UI. Not needed for timeline rendering
        // today. Could be surfaced via a future onToolArgs callback if needed.
        return false;

      case AGUI.TOOL_CALL_END: {
        const toolCallId = parsed.toolCallId as string;
        const toolName = this.toolCallIdToName.get(toolCallId);
        callbacks.onToolEnd?.(
          toolCallId,
          toolName,
          undefined, // no error — errors come via CUSTOM(TOOL_ERROR)
          this.currentNamespace,
        );
        return false;
      }

      // ── Custom events ──────────────────────────────────────
      case AGUI.CUSTOM:
        return this._handleCustom(parsed, callbacks);

      default:
        return false;
    }
  }

  /**
   * Handle RUN_FINISHED — success or interrupt.
   */
  private _handleRunFinished(
    parsed: Record<string, unknown>,
    callbacks: StreamCallbacks,
  ): boolean {
    const outcome = parsed.outcome as string;

    if (outcome === "interrupt") {
      const interrupt = parsed.interrupt as Record<string, unknown> | undefined;
      if (interrupt) {
        const payload = interrupt.payload as Record<string, unknown> | undefined;
        callbacks.onInputRequired?.(
          interrupt.id as string,
          (payload?.prompt as string) || "",
          (payload?.fields as InputFieldDefinition[]) || [],
          (payload?.agent as string) || "",
        );
      }
      return true;
    }

    // outcome === "success" or any other value
    callbacks.onDone?.();
    return true;
  }

  /**
   * Handle CUSTOM events (NAMESPACE_CONTEXT, WARNING, TOOL_ERROR, INPUT_REQUIRED).
   */
  private _handleCustom(
    parsed: Record<string, unknown>,
    callbacks: StreamCallbacks,
  ): boolean {
    const name = parsed.name as string;
    const value = parsed.value as Record<string, unknown> | undefined;

    switch (name) {
      case CUSTOM_NAMESPACE_CONTEXT:
        // Update namespace for subsequent events
        this.currentNamespace = (value?.namespace as string[]) || [];
        return false;

      case CUSTOM_WARNING:
        callbacks.onWarning?.(
          (value?.message as string) || "",
          (value?.namespace as string[]) || this.currentNamespace,
        );
        return false;

      case CUSTOM_TOOL_ERROR: {
        const toolCallId = value?.tool_call_id as string;
        const toolName = this.toolCallIdToName.get(toolCallId);
        callbacks.onToolEnd?.(
          toolCallId,
          toolName,
          value?.error as string,
          this.currentNamespace,
        );
        return false;
      }

      case CUSTOM_INPUT_REQUIRED: {
        // Supervisor legacy HITL format — CUSTOM("INPUT_REQUIRED")
        // Handles both field shapes for forward/backward compat
        callbacks.onInputRequired?.(
          (value?.interrupt_id as string) || "",
          (value?.prompt as string) || (value?.message as string) || "",
          (value?.fields as InputFieldDefinition[]) || [],
          (value?.agent as string) || "",
        );
        return true;
      }

      default:
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
