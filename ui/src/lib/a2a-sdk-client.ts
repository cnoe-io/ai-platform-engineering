/**
 * A2A SDK Client Wrapper
 * 
 * This module provides a wrapper around the official @a2a-js/sdk for the CAIPE UI.
 * It uses the same streaming pattern as agent-forge for consistent behavior.
 * 
 * Key features:
 * - Uses official @a2a-js/sdk (v0.3.9+)
 * - AsyncGenerator pattern for streaming (same as agent-forge)
 * - Bearer token authentication support
 * - Proper event typing from the SDK
 */

import {
  JsonRpcTransport,
  createAuthenticatingFetchWithRetry,
  type AuthenticationHandler,
} from "@a2a-js/sdk/client";

import type {
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  MessageSendParams,
  TextPart,
  DataPart,
  FilePart,
} from "@a2a-js/sdk";

import { v4 as uuidv4 } from "uuid";

// Re-export types for convenience
export type A2AStreamEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export interface A2ASDKClientConfig {
  /** The A2A endpoint URL (e.g., http://localhost:8000) */
  endpoint: string;
  /** JWT access token for Bearer authentication */
  accessToken?: string;
  /** Timeout in milliseconds for requests (default: 300000 = 5 minutes) */
  timeoutMs?: number;
}

/**
 * Parsed event with extracted display content for UI rendering
 */
export interface ParsedA2AEvent {
  /** Raw event from SDK */
  raw: A2AStreamEvent;
  /** Event type for UI handling */
  type: "message" | "task" | "status" | "artifact";
  /** Artifact name if present */
  artifactName?: string;
  /** Extracted text content for display */
  displayContent: string;
  /** Whether this is a final/complete result */
  isFinal: boolean;
  /** Whether content should be appended (true) or replaced (false) */
  shouldAppend: boolean;
  /** Context ID for conversation continuity */
  contextId?: string;
  /** Task ID if present */
  taskId?: string;
}

/**
 * A2A SDK Client - Uses official @a2a-js/sdk for protocol compliance
 */
export class A2ASDKClient {
  private transport: JsonRpcTransport;
  private accessToken?: string;
  private abortController: AbortController | null = null;

  constructor(config: A2ASDKClientConfig) {
    this.accessToken = config.accessToken;

    // Create fetch with authentication if token provided
    const fetchImpl = this.accessToken
      ? this.createAuthenticatedFetch(this.accessToken)
      : fetch;

    this.transport = new JsonRpcTransport({
      endpoint: config.endpoint,
      fetchImpl,
    });
  }

  /**
   * Update the access token (e.g., after token refresh)
   */
  setAccessToken(token: string | undefined): void {
    this.accessToken = token;
    
    // Recreate transport with new token
    const fetchImpl = token
      ? this.createAuthenticatedFetch(token)
      : fetch;

    this.transport = new JsonRpcTransport({
      endpoint: (this.transport as unknown as { endpoint: string }).endpoint,
      fetchImpl,
    });
  }

  /**
   * Create authenticated fetch with Bearer token
   */
  private createAuthenticatedFetch(token: string): typeof fetch {
    const authHandler: AuthenticationHandler = {
      headers: async () => ({
        Authorization: `Bearer ${token}`,
      }),
      shouldRetryWithHeaders: async (_req, res) => {
        // Could implement token refresh logic here
        if (res.status === 401) {
          console.warn("[A2A SDK] Received 401 - token may be expired");
        }
        return undefined; // No retry for now
      },
    };

    return createAuthenticatingFetchWithRetry(fetch, authHandler);
  }

