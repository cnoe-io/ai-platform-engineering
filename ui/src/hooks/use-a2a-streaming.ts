/**
 * Shared A2A Streaming Hook
 *
 * This hook encapsulates the A2A event handling logic from agent-forge
 * to ensure consistent behavior across all UIs (CAIPE UI, Agent-Forge, etc.)
 *
 * Key features:
 * - Accumulates ALL streaming content (never loses data)
 * - Properly handles partial_result and final_result artifacts
 * - Uses finishStreaming pattern like agent-forge
 * - Handles status-update completion signals
 */

import { useCallback, useRef } from "react";
import { A2AClient } from "@/lib/a2a-client";
import { A2AEvent } from "@/types/a2a";

export interface StreamingState {
  /** Accumulated text content - NEVER reset, accumulates ALL content */
  accumulatedText: string;
  /** Counter for debugging */
  eventCount: number;
  /** Whether a final/partial result was received */
  hasReceivedCompleteResult: boolean;
  /** Last event timestamp */
  lastEventTime: number;
  /** Task ID for cancellation */
  taskId?: string;
  /** Context ID for conversation continuity */
  contextId?: string;
}

export interface UseA2AStreamingConfig {
  endpoint: string;
  accessToken?: string;

  /** Called when streaming starts */
  onStreamStart?: () => void;

  /** Called for each event - receives parsed event */
  onEvent?: (event: A2AEvent, state: StreamingState) => void;

  /** Called when content accumulates - use for UI updates */
  onContentUpdate?: (content: string, state: StreamingState) => void;

  /** Called when final_result or partial_result is received */
  onCompleteResult?: (content: string, artifactName: string) => void;

  /** Called when streaming ends (for any reason) */
  onStreamEnd?: (state: StreamingState) => void;

  /** Called on error */
  onError?: (error: Error) => void;

  /** Throttle interval for content updates (default: 100ms) */
  updateThrottleMs?: number;
}

export interface UseA2AStreamingReturn {
  /** Send a message and stream the response */
  sendMessage: (message: string, contextId?: string) => Promise<void>;

  /** Cancel the current stream */
  cancel: () => void;

  /** Whether streaming is in progress */
  isStreaming: boolean;

  /** Current streaming state (ref for real-time access) */
  stateRef: React.RefObject<StreamingState>;
}

/**
 * Hook for handling A2A streaming with consistent behavior matching agent-forge
 */
