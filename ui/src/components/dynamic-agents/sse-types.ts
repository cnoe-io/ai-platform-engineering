/**
 * Stream Event Types
 *
 * These types are used by the Dynamic Agents streaming client.
 * They are intentionally separate from A2A types to maintain clean separation
 * between the two agent architectures.
 *
 * Event types match the backend stream encoder output:
 * - content: LLM token streaming
 * - tool_start/tool_end: Tool invocations (including task tool for subagents)
 * - warning/error: Warnings and errors (rendered inline in chat)
 * - done: Stream completion
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

/** Tool start event data - contains all tool info */
export interface ToolStartEventData {
  tool_name: string;
  tool_call_id: string;
  args?: Record<string, unknown>;
}

/** Tool end event data - minimal, just the ID to match back.
 *  When error is set, the UI renders the tool as failed with the error message. */
export interface ToolEndEventData {
  tool_call_id: string;
  error?: string;
  args?: Record<string, unknown>;
}

/** Type guard: check if toolData is from a tool_start event */
export function isToolStartData(
  data: ToolStartEventData | ToolEndEventData | undefined
): data is ToolStartEventData {
  return data !== undefined && "tool_name" in data;
}

/** Content event data - now wrapped with namespace */
export interface ContentEventData {
  text: string;
  namespace: string[];
}

/** Todo item from write_todos tool (via tool_start events) */
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** Warning data from warning events */
export interface WarningEventData {
  message: string;
}

/** Input required data from input_required events (HITL forms) */
export interface InputRequiredEventData {
  /** Unique ID for this interrupt (used to resume) */
  interrupt_id: string;
  /** Message explaining what information is needed */
  prompt: string;
  /** Field definitions for the form */
  fields: InputFieldDefinition[];
  /** Agent that requested input */
  agent: string;
}

/** Field definition for HITL forms (matches backend InputField model) */
export interface InputFieldDefinition {
  field_name: string;
  field_label?: string;
  field_description?: string;
  field_type:
    | "text"
    | "select"
    | "multiselect"
    | "boolean"
    | "number"
    | "url"
    | "email";
  field_values?: string[];
  required?: boolean;
  default_value?: string;
  placeholder?: string;
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
// Store Event (for conversation.streamEvents)
// ═══════════════════════════════════════════════════════════════

/**
 * Event types matching backend stream_events.py constants.
 * These are the primary event types from the new structured SSE system.
 *
 * Note: Subagent invocations are now emitted as tool_start/tool_end with tool_name="task".
 * The UI should check toolData.tool_name === "task" to identify subagent calls.
 * Use namespace to determine which agent generated the event:
 * - namespace=[] → parent agent
 * - namespace=["my-helper-agent"] → subagent with that agent_id
 */
export type StreamEventType =
  | "content" // LLM token streaming
  | "tool_start" // Tool invocation started (task tool = subagent invocation)
  | "tool_end" // Tool invocation completed
  | "input_required" // Agent requests user input via form (HITL)
  | "warning" // Warning event (e.g., missing tools) - rendered inline
  | "error"; // Error event - rendered inline

/**
 * Agent event stored in the conversation.
 * This is the format used in conversation.streamEvents[].
 *
 * Now uses structured data fields instead of requiring text parsing.
 */
export interface StreamEvent {
  id: string;
  timestamp: Date;
  type: StreamEventType;

  /** Raw event data (for debugging) */
  raw: unknown;

  /** Task ID for crash recovery */
  taskId?: string;

  /** Whether this is the final event */
  isFinal?: boolean;

  /**
   * LangGraph namespace indicating which agent generated this event.
   * - [] (empty) = parent/root agent
   * - ["my-helper-agent"] = subagent with that agent_id
   * - ["parent", "child"] = nested subagent (if supported)
   */
  namespace: string[];

  // ─── Structured event data (new) ─────────────────────────────
  /** Tool event data for tool_start/tool_end */
  toolData?: ToolStartEventData | ToolEndEventData;

  /** Warning data for warning events */
  warningData?: WarningEventData;

  /** Input required data for input_required events (HITL forms) */
  inputRequiredData?: InputRequiredEventData;

  // ─── Content ─────────────────────────────────────────────────
  /** Content text for content events */
  content?: string;

  /** Display content (for error events and UI display) */
  displayContent?: string;

  // ─── HITL support ────────────────────────────────────────────
  /** Context ID for user input forms */
  contextId?: string;

