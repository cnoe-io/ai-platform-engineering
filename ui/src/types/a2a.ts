import type { StreamEvent } from "@/components/dynamic-agents/sse-types";

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

// Turn status for Dynamic Agents (shown in timeline)
export type TurnStatus = "done" | "interrupted" | "waiting_for_input";

// Chat conversation types
export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
  /** Stream events for Dynamic Agents */
  streamEvents: StreamEvent[];
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
  status: "pending" | "in_progress" | "completed" | "failed" | "input_required";
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
  /** Stream events for Dynamic Agents (stored per-message) */
  streamEvents?: StreamEvent[];
  widgets?: Widget[];
  isFinal?: boolean;
  feedback?: MessageFeedback;
  /** Turn ID links user message to its assistant response for event grouping */
  turnId?: string;
  /** Raw accumulated stream content - never overwritten, always appended */
  rawStreamContent?: string;
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
  /** Character offset in `content` where the first timeline event (tool/plan) appeared.
   *  Text before this offset is "pre-timeline" (rendered above tools/plan).
   *  Text from this offset onward is "post-timeline" (rendered below tools/plan). */
  timelineTextOffset?: number;
  /** Turn status for Dynamic Agents: done, interrupted, or waiting_for_input */
  turnStatus?: TurnStatus;
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
