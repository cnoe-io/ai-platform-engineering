/**
 * useAgentTimeline Hook
 *
 * Transforms SSE events into an interleaved timeline for the AgentTimeline component.
 * This hook processes events through TimelineManager and memoizes the output.
 *
 * Usage:
 * const { data } = useAgentTimeline(turnEvents, isStreaming);
 * <AgentTimeline data={data} ... />
 */

import { useMemo, useRef } from "react";
import { TimelineManager, createTimelineManager } from "@/lib/da-timeline-manager";
import type { TimelineData, StatusType } from "@/types/dynamic-agent-timeline";
import type {
  StreamEvent,
  ToolStartEventData,
  ToolEndEventData,
} from "@/components/dynamic-agents/sse-types";
import { isToolStartData } from "@/components/dynamic-agents/sse-types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface UseAgentTimelineResult {
  /** Interleaved timeline data for rendering */
  data: TimelineData;
}

// ═══════════════════════════════════════════════════════════════
// Helper: Empty data for initial state
// ═══════════════════════════════════════════════════════════════

const EMPTY_DATA: TimelineData = {
  segments: [],
  finalAnswer: null,
  isStreaming: false,
  hasTools: false,
};

// ═══════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════

/**
 * Transform SSE events into interleaved timeline data.
 *
 * @param events - SSE events for the current message turn
 * @param isStreaming - Whether the stream is still active
 * @param turnStatus - Status to show when finalized: "done", "interrupted", or "waiting_for_input"
 * @returns Interleaved timeline data for AgentTimeline
 */
export function useAgentTimeline(
  events: StreamEvent[],
  isStreaming: boolean,
  turnStatus?: StatusType
): UseAgentTimelineResult {
  // Keep a stable manager reference across renders
  // We'll recreate when events array identity changes (new message)
  const managerRef = useRef<TimelineManager | null>(null);
  const prevEventsRef = useRef<StreamEvent[]>([]);

  // Process events and generate interleaved data
  const data = useMemo(() => {
    // If no events, return empty data with streaming flag
    if (events.length === 0) {
      return { ...EMPTY_DATA, isStreaming };
    }

    // Check if we need to reset the manager (new events array)
    // Compare by first event id to detect new turn
    const prevFirst = prevEventsRef.current[0]?.id;
    const currFirst = events[0]?.id;
    
    if (prevFirst !== currFirst) {
      // New turn - create fresh manager
      managerRef.current = createTimelineManager();
    }

    const manager = managerRef.current || createTimelineManager();
    managerRef.current = manager;

    // Reset and replay all events to get consistent state
    // This is simpler than incremental updates and handles reordering
    manager.reset();

    for (const event of events) {
      const namespace = event.namespace || [];

      switch (event.type) {
        case "content":
          if (event.content) {
            manager.pushContent(event.content, namespace);
          }
          break;

        case "tool_start":
          if (event.toolData && isToolStartData(event.toolData)) {
            manager.pushToolStart(event.toolData as ToolStartEventData, namespace);
          }
          break;

        case "tool_end":
          if (event.toolData) {
            const toolData = event.toolData as ToolEndEventData;
            if (toolData.error) {
              manager.pushToolFailed(toolData.tool_call_id, namespace, toolData.error);
            } else {
              manager.pushToolEnd(toolData.tool_call_id, namespace);
            }
          }
          break;

        case "warning":
          if (event.warningData?.message) {
            manager.pushWarning(event.warningData.message);
          } else if (event.displayContent) {
            manager.pushWarning(event.displayContent);
          }
          break;

        case "error":
          if (event.displayContent) {
            manager.pushError(event.displayContent);
          } else if (event.content) {
            manager.pushError(event.content);
          }
          break;
      }
    }

    // Finalize if not streaming
    if (!isStreaming) {
      manager.finalize(turnStatus || "done");
    }

    // Update prev events ref
    prevEventsRef.current = events;

    return manager.getGroupedData();
  }, [events, isStreaming, turnStatus]);

  return { data };
}

// ═══════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════

export default useAgentTimeline;
