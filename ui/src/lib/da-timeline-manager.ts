/**
 * Timeline Manager
 *
 * Manages the transformation of SSE events into an interleaved timeline.
 * Events are rendered in temporal order (like A2A), with subagents
 * having their own nested timelines.
 *
 * Key features:
 * - Interleaved content/tools in stream order
 * - Subagent sections with nested timelines
 * - Final answer detection (content after last tool_end)
 */

import type {
  TimelineData,
  TimelineStats,
  ToolInfo,
  SubagentInfo,
  TimelineSegment,
  ContentSegment,
  ToolSegment,
  SubagentSegment,
  StatusSegment,
  StatusType,
} from "@/types/dynamic-agent-timeline";
import type { ToolStartEventData } from "@/components/dynamic-agents/sse-types";
import { SUBAGENT_TOOL_NAME } from "@/components/dynamic-agents/sse-types";

// ═══════════════════════════════════════════════════════════════
// Internal Types
// ═══════════════════════════════════════════════════════════════

interface SubagentState {
  info: SubagentInfo;
  segments: TimelineSegment[];
  toolMap: Map<string, ToolInfo>;
  lastToolEndIndex: number;
}

// ═══════════════════════════════════════════════════════════════
// Manager Class
// ═══════════════════════════════════════════════════════════════

export class TimelineManager {
  // ─── Timeline Storage ───────────────────────────────────────
  private rootSegments: TimelineSegment[] = [];
  private rootToolMap: Map<string, ToolInfo> = new Map();
  private subagents: Map<string, SubagentState> = new Map();

  // ─── Content Buffering ──────────────────────────────────────
  // Buffer content and flush as segments to avoid too many tiny segments
  private rootContentBuffer: string = "";
  private rootContentId: number = 0;
  private subagentContentBuffers: Map<string, string> = new Map();
  private subagentContentIds: Map<string, number> = new Map();

  // ─── Tracking ───────────────────────────────────────────────
  private eventIndex: number = 0;
  private lastToolEndIndex: number = -1;
  private isFinalized: boolean = false;
  private warningCount: number = 0;
  private errorCount: number = 0;

  // ═══════════════════════════════════════════════════════════════
  // Content Buffering Helpers
  // ═══════════════════════════════════════════════════════════════

  private flushRootContent(): void {
    if (this.rootContentBuffer.trim()) {
      const segment: ContentSegment = {
        type: "content",
        id: `content-${this.rootContentId++}`,
        text: this.rootContentBuffer,
      };
      this.rootSegments.push(segment);
      this.rootContentBuffer = "";
    }
  }

