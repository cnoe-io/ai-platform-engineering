/**
 * SSE Agent Event Types
 *
 * These types are used exclusively by the Dynamic Agents SSE streaming client.
 * They are intentionally separate from A2A types to maintain clean separation
 * between the two agent architectures.
 *
 * Event types match backend stream_events.py:
 * - content: LLM token streaming
 * - tool_start/tool_end: Tool invocations
 * - todo_update: Task list updates (replaces execution_plan)
 * - subagent_start/subagent_end: Subagent invocations
 * - final_result: Final agent response
 */

// ═══════════════════════════════════════════════════════════════
// Artifact Types (matching backend structure)
// ═══════════════════════════════════════════════════════════════

export interface SSEArtifactPart {
  kind: "text" | "data" | "file";
  text?: string;
  data?: unknown;
  mimeType?: string;
}

export interface SSEArtifact {
  name: string;
  artifactId?: string;
  description?: string;
  parts?: SSEArtifactPart[];
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// Structured Event Data Types (from backend stream_events.py)
// ═══════════════════════════════════════════════════════════════

/** Tool call data from tool_start/tool_end events */
export interface ToolEventData {
  tool_name: string;
  tool_call_id: string;
  args?: Record<string, unknown>; // Only in tool_start, truncated to 100 chars
  agent: string;
  is_builtin: boolean;
}

/** Todo item from todo_update events */
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** Todo update data from todo_update events */
export interface TodoUpdateData {
  todos: TodoItem[];
  agent: string;
}

/** Subagent data from subagent_start/subagent_end events */
export interface SubagentEventData {
  subagent_name: string;
  purpose?: string; // Only in subagent_start
  parent_agent: string;
}

/** Warning data from warning events */
export interface WarningEventData {
  message: string;
  missing_tools?: string[];
}

// ═══════════════════════════════════════════════════════════════
// HITL (Human-in-the-Loop) Types
// ═══════════════════════════════════════════════════════════════

export interface HITLInputField {
  field_name: string;
  field_type: string;
  field_label?: string;
  required?: boolean;
  options?: string[];
}

export interface HITLMetadata {
  user_input?: boolean;
  input_title?: string;
  input_description?: string;
  input_fields?: HITLInputField[];
  response?: string;
}

// ═══════════════════════════════════════════════════════════════
// Store Event (for conversation.sseEvents)
// ═══════════════════════════════════════════════════════════════

/**
 * Event types matching backend stream_events.py constants.
 * These are the primary event types from the new structured SSE system.
 */
export type SSEEventType =
  | "content" // LLM token streaming
  | "tool_start" // Tool invocation started
  | "tool_end" // Tool invocation completed
  | "todo_update" // Task list update (replaces execution_plan)
  | "subagent_start" // Subagent invocation started
  | "subagent_end" // Subagent invocation completed
  | "final_result" // Final agent response
  | "warning" // Warning event (e.g., missing tools)
  | "error"; // Error event

/**
 * SSE Agent event stored in the conversation.
 * This is the format used in conversation.sseEvents[].
 *
 * Now uses structured data fields instead of requiring text parsing.
 */
export interface SSEAgentEvent {
  id: string;
  timestamp: Date;
  type: SSEEventType;

  /** Raw event data (for debugging) */
  raw: unknown;

  /** Task ID for crash recovery */
  taskId?: string;

  /** Artifact data if present (for final_result) */
  artifact?: SSEArtifact;

  /** Whether this is the final event */
  isFinal?: boolean;

  // ─── Structured event data (new) ─────────────────────────────
  /** Tool event data for tool_start/tool_end */
  toolData?: ToolEventData;

  /** Todo list for todo_update */
  todoData?: TodoUpdateData;

  /** Subagent data for subagent_start/subagent_end */
  subagentData?: SubagentEventData;

  /** Warning data for warning events */
  warningData?: WarningEventData;

  // ─── Content ─────────────────────────────────────────────────
  /** Content text for content/final_result events */
  content?: string;

  /** Display content (for error events and UI display) */
  displayContent?: string;

  /** Source agent name */
  sourceAgent?: string;

  // ─── HITL support ────────────────────────────────────────────
  /** Context ID for user input forms */
  contextId?: string;

  /** HITL metadata */
  metadata?: HITLMetadata;
}

// ═══════════════════════════════════════════════════════════════
// Builtin Tools (render as compact chips)
// ═══════════════════════════════════════════════════════════════

/**
 * Builtin tools render as compact inline chips without borders.
 * Must match BUILTIN_TOOLS in backend stream_events.py.
 */
export const BUILTIN_TOOLS = new Set([
  "write_todos",
  "read_file",
  "write_file",
  "edit_file",
  "ls",
]);

// ═══════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════

let eventCounter = 0;

function generateEventId(): string {
  return `sse-${Date.now()}-${(++eventCounter).toString(36)}`;
}

/**
 * Create an SSEAgentEvent from a backend event.
 * This replaces the old toSSEAgentStoreEvent + ParsedSSEEvent conversion.
 */
export function createSSEAgentEvent(
  backendEvent: {
    type: string;
    data: unknown;
  },
  taskId?: string
): SSEAgentEvent {
  const { type, data } = backendEvent;

  const base: SSEAgentEvent = {
    id: generateEventId(),
    timestamp: new Date(),
    type: type as SSEEventType,
    raw: backendEvent,
    taskId,
  };

  switch (type) {
    case "content":
      return {
        ...base,
        content: data as string,
      };

    case "tool_start":
    case "tool_end":
      return {
        ...base,
        toolData: data as ToolEventData,
        sourceAgent: (data as ToolEventData).agent,
      };

    case "todo_update":
      return {
        ...base,
        todoData: data as TodoUpdateData,
        sourceAgent: (data as TodoUpdateData).agent,
      };

    case "subagent_start":
    case "subagent_end":
      return {
        ...base,
        subagentData: data as SubagentEventData,
        sourceAgent: (data as SubagentEventData).parent_agent,
      };

    case "final_result": {
      const resultData = data as { artifact?: SSEArtifact };
      const artifact = resultData.artifact;
      const textPart = artifact?.parts?.find((p) => p.kind === "text");
      return {
        ...base,
        isFinal: true,
        artifact,
        content: textPart?.text,
        sourceAgent: artifact?.metadata?.agent_name as string | undefined,
      };
    }

    case "warning":
      return {
        ...base,
        warningData: data as WarningEventData,
        displayContent: (data as WarningEventData).message,
      };

    default:
      return base;
  }
}

// Stable empty array to avoid re-renders
export const EMPTY_SSE_EVENTS: SSEAgentEvent[] = [];