export function useA2AStreaming(config: UseA2AStreamingConfig): UseA2AStreamingReturn {
  const clientRef = useRef<A2AClient | null>(null);
  const isStreamingRef = useRef(false);
  const stateRef = useRef<StreamingState>({
    accumulatedText: "",
    eventCount: 0,
    hasReceivedCompleteResult: false,
    lastEventTime: 0,
  });

  const lastUpdateTimeRef = useRef(0);
  const throttleMs = config.updateThrottleMs ?? 100;

  const resetState = useCallback(() => {
    stateRef.current = {
      accumulatedText: "",
      eventCount: 0,
      hasReceivedCompleteResult: false,
      lastEventTime: Date.now(),
    };
  }, []);

  const sendMessage = useCallback(async (message: string, contextId?: string) => {
    if (isStreamingRef.current) {
      console.warn("[useA2AStreaming] Already streaming, ignoring new message");
      return;
    }

    resetState();
    isStreamingRef.current = true;
    config.onStreamStart?.();

    const client = new A2AClient({
      endpoint: config.endpoint,
      accessToken: config.accessToken,
      onEvent: (event) => {
        const state = stateRef.current;
        state.eventCount++;
        state.lastEventTime = Date.now();

        const artifactName = event.artifact?.name || "";
        const content = event.displayContent || "";

        // Track context and task IDs
        if (event.contextId) state.contextId = event.contextId;
        if (event.taskId) state.taskId = event.taskId;

        // Notify raw event handler
        config.onEvent?.(event, state);

        // ═══════════════════════════════════════════════════════════════
        // PRIORITY 1: Handle final_result/partial_result IMMEDIATELY
        // (Matching agent-forge pattern)
        // ═══════════════════════════════════════════════════════════════
        if (artifactName === "final_result" || artifactName === "partial_result") {
          console.log(`[useA2AStreaming] 🎉 ${artifactName} received! ${content.length} chars`);

          if (content) {
            // Replace accumulated text with complete final content
            // (Agent-forge behavior: partial_result replaces accumulated text)
            state.accumulatedText = content;
            state.hasReceivedCompleteResult = true;

            config.onCompleteResult?.(content, artifactName);
            return;
          } else {
            console.error(`[useA2AStreaming] ❌ ${artifactName} has no content!`);
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // PRIORITY 2: Handle status-update with completed state
        // ═══════════════════════════════════════════════════════════════
        if (event.type === "status" && event.isFinal) {
          console.log(`[useA2AStreaming] 🏁 Stream complete (final status)`);
          // Don't update content here - let onStreamEnd handle finalization
          return;
        }

        // Skip events without content
        if (!content) return;

        // Skip tool notifications (handled separately by UI)
        if (event.type === "tool_start" || event.type === "tool_end") return;
        if (artifactName === "tool_notification_start" ||
            artifactName === "tool_notification_end" ||
            artifactName === "execution_plan_update" ||
            artifactName === "execution_plan_status_update") {
          return;
        }

        // Guard: Don't accumulate after receiving complete result
        if (state.hasReceivedCompleteResult) return;

        // ═══════════════════════════════════════════════════════════════
        // ACCUMULATE CONTENT (Agent-forge pattern)
        // ═══════════════════════════════════════════════════════════════
        if (event.type === "message" || event.type === "artifact") {
          if (artifactName === "streaming_result" || artifactName === "complete_result") {
            // Handle append flag properly (agent-forge behavior)
            if (event.shouldAppend === false) {
              // append=false means start fresh with this content
              state.accumulatedText = content;
            } else {
              // Append to accumulated text
              state.accumulatedText += content;
            }
          } else {
            // For other artifacts, always accumulate
            state.accumulatedText += content;
          }

          // Throttle UI updates
          const now = Date.now();
          if (now - lastUpdateTimeRef.current >= throttleMs) {
            lastUpdateTimeRef.current = now;
            config.onContentUpdate?.(state.accumulatedText, state);
          }
        }
      },
      onError: (error) => {
        console.error("[useA2AStreaming] Stream error:", error);
        config.onError?.(error);
        isStreamingRef.current = false;
        config.onStreamEnd?.(stateRef.current);
      },
      onComplete: () => {
        const state = stateRef.current;
        console.log(`[useA2AStreaming] 🏁 STREAM COMPLETE - ${state.eventCount} events`);

        // ═══════════════════════════════════════════════════════════════
        // FINALIZE (Agent-forge's finishStreamingMessage pattern)
        // ═══════════════════════════════════════════════════════════════

        // If we didn't receive a final_result but have accumulated content,
        // use the accumulated content as the final result
        if (!state.hasReceivedCompleteResult && state.accumulatedText.length > 0) {
          console.log(`[useA2AStreaming] ⚠️ No final_result - using accumulated content (${state.accumulatedText.length} chars)`);
          config.onCompleteResult?.(state.accumulatedText, "accumulated_fallback");
        }

        isStreamingRef.current = false;
        config.onStreamEnd?.(state);
      },
    });

    clientRef.current = client;

    try {
      const reader = await client.sendMessage(message, contextId);

      // Consume the stream (events are handled by onEvent callback)
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (error) {
      console.error("[useA2AStreaming] Failed to send message:", error);
      config.onError?.(error as Error);
      isStreamingRef.current = false;
      config.onStreamEnd?.(stateRef.current);
    }
  }, [config, resetState, throttleMs]);

  const cancel = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.abort();
      clientRef.current = null;
    }
    isStreamingRef.current = false;
  }, []);

  return {
    sendMessage,
    cancel,
    isStreaming: isStreamingRef.current,
    stateRef,
  };
}

/**
 * Helper: Process artifact text parts (matches agent-forge pattern)
 * Handles both direct text and nested root.text structures
 */
export function extractArtifactText(parts: unknown[]): string {
  if (!parts || !Array.isArray(parts)) return "";

  return parts
    .filter((p: unknown) => {
      const part = p as { kind?: string; root?: { kind?: string } };
      return part.kind === "text" || part.root?.kind === "text" || !part.kind;
    })
    .map((p: unknown) => {
      const part = p as { text?: string; root?: { text?: string } };
      return part.text || part.root?.text || "";
    })
    .join("");
}
