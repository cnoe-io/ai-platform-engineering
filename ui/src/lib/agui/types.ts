/**
 * AG-UI types for CAIPE.
 *
 * Re-exports core AG-UI types from @ag-ui/core and adds CAIPE-specific
 * extensions for plan steps, HITL input fields, and custom event payloads.
 */

// ── Core AG-UI re-exports ─────────────────────────────────────────────────────
export type {
  BaseEvent,
  AGUIEvent,
  AGUIEventByType,
  AGUIEventOf,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
  CustomEvent,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StepStartedEvent,
  StepFinishedEvent,
  MessagesSnapshotEvent,
  RawEvent,
  Message,
  State,
  RunAgentInput,
  Context,
  Tool,
  ToolCall,
} from "@ag-ui/core";

export { EventType } from "@ag-ui/core";

// ── CAIPE-specific extensions ─────────────────────────────────────────────────

/**
 * A single step in the agent's execution plan.
 * Surfaced via STATE_DELTA events with path "/steps".
 */
export interface PlanStep {
  id: string;
  agent: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "input_required";
}

/**
 * A field descriptor for a HITL (Human-in-the-Loop) input form.
 * Surfaced via CUSTOM events with name "INPUT_REQUIRED".
 */
export interface InputField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  default_value?: string;
}

/**
 * Payload for CUSTOM events with name "INPUT_REQUIRED".
 * Triggers HITL form rendering in the UI.
 */
export interface InputRequiredPayload {
  /** Unique identifier for the interrupt (used when submitting form data) */
  interruptId?: string;
  /** Human-readable prompt shown above the form */
  prompt?: string;
  /** Form fields to render */
  fields: InputField[];
  /** Agent that requested user input */
  agent?: string;
}

/**
 * Payload for CUSTOM events with name "PLAN_UPDATE".
 * Alternative to STATE_DELTA for plan step updates.
 */
export interface PlanUpdatePayload {
  steps: PlanStep[];
}

/**
 * Union of all known CAIPE custom event payloads, keyed by event name.
 */
export type CAIPECustomEventPayloads = {
  INPUT_REQUIRED: InputRequiredPayload;
  PLAN_UPDATE: PlanUpdatePayload;
};

/**
 * Configuration for creating an AG-UI HttpAgent with CAIPE auth.
 */
export interface CAIPEAgentConfig {
  /** The streaming endpoint URL (e.g. /api/chat/stream) */
  endpoint: string;
  /** JWT Bearer token for authentication */
  accessToken?: string;
  /** AG-UI thread/conversation ID */
  threadId: string;
}

/**
 * Parameters passed to the sendMessage function.
 */
export interface SendMessageParams {
  message: string;
  conversationId?: string;
  endpoint?: string;
  accessToken?: string;
  userEmail?: string;
  userName?: string;
  userImage?: string;
}