  /**
   * Send a message and stream the response using AsyncGenerator
   * 
   * This is the same pattern agent-forge uses, ensuring consistent behavior.
   * 
   * @param message The user's message text
   * @param contextId Optional context ID for conversation continuity
   * @returns AsyncGenerator that yields parsed A2A events
   */
  async *sendMessageStream(
    message: string,
    contextId?: string
  ): AsyncGenerator<ParsedA2AEvent, void, undefined> {
    // Abort any previous request
    if (this.abortController) {
      console.log("[A2A SDK] Aborting previous request");
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const messageId = uuidv4();
    
    const params: MessageSendParams = {
      message: {
        kind: "message",
        messageId,
        role: "user",
        parts: [{ kind: "text", text: message }],
        ...(contextId && { contextId }),
      },
    };

    console.log(`[A2A SDK] 📤 Sending message to endpoint`);
    console.log(`[A2A SDK] 📤 contextId: ${contextId || "new conversation"}`);

    let eventCount = 0;
    
    try {
      // Use the SDK's streaming method - returns AsyncGenerator
      const stream = this.transport.sendMessageStream(params, {
        signal: this.abortController.signal,
      });

      for await (const event of stream) {
        eventCount++;
        
        // Parse and yield the event
        const parsed = this.parseEvent(event, eventCount);
        
        if (parsed) {
          yield parsed;
        }

        // Check for completion signals
        if (this.isStreamComplete(event)) {
          console.log(`[A2A SDK] 🏁 Stream complete after ${eventCount} events`);
          break;
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log(`[A2A SDK] Stream aborted after ${eventCount} events`);
      } else {
        console.error(`[A2A SDK] Stream error:`, error);
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Abort the current stream
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Parse a raw SDK event into a ParsedA2AEvent for UI consumption
   */
  private parseEvent(event: A2AStreamEvent, eventNum: number): ParsedA2AEvent | null {
    // Determine event type
    const kind = (event as { kind?: string }).kind;
    
    if (kind === "message") {
      return this.parseMessageEvent(event as Message, eventNum);
    } else if (kind === "task") {
      return this.parseTaskEvent(event as Task, eventNum);
    } else if (kind === "status-update") {
      return this.parseStatusEvent(event as TaskStatusUpdateEvent, eventNum);
    } else if (kind === "artifact-update") {
      return this.parseArtifactEvent(event as TaskArtifactUpdateEvent, eventNum);
    }

    console.log(`[A2A SDK] Unknown event kind: ${kind}`);
    return null;
  }

  /**
   * Parse a Message event
   */
  private parseMessageEvent(msg: Message, eventNum: number): ParsedA2AEvent {
    const textContent = this.extractTextFromParts(msg.parts);
    
    console.log(`[A2A SDK] #${eventNum} MESSAGE (${msg.role}): ${textContent.substring(0, 100)}...`);

    return {
      raw: msg,
      type: "message",
      displayContent: textContent,
      isFinal: false,
      shouldAppend: true,
      contextId: msg.contextId,
    };
  }

  /**
   * Parse a Task event
   */
  private parseTaskEvent(task: Task, eventNum: number): ParsedA2AEvent {
    console.log(`[A2A SDK] #${eventNum} TASK: ${task.id} status=${task.status?.state}`);

    // Extract text from artifacts if present
    let textContent = "";
    if (task.artifacts && task.artifacts.length > 0) {
      // Look for final_result artifact first
      const finalArtifact = task.artifacts.find(a => a.name === "final_result");
      const artifact = finalArtifact || task.artifacts[task.artifacts.length - 1];
      
      if (artifact && artifact.parts) {
        textContent = this.extractTextFromParts(artifact.parts);
      }
    }

    const isFinal = task.status?.state === "completed";

    return {
      raw: task,
      type: "task",
      displayContent: textContent,
      isFinal,
      shouldAppend: false, // Task events typically replace content
      contextId: task.contextId,
      taskId: task.id,
    };
  }

  /**
   * Parse a TaskStatusUpdateEvent
   */
  private parseStatusEvent(event: TaskStatusUpdateEvent, eventNum: number): ParsedA2AEvent {
    console.log(`[A2A SDK] #${eventNum} STATUS: ${event.status?.state} final=${event.final}`);

    return {
      raw: event,
      type: "status",
      displayContent: "",
      isFinal: event.final === true || event.status?.state === "completed",
      shouldAppend: false,
      contextId: event.contextId,
      taskId: event.taskId,
    };
  }

  /**
   * Parse a TaskArtifactUpdateEvent
   */
  private parseArtifactEvent(event: TaskArtifactUpdateEvent, eventNum: number): ParsedA2AEvent {
    const artifact = event.artifact;
    const artifactName = artifact?.name || "";
    const textContent = artifact?.parts ? this.extractTextFromParts(artifact.parts) : "";
    
    // Determine if this is a final result
    const isFinalResult = artifactName === "final_result" || artifactName === "partial_result";
    const shouldAppend = event.append !== false;

    console.log(`[A2A SDK] #${eventNum} ARTIFACT: ${artifactName} append=${shouldAppend} content=${textContent.length} chars`);

    if (isFinalResult) {
      console.log(`[A2A SDK] 🎉 ${artifactName.toUpperCase()} RECEIVED!`);
    }

    return {
      raw: event,
      type: "artifact",
      artifactName,
      displayContent: textContent,
      isFinal: isFinalResult,
      shouldAppend,
      contextId: event.contextId,
      taskId: event.taskId,
    };
  }

  /**
   * Extract text content from message/artifact parts
   */
  private extractTextFromParts(parts: (TextPart | DataPart | FilePart)[] | undefined): string {
    if (!parts || !Array.isArray(parts)) return "";

    return parts
      .filter((p): p is TextPart => (p as TextPart).kind === "text")
      .map((p) => p.text || "")
      .join("");
  }

  /**
   * Check if the stream should be considered complete
   */
  private isStreamComplete(event: A2AStreamEvent): boolean {
    const kind = (event as { kind?: string }).kind;

    if (kind === "status-update") {
      const statusEvent = event as TaskStatusUpdateEvent;
      return (
        statusEvent.final === true ||
        statusEvent.status?.state === "completed" ||
        statusEvent.status?.state === "failed" ||
        statusEvent.status?.state === "canceled"
      );
    }

    if (kind === "task") {
      const taskEvent = event as Task;
      return (
        taskEvent.status?.state === "completed" ||
        taskEvent.status?.state === "failed" ||
        taskEvent.status?.state === "canceled"
      );
    }

    return false;
  }
}

/**
 * Helper to format artifact names for display
 */
export function formatArtifactName(name: string): string {
  const nameMap: Record<string, string> = {
    streaming_result: "Streaming",
    partial_result: "Result",
    final_result: "Final Result",
    complete_result: "Complete",
    tool_notification_start: "Tool Start",
    tool_notification_end: "Tool End",
    execution_plan_update: "Execution Plan",
    execution_plan_status_update: "Plan Status",
    UserInputMetaData: "User Input",
  };

  return nameMap[name] || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get color for artifact based on name
 */
function getArtifactColor(artifactName: string): string {
  if (artifactName.includes("tool_notification_start")) return "a2a-tool-start";
  if (artifactName.includes("tool_notification_end")) return "a2a-tool-end";
  if (artifactName.includes("execution_plan")) return "a2a-plan";
  if (artifactName === "final_result" || artifactName === "partial_result") return "a2a-result";
  if (artifactName === "streaming_result") return "a2a-streaming";
  return "a2a-default";
}

/**
 * Get icon for artifact based on name
 */
function getArtifactIcon(artifactName: string): string {
  if (artifactName.includes("tool_notification_start")) return "Play";
  if (artifactName.includes("tool_notification_end")) return "CheckCircle";
  if (artifactName.includes("execution_plan")) return "ListTodo";
  if (artifactName === "final_result" || artifactName === "partial_result") return "FileText";
  if (artifactName === "streaming_result") return "Activity";
  return "Box";
}

/**
 * Convert ParsedA2AEvent to the A2AEvent format expected by the store
 * This ensures all required fields are present for UI rendering
 */
export function toStoreEvent(event: ParsedA2AEvent, eventId?: string): {
  id: string;
  timestamp: Date;
  type: "task" | "artifact" | "status" | "message" | "tool_start" | "tool_end" | "error";
  raw: unknown;
  taskId?: string;
  contextId?: string;
  artifact?: unknown;
  isFinal?: boolean;
  isLastChunk?: boolean;
  shouldAppend?: boolean;
  sourceAgent?: string;
  displayName: string;
  displayContent: string;
  color: string;
  icon: string;
} {
  const artifactName = event.artifactName || "";
  
  // Determine event type for store
  let storeType: "task" | "artifact" | "status" | "message" | "tool_start" | "tool_end" | "error" = "artifact";
  if (event.type === "task") storeType = "task";
  else if (event.type === "status") storeType = "status";
  else if (event.type === "message") storeType = "message";
  else if (artifactName === "tool_notification_start") storeType = "tool_start";
  else if (artifactName === "tool_notification_end") storeType = "tool_end";

  // Extract artifact from raw event
  let artifact: unknown = undefined;
  if (event.raw && "artifact" in event.raw) {
    artifact = (event.raw as { artifact?: unknown }).artifact;
  }

  return {
    id: eventId || `event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    type: storeType,
    raw: event.raw,
    taskId: event.taskId,
    contextId: event.contextId,
    artifact,
    isFinal: event.isFinal,
    isLastChunk: event.isFinal,
    shouldAppend: event.shouldAppend,
    sourceAgent: undefined, // Could extract from artifact description if needed
    displayName: formatArtifactName(artifactName) || event.type,
    displayContent: event.displayContent,
    color: getArtifactColor(artifactName),
    icon: getArtifactIcon(artifactName),
  };
}
