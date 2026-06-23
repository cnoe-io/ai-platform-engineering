import type { StreamEvent } from "@/lib/streaming/types";
import type { Participant } from "@/types/mongodb";

// Chat conversation types for the Dynamic Agents UI.
//
// Conversation/message shapes shared across the chat UI. Streaming event data
// lives in `StreamEvent`.

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
  /** Agents and users involved in this conversation */
  participants: Participant[];
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

// ═══════════════════════════════════════════════════════════════
// Participant helpers
// ═══════════════════════════════════════════════════════════════

/** Get the first agent participant's ID, or undefined if no agent. */
export function getAgentId(conv: { participants?: Participant[] }): string | undefined {
  return conv.participants?.find(p => p.type === 'agent')?.id;
}

/** True if the conversation has at least one agent participant. */
export function isDynamicAgentConversation(conv: { participants?: Participant[] }): boolean {
  return conv.participants?.some(p => p.type === 'agent') ?? false;
}

/** Build a participants array from an agent ID and optional owner email. */
export function buildParticipants(agentId?: string, ownerEmail?: string): Participant[] {
  const participants: Participant[] = [];
  if (ownerEmail) participants.push({ type: 'user', id: ownerEmail });
  if (agentId) participants.push({ type: 'agent', id: agentId });
  return participants;
}

// Feedback types - matching agent-forge
export interface MessageFeedback {
  type: "like" | "dislike" | null;
  reason?: string;
  additionalFeedback?: string;
  submitted?: boolean;
  showFeedbackOptions?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** Stream events for Dynamic Agents (stored per-message) */
  streamEvents?: StreamEvent[];
  isFinal?: boolean;
  feedback?: MessageFeedback;
  /** Turn ID links user message to its assistant response for event grouping */
  turnId?: string;
  /** Raw accumulated stream content - never overwritten, always appended */
  rawStreamContent?: string;
  /** Task ID from the backend — used for crash recovery (tasks/get polling) */
  taskId?: string;
  /** True when streaming was interrupted by a crash/reload before completion */
  isInterrupted?: boolean;
  /**
   * Sender identity — who actually typed this message.
   * Required for shared conversations where multiple users participate.
   * Optional because stored messages may not include sender metadata.
   */
  senderEmail?: string;
  senderName?: string;
  senderImage?: string;
  /** Turn status for Dynamic Agents: done, interrupted, or waiting_for_input */
  turnStatus?: TurnStatus;
  /** Connection/server error — rendered as inline banner, not as bot content */
  error?: string;
  /** Display name of the dynamic agent that produced this assistant message.
   *  Persisted to metadata.agent_name and drives the Insights "Favorite/Top
   *  Agents" breakdowns. */
  agentName?: string;
  /** End-to-end client-measured turn latency in milliseconds (request → final
   *  response). Persisted to metadata.latency_ms for response-time analytics. */
  latencyMs?: number;
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
