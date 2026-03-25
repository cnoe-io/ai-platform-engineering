/**
 * Dynamic Agent Timeline Types
 *
 * These types are used by the DynamicAgentTimeline component to render
 * an interleaved timeline view where content and tools appear in stream order.
 *
 * Files and Tasks are fixed (fetched via API), but content/tools/subagents
 * appear in temporal order like A2A.
 */

// ═══════════════════════════════════════════════════════════════
// Tool Types
// ═══════════════════════════════════════════════════════════════

export interface DAToolInfo {
  /** Tool call ID (unique identifier) */
  id: string;
  /** Tool name (e.g., "read_file", "search_code") */
  name: string;
  /** Tool arguments (used for thought extraction) */
  args?: Record<string, unknown>;
  /** Current status */
  status: "running" | "completed" | "failed";
  /** Timestamp when tool started */
  startedAt: Date;
  /** Timestamp when tool ended (if completed) */
  endedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════
// Subagent Types
// ═══════════════════════════════════════════════════════════════

export interface DASubagentInfo {
  /** Tool call ID (namespace correlates to this) */
  id: string;
  /** Agent name (from args.subagent_type) */
  name: string;
  /** MongoDB agent_id */
  agentId?: string;
  /** Purpose description (from args.description) */
  purpose?: string;
  /** Current status */
  status: "running" | "completed" | "failed";
}

// ═══════════════════════════════════════════════════════════════
// Timeline Segment Types (Interleaved)
// ═══════════════════════════════════════════════════════════════

/** A segment of content text */
export interface DAContentSegment {
  type: "content";
  id: string;
  text: string;
}

/** A tool call segment */
export interface DAToolSegment {
  type: "tool";
  id: string;
  data: DAToolInfo;
}

/** A group of consecutive tool calls (for compact rendering) */
export interface DAToolGroupSegment {
  type: "tool-group";
  id: string;
  tools: DAToolInfo[];
}

/** A subagent section with its own nested timeline */
export interface DASubagentSegment {
  type: "subagent";
  id: string;
  info: DASubagentInfo;
  /** Nested timeline segments for this subagent */
  segments: DATimelineSegment[];
}

/** A warning message */
export interface DAWarningSegment {
  type: "warning";
  id: string;
  message: string;
}

/** An error message */
export interface DAErrorSegment {
  type: "error";
  id: string;
  message: string;
}

/** Status segment types */
export type DAStatusType = "done" | "interrupted" | "waiting_for_input";

/** A status marker (completion, interruption, or waiting for input) */
export interface DAStatusSegment {
  type: "status";
  id: string;
  /** Status type: done, interrupted, or waiting_for_input */
  status: DAStatusType;
  /** Optional label (e.g., subagent name that completed) */
  label?: string;
}

/**
 * @deprecated Use DAStatusSegment instead
 * Kept for backward compatibility during migration
 */
export interface DADoneSegment {
  type: "done";
  id: string;
  /** Optional label (e.g., subagent name that completed) */
  label?: string;
}

/** Union of all segment types */
export type DATimelineSegment =
  | DAContentSegment
  | DAToolSegment
  | DAToolGroupSegment
  | DASubagentSegment
  | DAWarningSegment
  | DAErrorSegment
  | DAStatusSegment
  | DADoneSegment;

// ═══════════════════════════════════════════════════════════════
// Timeline Data (Interleaved Structure)
// ═══════════════════════════════════════════════════════════════

/**
 * Interleaved timeline data for rendering.
 * Segments appear in stream order; finalAnswer is content after last tool.
 */
export interface DATimelineData {
  /** Interleaved segments in temporal order */
  segments: DATimelineSegment[];
  /** Content after last tool_end (null if none yet) */
  finalAnswer: string | null;
  /** Whether stream is still active */
  isStreaming: boolean;
  /** Whether any tools have been called (determines timeline vs simple message mode) */
  hasTools: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Timeline Stats (for summary bar)
// ═══════════════════════════════════════════════════════════════

export interface DATimelineStats {
  toolCount: number;
  completedToolCount: number;
  subagentCount: number;
  completedSubagentCount: number;
  warningCount: number;
  errorCount: number;
}

// ═══════════════════════════════════════════════════════════════
// Helper: Extract thought/reason from tool args
// ═══════════════════════════════════════════════════════════════

const THOUGHT_KEYS = [
  "thought",
  "thoughts",
  "reason",
  "thinking",
  "rationale",
  "explanation",
  "description",
  "purpose",
  "intent",
  "goal",
] as const;

/**
 * Extract a preview string from tool arguments.
 * Looks for common "thought" fields that agents use to explain their reasoning.
 */
export function extractToolThought(
  args?: Record<string, unknown>,
  maxLength = 60
): string | null {
  if (!args) return null;

  for (const key of THOUGHT_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      return trimmed.length > maxLength
        ? trimmed.slice(0, maxLength) + "..."
        : trimmed;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// Helper: Group consecutive tool segments
// ═══════════════════════════════════════════════════════════════

/**
 * Groups consecutive tool segments into DAToolGroupSegment.
 * Other segment types remain unchanged.
 * This creates a consistent view for all tools (single or multiple).
 */
export function groupConsecutiveTools(
  segments: DATimelineSegment[]
): DATimelineSegment[] {
  const result: DATimelineSegment[] = [];
  let currentToolGroup: DAToolInfo[] = [];

  const flushToolGroup = () => {
    if (currentToolGroup.length === 0) return;
    
    // Always create a group for consistency
    result.push({
      type: "tool-group",
      id: `tool-group-${currentToolGroup[0].id}`,
      tools: [...currentToolGroup],
    });
    currentToolGroup = [];
  };

  for (const segment of segments) {
    if (segment.type === "tool") {
      currentToolGroup.push(segment.data);
    } else {
      flushToolGroup();
      result.push(segment);
    }
  }

  // Don't forget trailing tools
  flushToolGroup();

  return result;
}
