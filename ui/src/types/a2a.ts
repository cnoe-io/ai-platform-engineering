// A2A Protocol Types - Spec Conformant
// Based on https://github.com/google/A2A

import type { SSEAgentEvent } from "@/components/dynamic-agents/sse-types";

export interface A2AMessage {
  jsonrpc: "2.0";
  id: string;
  method?: string;
  result?: A2AResult;
  error?: A2AError;
}

export interface A2ARequest {
  jsonrpc: "2.0";
  id: string;
  method: "message/stream" | "message/send" | "tasks/get" | "tasks/cancel";
  params: A2AParams;
}

export interface A2AParams {
  message?: {
    messageId: string;
    role: "user" | "assistant";
    parts: MessagePart[];
    /** Context ID for conversation continuity - MUST be inside message per A2A spec */
    contextId?: string;
  };
  taskId?: string;
  /** @deprecated Use message.contextId instead for A2A conversation continuity */
  contextId?: string;
}

export interface MessagePart {
  kind?: "text" | "file" | "data";
  text?: string;
  file?: {
    name: string;
    mimeType: string;
    bytes?: string;
    uri?: string;
  };
  data?: Record<string, unknown>;
}

export interface A2AResult {
  kind: "task" | "artifact-update" | "status-update" | "message";
  taskId?: string;
  contextId?: string;

  // Task result fields
  status?: TaskStatus;

  // Artifact update fields
  artifact?: Artifact;
  append?: boolean;
  lastChunk?: boolean;

  // Status update fields
  final?: boolean;

  // Message result fields
  parts?: MessagePart[];
  role?: "user" | "agent";
}

export interface A2AError {
  code: number;
  message: string;
  data?: unknown;
}

export interface TaskStatus {
  state: "submitted" | "working" | "input-required" | "completed" | "failed" | "cancelled";
  message?: Message;
  timestamp?: string;
}

export interface Message {
  messageId: string;
  role: "user" | "assistant" | "agent";
  parts: MessagePart[];
  timestamp?: string;
}

export interface ArtifactMetadata {
  sourceAgent?: string;
  agentType?: "supervisor" | "sub-agent" | "notification" | "streaming";
  [key: string]: unknown;
}

export interface Artifact {
  artifactId: string;
  name: string;
  description?: string;
  parts: ArtifactPart[];
  index?: number;
  mimeType?: string;
  metadata?: ArtifactMetadata;
}

export interface ArtifactPart {
  kind: "text" | "file" | "data" | "inlineData";
  text?: string;
  file?: {
    name: string;
    mimeType: string;
    bytes?: string;
    uri?: string;
  };
  data?: Record<string, unknown>;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

// Parsed A2A Event for UI rendering
export interface A2AEvent {
  id: string;
  timestamp: Date;
  type:
    | "task"
    | "artifact"
    | "status"
    | "message"
    | "tool_start"
    | "tool_end"
    | "execution_plan"
    | "error";
  raw: A2AMessage;

  // Parsed fields
  taskId?: string;
  contextId?: string;
  status?: TaskStatus;
  artifact?: Artifact;
  isFinal?: boolean;
  isLastChunk?: boolean;
  shouldAppend?: boolean; // A2A append flag: true = append, false = replace

  // Source agent tracking for sub-agent message grouping
  sourceAgent?: string;

  // UI display helpers
  displayName: string;
  displayContent: string;
  color: string;
  icon: string;
}

// Widget types for A2UI support
export interface Widget {
  id: string;
  type: "button" | "form" | "card" | "list" | "table" | "chart" | "input" | "select" | "progress";
  props: Record<string, unknown>;
  children?: Widget[];
  actions?: WidgetAction[];
}

export interface WidgetAction {
  name: string;
  label?: string;
  context?: Record<string, unknown>;
}

// Chat conversation types
export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
  /** A2A events for this conversation (for debug panel, tasks, output) */
  a2aEvents: A2AEvent[];
  /** SSE events for Dynamic Agents (separate from A2A) */
  sseEvents: SSEAgentEvent[];
  /** Dynamic agent ID; undefined = Platform Engineer (default) */
  agent_id?: string;
  /** Owner email (only for MongoDB conversations) */
  owner_id?: string;
  /** Sharing information (optional, only for MongoDB conversations) */
  sharing?: {
    is_public?: boolean;
    shared_with?: string[];
    shared_with_teams?: string[];
    share_link_enabled?: boolean;
  };
  /** 
   * Runtime status for Dynamic Agents - persists across SSE event clearing.
   * Updated when final_result events arrive, cleared on runtime restart.
   */
  runtimeStatus?: {
    /** MCP servers that failed to connect */
    failedServers?: string[];
    /** Tools that were configured but unavailable */
    missingTools?: string[];
    /** Whether we have received at least one final_result (runtime has been initialized) */
    initialized?: boolean;
  };
}

// Feedback types - matching agent-forge
export interface MessageFeedback {
  type: "like" | "dislike" | null;
  reason?: string;
  additionalFeedback?: string;
  submitted?: boolean;
  showFeedbackOptions?: boolean;
}

// Timeline types for structured agent execution display
export type TimelineSegmentType = "thinking" | "execution_plan" | "tool_call" | "final_answer";

export interface ToolCallInfo {
  id: string;
  agent: string;
  tool: string;
  status: "running" | "completed" | "failed";
  planStepId?: string;
}

export interface PlanStep {
  id: string;
  agent: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface TimelineSegment {
  id: string;
  type: TimelineSegmentType;
  timestamp: Date;
  content?: string;
  toolCall?: ToolCallInfo;
  planSteps?: PlanStep[];
  isStreaming?: boolean;
  /** Links thinking segments to a plan step for nested display */
  planStepId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  events: A2AEvent[];
  widgets?: Widget[];
  isFinal?: boolean;
  feedback?: MessageFeedback;
  /** Turn ID links user message to its assistant response for event grouping */
  turnId?: string;
  /** Raw accumulated stream content - never overwritten, always appended */
  rawStreamContent?: string;
  /** A2A task ID from the backend — used for crash recovery (tasks/get polling) */
  taskId?: string;
  /** True when streaming was interrupted by a crash/reload before completion */
  isInterrupted?: boolean;
  /**
   * Sender identity — who actually typed this message.
   * Required for shared conversations where multiple users participate.
   * All fields are optional for backward compatibility with legacy messages.
   */
  senderEmail?: string;
  senderName?: string;
  senderImage?: string;
  /** Structured timeline segments built during streaming */
  timelineSegments?: TimelineSegment[];
}

// Input field configuration for use case forms
export interface UseCaseInputField {
  name: string;
  label: string;
  placeholder: string;
  type: "text" | "url" | "number";
  required?: boolean;
  helperText?: string;
}

// Use case types for gallery
export interface UseCase {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  prompt: string; // Can include {{fieldName}} placeholders for input forms
  expectedAgents: string[];
  thumbnail?: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  // Optional input form configuration
  inputForm?: {
    title: string;
    description?: string;
    fields: UseCaseInputField[];
    submitLabel?: string;
  };
}
