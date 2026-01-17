// A2A Protocol Types - Spec Conformant
// Based on https://github.com/google/A2A

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
  };
  taskId?: string;
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

export interface Artifact {
  artifactId: string;
  name: string;
  description?: string;
  parts: ArtifactPart[];
  index?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
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
  type: "task" | "artifact" | "status" | "message" | "tool_start" | "tool_end" | "error";
  raw: A2AMessage;

  // Parsed fields
  taskId?: string;
  contextId?: string;
  status?: TaskStatus;
  artifact?: Artifact;
  isFinal?: boolean;
  isLastChunk?: boolean;

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
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  events: A2AEvent[];
  widgets?: Widget[];
  isFinal?: boolean;
}

// Use case types for gallery
export interface UseCase {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  prompt: string;
  expectedAgents: string[];
  thumbnail?: string;
  difficulty: "beginner" | "intermediate" | "advanced";
}