  /** HITL metadata */
  metadata?: HITLMetadata;
}

// ═══════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════

let eventCounter = 0;

function generateEventId(): string {
  return `sse-${Date.now()}-${(++eventCounter).toString(36)}`;
}

/**
 * Raw backend event data structure.
 * All event data now includes namespace for agent hierarchy.
 * - Content events: { text: string, namespace: string[] }
 * - Other events: { ...eventData, namespace: string[] }
 */
export interface StreamBackendData {
  namespace: string[];
  // Content events
  text?: string;
  // Tool events
  tool_name?: string;
  tool_call_id?: string;
  args?: Record<string, unknown>;
  // Input required events
  interrupt_id?: string;
  prompt?: string;
  fields?: InputFieldDefinition[];
  agent?: string;
  // Warning events
  message?: string;
  // Allow other fields
  [key: string]: unknown;
}

/**
 * Create an StreamEvent from a backend event.
 * This replaces the old toSSEAgentStoreEvent + ParsedSSEEvent conversion.
 *
 * @param eventType - The event type (content, tool_start, etc.)
 * @param data - The parsed JSON data from the event
 * @param taskId - Optional task ID for crash recovery
 */
export function createStreamEvent(
  eventType: string,
  data: StreamBackendData,
  taskId?: string
): StreamEvent {
  // Extract namespace from data (all events now include it)
  const namespace = data.namespace ?? [];

  const base: StreamEvent = {
    id: generateEventId(),
    timestamp: new Date(),
    type: eventType as StreamEventType,
    raw: { type: eventType, data },
    taskId,
    namespace,
  };

  switch (eventType) {
    case "content":
      // Content events have { text: string, namespace: string[] }
      return {
        ...base,
        content: data.text ?? "",
      };

    case "tool_start": {
      // Tool start has { tool_name, tool_call_id, args, namespace }
      const toolData: ToolStartEventData = {
        tool_name: data.tool_name!,
        tool_call_id: data.tool_call_id!,
        args: data.args,
      };
      return {
        ...base,
        toolData,
      };
    }

    case "tool_end": {
      // Tool end has { tool_call_id, error?, args?, namespace }
      const toolData: ToolEndEventData = {
        tool_call_id: data.tool_call_id!,
        ...(data.error ? { error: data.error as string } : {}),
        ...(data.args ? { args: data.args as Record<string, unknown> } : {}),
      };
      return {
        ...base,
        toolData,
      };
    }

    case "input_required": {
      // Input required has { interrupt_id, prompt, fields, agent, namespace }
      const inputData: InputRequiredEventData = {
        interrupt_id: data.interrupt_id!,
        prompt: data.prompt!,
        fields: data.fields!,
        agent: data.agent!,
      };
      return {
        ...base,
        inputRequiredData: inputData,
      };
    }

    case "warning": {
      // Warning has { message, namespace }
      const warningData: WarningEventData = {
        message: data.message!,
      };
      return {
        ...base,
        warningData,
        displayContent: data.message,
      };
    }

    default:
      return base;
  }
}

// Stable empty array to avoid re-renders
export const EMPTY_STREAM_EVENTS: StreamEvent[] = [];

// ═══════════════════════════════════════════════════════════════
// Tool Name Constants
// ═══════════════════════════════════════════════════════════════

/**
 * Tool names for file operations (from deepagents filesystem middleware).
 * Used to detect when file-related tools are called.
 */
export const FILE_TOOL_NAMES = ["write_file", "edit_file", "read_file", "ls"] as const;

/** Type for file tool names */
export type FileToolName = (typeof FILE_TOOL_NAMES)[number];

/**
 * Type-safe check if a tool name is a file tool.
 * Avoids TypeScript errors when using .includes() with readonly const arrays.
 */
export function isFileToolName(name: string): name is FileToolName {
  return (FILE_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Tool name for todo/task operations (from deepagents todo middleware).
 * Used to detect when task-related tools are called.
 */
export const TODO_TOOL_NAME = "write_todos" as const;

/**
 * Type-safe check if a tool name is the todo tool.
 */
export function isTodoToolName(name: string): boolean {
  return name === TODO_TOOL_NAME;
}

/**
 * Tool name for subagent invocations (from deepagents task middleware).
 * When tool_name === "task", the tool call is a subagent invocation.
 */
export const SUBAGENT_TOOL_NAME = "task" as const;

// ═══════════════════════════════════════════════════════════════
// Backwards-compatible aliases for code that still uses old names.
// These will be removed once all consumers are migrated.
// ═══════════════════════════════════════════════════════════════

/** @deprecated Use StreamEvent instead */
export type SSEAgentEvent = StreamEvent;

/** @deprecated Use createStreamEvent instead */
export const createSSEAgentEvent = createStreamEvent;
