"use client";

/**
 * useAGUIStream — React hook for AG-UI protocol streaming.
 *
 * Wraps HttpAgent from @ag-ui/client to:
 *   - Create an agent for the given endpoint + auth
 *   - Stream events and route them to chat store actions
 *   - Handle cancellation via the chat store's AbortableClient interface
 *
 * This hook is intentionally side-effect-free with respect to React rendering:
 * all state mutations go through the chat store. Components subscribe to the
 * store directly; this hook is only responsible for driving the stream.
 */

import { useCallback, useRef } from "react";
import { EventType } from "@ag-ui/core";
import type {
  BaseEvent,
  TextMessageContentEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
  CustomEvent,
  RunFinishedEvent,
  RunErrorEvent,
} from "@ag-ui/core";
import { createCAIPEAgent, AGUIAbortableClient } from "./client";
import type { SendMessageParams, InputRequiredPayload } from "./types";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Apply a JSON Patch array to an object (RFC 6902 subset: add/replace/remove).
 * Used to apply STATE_DELTA patches to the running plan state.
 */
function applyJsonPatch(target: any, patch: Array<{ op: string; path: string; value?: any }>): any {
  // Work on a shallow clone so we don't mutate the original reference
  let result = Array.isArray(target) ? [...target] : { ...target };
  for (const op of patch) {
    const parts = op.path.replace(/^\//, "").split("/");
    if (parts.length === 0) continue;

    if (op.op === "replace" || op.op === "add") {
      let cursor: any = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        cursor[key] = Array.isArray(cursor[key]) ? [...cursor[key]] : { ...cursor[key] };
        cursor = cursor[key];
      }
      cursor[parts[parts.length - 1]] = op.value;
    } else if (op.op === "remove") {
      let cursor: any = result;
      for (let i = 0; i < parts.length - 1; i++) {
        cursor = cursor[parts[i]];
        if (!cursor) break;
      }
      if (cursor) delete cursor[parts[parts.length - 1]];
    }
  }
  return result;
}

// ── Hook result type ──────────────────────────────────────────────────────────

export interface UseAGUIStreamResult {
  /**
   * Start streaming a message for the given conversation.
   * Returns the same promise shape as the old SSEClient-based sendMessage.
   */
  stream: (params: SendMessageParams & {
    convId: string;
    assistantMsgId: string;
    turnId: string;
    onTextDelta: (delta: string) => void;
    onToolStart: (toolCallId: string, toolName: string) => void;
    onToolEnd: (toolCallId: string, toolName: string) => void;
    onStateDelta: (patch: Array<{ op: string; path: string; value?: any }>) => void;
    onStateSnapshot: (snapshot: Record<string, unknown>) => void;
    onInputRequired: (payload: InputRequiredPayload) => void;
    onDone: () => void;
    onError: (message: string) => void;
    onSetAbortable: (client: AGUIAbortableClient) => void;
  }) => Promise<void>;
}

/**
 * React hook that provides an AG-UI streaming function.
 *
 * The caller is responsible for wiring the callbacks to their store actions.
 * This separation keeps the hook testable and decoupled from Zustand.
 */
export function useAGUIStream(): UseAGUIStreamResult {
  // Keep a ref to the current agent so we can cancel mid-stream
  const agentRef = useRef<ReturnType<typeof createCAIPEAgent> | null>(null);

  const stream = useCallback(async (params: Parameters<UseAGUIStreamResult["stream"]>[0]) => {
    const {
      endpoint = "/api/chat/stream",
      accessToken,
      convId,
      assistantMsgId,
      turnId,
      message,
      onTextDelta,
      onToolStart,
      onToolEnd,
      onStateDelta,
      onStateSnapshot,
      onInputRequired,
      onDone,
      onError,
      onSetAbortable,
    } = params;

    // Abort any previous agent
    if (agentRef.current) {
      agentRef.current.abortRun();
    }

    const agent = createCAIPEAgent({
      endpoint,
      accessToken,
      threadId: convId,
    });
    agentRef.current = agent;

    // Expose abort capability to the store immediately
    onSetAbortable(new AGUIAbortableClient(agent));

    // Build the AG-UI RunAgentInput
    const runInput = {
      threadId: convId,
      runId: turnId,
      messages: [
        {
          id: `user-${turnId}`,
          role: "user" as const,
          content: message,
        },
      ],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    };

    // Track active tool calls (toolCallId → toolName) for onToolEnd lookup
    const activeToolCalls = new Map<string, string>();

    return new Promise<void>((resolve, reject) => {
      const observable = agent.run(runInput);

      const subscription = observable.subscribe({
        next(event: BaseEvent) {
          switch (event.type) {
            case EventType.TEXT_MESSAGE_CONTENT: {
              const e = event as TextMessageContentEvent;
              if (e.delta) onTextDelta(e.delta);
              break;
            }

            case EventType.TOOL_CALL_START: {
              const e = event as ToolCallStartEvent;
              const name = e.toolCallName ?? "";
              activeToolCalls.set(e.toolCallId, name);
              onToolStart(e.toolCallId, name);
              break;
            }

            case EventType.TOOL_CALL_END: {
              const e = event as ToolCallEndEvent;
              const name = activeToolCalls.get(e.toolCallId) ?? e.toolCallId;
              activeToolCalls.delete(e.toolCallId);
              onToolEnd(e.toolCallId, name);
              break;
            }

            case EventType.STATE_DELTA: {
              const e = event as StateDeltaEvent;
              if (Array.isArray(e.delta) && e.delta.length > 0) {
                onStateDelta(e.delta as Array<{ op: string; path: string; value?: any }>);
              }
              break;
            }

            case EventType.STATE_SNAPSHOT: {
              const e = event as StateSnapshotEvent;
              if (e.snapshot && typeof e.snapshot === "object") {
                onStateSnapshot(e.snapshot as Record<string, unknown>);
              }
              break;
            }

            case EventType.CUSTOM: {
              const e = event as CustomEvent;
              if (e.name === "INPUT_REQUIRED") {
                onInputRequired(e.value as InputRequiredPayload);
              }
              break;
            }

            case EventType.RUN_FINISHED: {
              onDone();
              break;
            }

            case EventType.RUN_ERROR: {
              const e = event as RunErrorEvent;
              onError(e.message ?? "Stream error");
              break;
            }

            default:
              break;
          }
        },
        error(err: Error) {
          if (err.name === "AbortError") {
            // Cancellation is handled by the store (marks message as cancelled)
            resolve();
          } else {
            onError(err.message ?? "Streaming failed");
            reject(err);
          }
        },
        complete() {
          resolve();
        },
      });

      // Store subscription for potential early cleanup (not strictly necessary
      // since agent.abortRun() triggers the error path above, but good hygiene).
      agentRef.current = agent;
      // Unsubscribe when the agent ref is replaced on next call
      return () => subscription.unsubscribe();
    });
  }, []);

  return { stream };
}