  private flushSubagentContent(subagentId: string): void {
    const buffer = this.subagentContentBuffers.get(subagentId) || "";
    if (buffer.trim()) {
      const subagent = this.subagents.get(subagentId);
      if (subagent) {
        const contentId = this.subagentContentIds.get(subagentId) || 0;
        const segment: ContentSegment = {
          type: "content",
          id: `${subagentId}-content-${contentId}`,
          text: buffer,
        };
        subagent.segments.push(segment);
        this.subagentContentIds.set(subagentId, contentId + 1);
        this.subagentContentBuffers.set(subagentId, "");
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Event Handlers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Push content from a content event.
   */
  pushContent(text: string, namespace: string[]): void {
    this.eventIndex++;

    if (namespace.length === 0) {
      // Root content - buffer it
      this.rootContentBuffer += text;
    } else {
      // Subagent content - buffer it
      const subagentId = namespace[0];
      const buffer = this.subagentContentBuffers.get(subagentId) || "";
      this.subagentContentBuffers.set(subagentId, buffer + text);
    }
  }

  /**
   * Push a tool start event.
   */
  pushToolStart(toolData: ToolStartEventData, namespace: string[]): void {
    const now = new Date();
    this.eventIndex++;

    // Check if this is a subagent invocation (task tool)
    if (toolData.tool_name === SUBAGENT_TOOL_NAME) {
      const subagentId = toolData.tool_call_id;

      // DEDUP GUARD: Skip if we already have this subagent (HITL resume replays events)
      if (this.subagents.has(subagentId)) {
        return;
      }

      // Flush any pending root content before subagent
      this.flushRootContent();

      // Create subagent entry
      const args = toolData.args || {};

      const subagentState: SubagentState = {
        info: {
          id: subagentId,
          name: (args.subagent_type as string) || "subagent",
          agentId: args.subagent_type as string,
          purpose: args.description as string,
          status: "running",
        },
        segments: [],
        toolMap: new Map(),
        lastToolEndIndex: -1,
      };
      this.subagents.set(subagentId, subagentState);
      this.subagentContentBuffers.set(subagentId, "");
      this.subagentContentIds.set(subagentId, 0);

      // Add subagent segment to root timeline
      const segment: SubagentSegment = {
        type: "subagent",
        id: subagentId,
        info: subagentState.info,
        segments: subagentState.segments, // Reference, will be updated
      };
      this.rootSegments.push(segment);

      // Also track in rootToolMap for tool_end handling
      this.rootToolMap.set(subagentId, {
        id: subagentId,
        name: SUBAGENT_TOOL_NAME,
        args,
        status: "running",
        startedAt: now,
      });
    } else if (namespace.length === 0) {
      // DEDUP GUARD: Skip if we already have this tool (HITL resume replays events)
      if (this.rootToolMap.has(toolData.tool_call_id)) {
        return;
      }

      // Root-level tool - flush content first
      this.flushRootContent();

      const tool: ToolInfo = {
        id: toolData.tool_call_id,
        name: toolData.tool_name,
        args: toolData.args,
        status: "running",
        startedAt: now,
      };
      this.rootToolMap.set(toolData.tool_call_id, tool);

      const segment: ToolSegment = {
        type: "tool",
        id: toolData.tool_call_id,
        data: tool,
      };
      this.rootSegments.push(segment);
    } else {
      // Subagent tool
      const subagentId = namespace[0];
      const subagent = this.subagents.get(subagentId);
      if (subagent) {
        // DEDUP GUARD: Skip if we already have this tool (HITL resume replays events)
        if (subagent.toolMap.has(toolData.tool_call_id)) {
          return;
        }

        // Flush subagent content first
        this.flushSubagentContent(subagentId);

        const tool: ToolInfo = {
          id: toolData.tool_call_id,
          name: toolData.tool_name,
          args: toolData.args,
          status: "running",
          startedAt: now,
        };
        subagent.toolMap.set(toolData.tool_call_id, tool);

        const segment: ToolSegment = {
          type: "tool",
          id: toolData.tool_call_id,
          data: tool,
        };
        subagent.segments.push(segment);
      }
    }
  }

  /**
   * Push a tool end event.
   */
  pushToolEnd(toolCallId: string, namespace: string[]): void {
    const now = new Date();
    const currentIndex = this.eventIndex++;

    if (namespace.length === 0) {
      // Root-level tool completion
      const tool = this.rootToolMap.get(toolCallId);
      if (tool) {
        tool.status = "completed";
        tool.endedAt = now;
        this.lastToolEndIndex = currentIndex;
      }

      // Check if this is a subagent completion
      const subagent = this.subagents.get(toolCallId);
      if (subagent) {
        subagent.info.status = "completed";
        // Flush any remaining subagent content
        this.flushSubagentContent(toolCallId);
        
        // Add a "status" segment to the subagent's nested timeline
        const statusSegment: StatusSegment = {
          type: "status",
          id: `${toolCallId}-status`,
          status: "done",
          label: subagent.info.name,
        };
        subagent.segments.push(statusSegment);
      }
    } else {
      // Subagent tool completion
      const subagentId = namespace[0];
      const subagent = this.subagents.get(subagentId);
      if (subagent) {
        const tool = subagent.toolMap.get(toolCallId);
        if (tool) {
          tool.status = "completed";
          tool.endedAt = now;
          subagent.lastToolEndIndex = currentIndex;
        }
      }
    }
  }

  /**
   * Mark a tool as failed.
   */
  pushToolFailed(toolCallId: string, namespace: string[], error?: string): void {
    const now = new Date();
    const currentIndex = this.eventIndex++;

    if (namespace.length === 0) {
      const tool = this.rootToolMap.get(toolCallId);
      if (tool) {
        tool.status = "failed";
        tool.error = error;
        tool.endedAt = now;
        this.lastToolEndIndex = currentIndex;
      }

      const subagent = this.subagents.get(toolCallId);
      if (subagent) {
        subagent.info.status = "failed";
        this.flushSubagentContent(toolCallId);
      }
    } else {
      const subagentId = namespace[0];
      const subagent = this.subagents.get(subagentId);
      if (subagent) {
        const tool = subagent.toolMap.get(toolCallId);
        if (tool) {
          tool.status = "failed";
          tool.error = error;
          tool.endedAt = now;
        }
      }
    }
  }

  /**
   * Push a warning message.
   */
  pushWarning(message: string): void {
    this.eventIndex++;
    this.warningCount++;
    
    // Flush content first
    this.flushRootContent();
    
    this.rootSegments.push({
      type: "warning",
      id: `warning-${this.warningCount}`,
      message,
    });
  }

  /**
   * Push an error message.
   */
  pushError(message: string): void {
    this.eventIndex++;
    this.errorCount++;
    
    // Flush content first
    this.flushRootContent();
    
    this.rootSegments.push({
      type: "error",
      id: `error-${this.errorCount}`,
      message,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Finalization
  // ═══════════════════════════════════════════════════════════════

  /**
   * Finalize the timeline (called when stream ends).
   * @param status - The status to show: "done", "interrupted", or "waiting_for_input"
   */
  finalize(status: StatusType = "done"): void {
    this.isFinalized = true;

    // Flush any remaining content
    this.flushRootContent();
    for (const subagentId of this.subagents.keys()) {
      this.flushSubagentContent(subagentId);
    }

    // Mark all running tools as completed (unless interrupted)
    const toolStatus = status === "interrupted" ? "failed" : "completed";
    for (const tool of this.rootToolMap.values()) {
      if (tool.status === "running") {
        tool.status = toolStatus;
        tool.endedAt = new Date();
      }
    }

    // Mark all running subagents and their tools as completed
    for (const subagent of this.subagents.values()) {
      if (subagent.info.status === "running") {
        subagent.info.status = toolStatus;
      }
      for (const tool of subagent.toolMap.values()) {
        if (tool.status === "running") {
          tool.status = toolStatus;
          tool.endedAt = new Date();
        }
      }
    }

    // Add a status segment for the parent agent
    const statusSegment: StatusSegment = {
      type: "status",
      id: "root-status",
      status,
    };
    this.rootSegments.push(statusSegment);
  }

  // ═══════════════════════════════════════════════════════════════
  // Output
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get the interleaved timeline data for rendering.
   */
  getGroupedData(): TimelineData {
    // Flush any pending content
    const currentRootBuffer = this.rootContentBuffer;
    
    // Determine where to split for final answer
    // Final answer = content after the last tool_end (or all content if no tools)
    const hasTools = this.rootToolMap.size > 0;
    
    // Build segments for rendering (without final answer content)
    const segments: TimelineSegment[] = [];
    let finalAnswerParts: string[] = [];
    
    // Find the index of the last tool/subagent segment
    let lastToolSegmentIndex = -1;
    for (let i = this.rootSegments.length - 1; i >= 0; i--) {
      const seg = this.rootSegments[i];
      if (seg.type === "tool" || seg.type === "subagent") {
        lastToolSegmentIndex = i;
        break;
      }
    }
    
    // Process segments
    for (let i = 0; i < this.rootSegments.length; i++) {
      const seg = this.rootSegments[i];
      
      if (seg.type === "content" && hasTools && i > lastToolSegmentIndex) {
        // This content is after the last tool - it's part of final answer
        finalAnswerParts.push(seg.text);
      } else {
        segments.push(seg);
      }
    }
    
    // Add current buffer to final answer if we have tools and it's after last tool
    if (hasTools && currentRootBuffer.trim()) {
      finalAnswerParts.push(currentRootBuffer);
    } else if (!hasTools && currentRootBuffer.trim()) {
      // No tools - all content is final answer
      // But we still want to show it somewhere, so add as segment for now
      // Actually, if no tools, current buffer IS the final answer
      finalAnswerParts.push(currentRootBuffer);
    }
    
    // If no tools at all, all content segments become final answer
    // (plus any unflushed buffer content already added above)
    if (!hasTools) {
      const contentSegments = segments.filter(s => s.type === "content") as ContentSegment[];
      if (contentSegments.length > 0) {
        // Prepend flushed content segments before the buffer
        finalAnswerParts = [...contentSegments.map(s => s.text), ...finalAnswerParts];
      }
      // Remove content segments from segments (they go to finalAnswer)
      const nonContentSegments = segments.filter(s => s.type !== "content");
      segments.length = 0;
      segments.push(...nonContentSegments);
    }
    
    const finalAnswer = finalAnswerParts.length > 0 ? finalAnswerParts.join("") : null;

    return {
      segments,
      finalAnswer,
      isStreaming: !this.isFinalized,
      hasTools,
    };
  }

  /**
   * Get statistics for the summary bar.
   */
  getStats(): TimelineStats {
    // Count tools (excluding "task" which shows as subagent)
    let toolCount = 0;
    let completedToolCount = 0;
    
    for (const tool of this.rootToolMap.values()) {
      if (tool.name !== SUBAGENT_TOOL_NAME) {
        toolCount++;
        if (tool.status === "completed") completedToolCount++;
      }
    }

    return {
      toolCount,
      completedToolCount,
      subagentCount: this.subagents.size,
      completedSubagentCount: [...this.subagents.values()].filter(
        (s) => s.info.status === "completed"
      ).length,
      warningCount: this.warningCount,
      errorCount: this.errorCount,
    };
  }

  /**
   * Check if the timeline has any machinery.
   */
  hasMachinery(): boolean {
    return (
      this.rootToolMap.size > 0 ||
      this.subagents.size > 0 ||
      this.rootSegments.some(s => s.type === "content")
    );
  }

  /**
   * Check if there are any warnings or errors.
   */
  hasWarningsOrErrors(): boolean {
    return this.warningCount > 0 || this.errorCount > 0;
  }

  /**
   * Reset the manager for reuse.
   */
  reset(): void {
    this.rootSegments = [];
    this.rootToolMap.clear();
    this.subagents.clear();
    this.rootContentBuffer = "";
    this.rootContentId = 0;
    this.subagentContentBuffers.clear();
    this.subagentContentIds.clear();
    this.eventIndex = 0;
    this.lastToolEndIndex = -1;
    this.isFinalized = false;
    this.warningCount = 0;
    this.errorCount = 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new TimelineManager instance.
 */
export function createTimelineManager(): TimelineManager {
  return new TimelineManager();
}
