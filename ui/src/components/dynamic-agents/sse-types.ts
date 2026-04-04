/**
 * SSE Agent Event Types
 *
 * These types are used exclusively by the Dynamic Agents SSE streaming client.
 * They are intentionally separate from A2A types to maintain clean separation
 * between the two agent architectures.
 *
 * Event types match backend stream_events.py:
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

/** Tool end event data - minimal, just the ID to match back */
export interface ToolEndEventData {
  tool_call_id: string;
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

/** Sandbox denial event data */
export interface SandboxDenialData {
  id: string;
  host?: string;
  port?: number;
  binary?: string;
  reason?: string;
  stage?: "l4_deny" | "l7_deny" | "l7_audit" | "ssrf";
  sandbox_name?: string;
  timestamp?: string;
}

/** Sandbox policy update event data */
export interface SandboxPolicyUpdateData {
  id: string;
  sandbox_name: string;
  status: "loaded" | "failed" | "error";
  rule_id?: string;
}

/** Sandbox enhanced tool execution event data */
export interface SandboxToolExecData {
  id: string;
  tool_name: string;
  tool_call_id: string;
  command?: string;
  exit_code?: number;
  sandbox_name?: string;
  truncated?: boolean;
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
// Store Event (for conversation.sseEvents)
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
export type SSEEventType =
  | "content" // LLM token streaming
  | "tool_start" // Tool invocation started (task tool = subagent invocation)
  | "tool_end" // Tool invocation completed
  | "input_required" // Agent requests user input via form (HITL)
  | "warning" // Warning event (e.g., missing tools) - rendered inline
  | "error" // Error event - rendered inline
  | "sandbox_denial" // Sandbox policy denied a request
  | "sandbox_policy_update" // Sandbox policy was updated (hot reload)
  | "sandbox_tool_exec"; // Enhanced sandbox tool execution info

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

  // ─── Sandbox ────────────────────────────────────────────────
  /** Sandbox denial data for sandbox_denial events */
  sandboxDenialData?: SandboxDenialData;

  /** Sandbox policy update data for sandbox_policy_update events */
  sandboxPolicyUpdateData?: SandboxPolicyUpdateData;

  /** Sandbox tool execution data for sandbox_tool_exec events */
  sandboxToolExecData?: SandboxToolExecData;
}

// ═══════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════

let eventCounter = 0;

function generateEventId(): string {
  return `sse-${Date.now()}-${(++eventCounter).toString(36)}`;
}

/**
 * Raw backend SSE data structure.
 * All event data now includes namespace for agent hierarchy.
 * - Content events: { text: string, namespace: string[] }
 * - Other events: { ...eventData, namespace: string[] }
 */
export interface SSEBackendData {
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
 * Create an SSEAgentEvent from a backend event.
 * This replaces the old toSSEAgentStoreEvent + ParsedSSEEvent conversion.
 *
 * @param eventType - The SSE event type (content, tool_start, etc.)
 * @param data - The parsed JSON data from the SSE event
 * @param taskId - Optional task ID for crash recovery
 */
export function createSSEAgentEvent(
  eventType: string,
  data: SSEBackendData,
  taskId?: string
): SSEAgentEvent {
  // Extract namespace from data (all events now include it)
  const namespace = data.namespace ?? [];

  const base: SSEAgentEvent = {
    id: generateEventId(),
    timestamp: new Date(),
    type: eventType as SSEEventType,
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
      // Tool end has { tool_call_id, namespace }
      const toolData: ToolEndEventData = {
        tool_call_id: data.tool_call_id!,
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

    case "sandbox_denial": {
      const denialData: SandboxDenialData = {
        id: (data as Record<string, unknown>).id as string ?? "",
        host: (data as Record<string, unknown>).host as string | undefined,
        port: (data as Record<string, unknown>).port as number | undefined,
        binary: (data as Record<string, unknown>).binary as string | undefined,
        reason: (data as Record<string, unknown>).reason as string | undefined,
        stage: (data as Record<string, unknown>).stage as SandboxDenialData["stage"],
        sandbox_name: (data as Record<string, unknown>).sandbox_name as string | undefined,
        timestamp: (data as Record<string, unknown>).timestamp as string | undefined,
      };
      return {
        ...base,
        sandboxDenialData: denialData,
        displayContent: `Sandbox blocked: ${denialData.host ?? "unknown"}:${denialData.port ?? "?"}`,
      };
    }

    case "sandbox_policy_update": {
      const updateData: SandboxPolicyUpdateData = {
        id: (data as Record<string, unknown>).id as string ?? "",
        sandbox_name: (data as Record<string, unknown>).sandbox_name as string ?? "",
        status: (data as Record<string, unknown>).status as SandboxPolicyUpdateData["status"] ?? "loaded",
        rule_id: (data as Record<string, unknown>).rule_id as string | undefined,
      };
      return {
        ...base,
        sandboxPolicyUpdateData: updateData,
      };
    }

    case "sandbox_tool_exec": {
      const execData: SandboxToolExecData = {
        id: (data as Record<string, unknown>).id as string ?? "",
        tool_name: (data as Record<string, unknown>).tool_name as string ?? "",
        tool_call_id: (data as Record<string, unknown>).tool_call_id as string ?? "",
        command: (data as Record<string, unknown>).command as string | undefined,
        exit_code: (data as Record<string, unknown>).exit_code as number | undefined,
        sandbox_name: (data as Record<string, unknown>).sandbox_name as string | undefined,
        truncated: (data as Record<string, unknown>).truncated as boolean | undefined,
      };
      return {
        ...base,
        sandboxToolExecData: execData,
      };
    }

    default:
      return base;
  }
}

// Stable empty array to avoid re-renders
export const EMPTY_SSE_EVENTS: SSEAgentEvent[] = [];

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