// ── Utility: exported for chat-store use without React ────────────────────────

/**
 * Non-hook version of the streamer — for use inside Zustand store actions
 * where hooks are not available.
 *
 * Returns an AbortableClient synchronously (before the stream starts), and
 * returns a Promise that resolves when the stream ends.
 */
export function streamAGUIEvents(params: {
  endpoint: string;
  accessToken?: string;
  convId: string;
  assistantMsgId: string;
  turnId: string;
  message: string;
  onTextDelta: (delta: string) => void;
  onToolStart: (toolCallId: string, toolName: string) => void;
  onToolEnd: (toolCallId: string, toolName: string) => void;
  onStateDelta: (patch: Array<{ op: string; path: string; value?: any }>) => void;
  onStateSnapshot: (snapshot: Record<string, unknown>) => void;
  onInputRequired: (payload: InputRequiredPayload) => void;
  onDone: () => void;
  onError: (message: string) => void;
}): { abortableClient: AGUIAbortableClient; streamPromise: Promise<void> } {
  const {
    endpoint,
    accessToken,
    convId,
    turnId,
    message,
    onTextDelta,
    onToolStart,
    onToolEnd,
    onStateDelta,
    onStateSnapshot,
    onInputRequired,
    onDone,
    onError,
  } = params;

  const agent = createCAIPEAgent({
    endpoint,
    accessToken,
    threadId: convId,
  });

  const abortableClient = new AGUIAbortableClient(agent);

  const runInput = {
    threadId: convId,
    runId: turnId,
    messages: [
      {
        id: `user-${turnId}`,
        role: "user" as const,
        content: message,
      },
    ],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };

  const activeToolCalls = new Map<string, string>();

  const streamPromise = new Promise<void>((resolve, reject) => {
    const observable = agent.run(runInput);

    observable.subscribe({
      next(event: BaseEvent) {
        switch (event.type) {
          case EventType.TEXT_MESSAGE_CONTENT: {
            const e = event as TextMessageContentEvent;
            if (e.delta) onTextDelta(e.delta);
            break;
          }

          case EventType.TOOL_CALL_START: {
            const e = event as ToolCallStartEvent;
            const name = e.toolCallName ?? "";
            activeToolCalls.set(e.toolCallId, name);
            onToolStart(e.toolCallId, name);
            break;
          }

          case EventType.TOOL_CALL_END: {
            const e = event as ToolCallEndEvent;
            const name = activeToolCalls.get(e.toolCallId) ?? e.toolCallId;
            activeToolCalls.delete(e.toolCallId);
            onToolEnd(e.toolCallId, name);
            break;
          }

          case EventType.STATE_DELTA: {
            const e = event as StateDeltaEvent;
            if (Array.isArray(e.delta) && e.delta.length > 0) {
              onStateDelta(e.delta as Array<{ op: string; path: string; value?: any }>);
            }
            break;
          }

          case EventType.STATE_SNAPSHOT: {
            const e = event as StateSnapshotEvent;
            if (e.snapshot && typeof e.snapshot === "object") {
              onStateSnapshot(e.snapshot as Record<string, unknown>);
            }
            break;
          }

          case EventType.CUSTOM: {
            const e = event as CustomEvent;
            if (e.name === "INPUT_REQUIRED") {
              onInputRequired(e.value as InputRequiredPayload);
            }
            break;
          }

          case EventType.RUN_FINISHED: {
            onDone();
            break;
          }

          case EventType.RUN_ERROR: {
            const e = event as RunErrorEvent;
            onError(e.message ?? "Stream error");
            break;
          }

          default:
            break;
        }
      },
      error(err: Error) {
        if (err.name === "AbortError") {
          resolve();
        } else {
          onError(err.message ?? "Streaming failed");
          reject(err);
        }
      },
      complete() {
        resolve();
      },
    });
  });

  return { abortableClient, streamPromise };
}

// Re-export applyJsonPatch for use in the chat store when handling STATE_DELTA
export { applyJsonPatch };
