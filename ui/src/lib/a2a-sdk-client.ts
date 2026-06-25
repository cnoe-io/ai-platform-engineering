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
  /** User email for tracking who is making requests */
  userEmail?: string;
  /** Timeout in milliseconds for requests (default: 300000 = 5 minutes) */
  timeoutMs?: number;
}

/**
 * Input field definition for HITL forms
 */
export interface HITLInputField {
  field_name: string;
  field_description: string;
  field_values?: string[] | null;
  required?: boolean;  // Optional fields have required: false (defaults to true)
  default_value?: string | null;  // Pre-populated default value
}

/**
 * HITL form data extracted from DataPart
 */
export interface HITLFormData {
  /** Whether this is an input-required form */
  requiresInput: boolean;
  /** Input fields for the form */
  inputFields?: HITLInputField[];
  /** Tool name that triggered the form */
  toolName?: string;
  /** Full tool calls data */
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

/**
 * HITL decision for resuming after form submission
 * Uses LangChain HITL format: approve, edit, or reject
 */
export interface HITLDecision {
  /** Decision type: approve (execute as-is), edit (execute with modified args), or reject */
  type: 'approve' | 'edit' | 'reject';
  /** Action/tool name this decision applies to */
  actionName: string;
  /** Edited args (for 'edit' type) - contains the modified tool arguments */
  args?: Record<string, unknown>;
  /** Message/reason (for 'reject' type) */
  message?: string;
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
  /** Source agent name if present (from artifact metadata) */
  sourceAgent?: string;
  /** HITL form data if this is an input-required event */
  hitlFormData?: HITLFormData;
  /** Whether this event requires user input */
  requiresInput?: boolean;
}

/**
 * A2A SDK Client - Uses official @a2a-js/sdk for protocol compliance
 */
export class A2ASDKClient {
  private transport: JsonRpcTransport;
  private accessToken?: string;
  private userEmail?: string;
  private abortController: AbortController | null = null;

  constructor(config: A2ASDKClientConfig) {
    this.accessToken = config.accessToken;
    this.userEmail = config.userEmail;

    // Create fetch with authentication if token provided
    // Note: In browsers, fetch must be bound to window to avoid "Illegal invocation" errors
    const boundFetch: typeof fetch = (...args) => fetch(...args);
    const fetchImpl = this.accessToken
      ? this.createAuthenticatedFetch(this.accessToken)
      : boundFetch;

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
    // Note: In browsers, fetch must be bound to window to avoid "Illegal invocation" errors
    const boundFetch: typeof fetch = (...args) => fetch(...args);
    const fetchImpl = token
      ? this.createAuthenticatedFetch(token)
      : boundFetch;

    this.transport = new JsonRpcTransport({
      endpoint: (this.transport as unknown as { endpoint: string }).endpoint,
      fetchImpl,
    });
  }

  /**
   * Create authenticated fetch with Bearer token
   */
  private createAuthenticatedFetch(token: string): typeof fetch {
    // In browsers, fetch must be bound to window to avoid "Illegal invocation" errors
    const boundFetch: typeof fetch = (...args) => fetch(...args);
    
    const authHandler: AuthenticationHandler = {
      headers: async () => ({
        Authorization: `Bearer ${token}`,
      }),
      shouldRetryWithHeaders: async (_req, res) => {
        // Handle 401 Unauthorized - token expired
        if (res.status === 401) {
          console.error("[A2A SDK] Received 401 - SSO token expired");

          // Throw error to be caught by caller
          throw new Error(
            "Session expired: Your authentication token has expired. " +
            "Please save your work and log in again."
          );
        }
        return undefined; // No retry for now
      },
    };

    return createAuthenticatingFetchWithRetry(boundFetch, authHandler);
  }

  /**
   * HITL Decision types for form responses (LangChain HITL format)
   */
  static readonly DECISION_TYPES = {
    APPROVE: 'approve',  // Execute tool call as-is
    EDIT: 'edit',        // Execute with modified args
    REJECT: 'reject',    // Reject the tool call with message
  } as const;

  /**
   * Send a message and stream the response using AsyncGenerator
   *
   * This is the same pattern agent-forge uses, ensuring consistent behavior.
   *
   * @param message The user's message text
   * @param contextId Optional context ID for conversation continuity
   * @param metadata Optional metadata (e.g., resume command for HITL)
   * @returns AsyncGenerator that yields parsed A2A events
   */
  async *sendMessageStream(
    message: string,
    contextId?: string,
    metadata?: Record<string, unknown>
  ): AsyncGenerator<ParsedA2AEvent, void, undefined> {
    // Abort any previous request
    if (this.abortController) {
      console.log("[A2A SDK] Aborting previous request");
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const messageId = uuidv4();

    // Prepend user context if email is available
    // This enables agents to track which user is making the request
    const messageWithContext = this.userEmail
      ? `by user: ${this.userEmail}\n\n${message}`
      : message;

    // Build message parts - include metadata as DataPart if provided
    const parts: Array<{ kind: string; text?: string; data?: Record<string, unknown> }> = [
      { kind: "text", text: messageWithContext }
    ];
    
    // Add metadata as a DataPart for HITL resume
    if (metadata) {
      parts.push({ kind: "data", data: metadata });
    }

    const params: MessageSendParams = {
      message: {
        kind: "message",
        messageId,
        role: "user",
        parts: parts as MessageSendParams["message"]["parts"],
        ...(contextId && { contextId }),
      },
    };

    console.log(`[A2A SDK] 📤 Sending message to endpoint`);
    console.log(`[A2A SDK] 📤 User: ${this.userEmail || "anonymous"}`);
    console.log(`[A2A SDK] 📤 contextId: ${contextId || "new conversation"}`);
    if (metadata) {
      console.log(`[A2A SDK] 📤 metadata:`, metadata);
    }

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

      // Log if stream ended without explicit completion signal
      console.log(`[A2A SDK] 📡 Stream ended naturally after ${eventCount} events`);
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
   * Send a HITL form response (approve/edit/reject)
   * 
   * @param contextId The conversation context ID
   * @param decisions Array of decisions for each action in the form
   * @returns AsyncGenerator that yields parsed A2A events
   */
  async *sendHITLResponse(
    contextId: string,
    decisions: HITLDecision[]
  ): AsyncGenerator<ParsedA2AEvent, void, undefined> {
    // Format decisions for the backend
    const formattedDecisions = decisions.map(decision => ({
      type: decision.type,
      action_name: decision.actionName,
      args: decision.args,
      message: decision.message,
    }));

    const metadata = {
      resume: {
        decisions: formattedDecisions,
      },
    };

    // Send empty message with resume metadata
    const message = decisions.length === 1 && decisions[0].type === 'reject' && decisions[0].message
      ? decisions[0].message
      : "Form submitted";

    console.log(`[A2A SDK] 📤 Sending HITL response with ${decisions.length} decisions`);

    // Use sendMessageStream with metadata
    yield* this.sendMessageStream(message, contextId, metadata);
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
    let artifactName: string | undefined = undefined;
    if (task.artifacts && task.artifacts.length > 0) {
      // Look for execution plan artifacts first (for task/status rendering)
      const executionPlanArtifact = task.artifacts.find(
        a => a.name === "execution_plan_update" || a.name === "execution_plan_status_update"
      );
      // Then look for final_result artifact
      const finalArtifact = task.artifacts.find(a => a.name === "final_result");
      const artifact = executionPlanArtifact || finalArtifact || task.artifacts[task.artifacts.length - 1];

      if (artifact) {
        artifactName = artifact.name;
        if (artifact.parts) {
          textContent = this.extractTextFromParts(artifact.parts);
        }
      }
    }

    // If no text content from artifacts, create a meaningful default message
    if (!textContent) {
      const status = task.status?.state || "unknown";
      textContent = `Task ${status} (ID: ${task.id.substring(0, 8)}...)`;
    }

    const isFinal = task.status?.state === "completed";

    return {
      raw: task,
      type: "task",
      artifactName,
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
    const state = event.status?.state || "unknown";
    const isInputRequired = state === "input-required";
    
    console.log(`[A2A SDK] #${eventNum} STATUS: ${state} final=${event.final} inputRequired=${isInputRequired}`);

    // Create meaningful display content for status updates
    const finalText = event.final ? " (final)" : "";
    const taskIdShort = event.taskId ? ` - Task: ${event.taskId.substring(0, 8)}...` : "";
    const displayContent = `Status: ${state}${finalText}${taskIdShort}`;

    return {
      raw: event,
      type: "status",
      displayContent,
      isFinal: event.final === true || event.status?.state === "completed",
      shouldAppend: false,
      contextId: event.contextId,
      taskId: event.taskId,
      requiresInput: isInputRequired,
    };
  }

  /**
   * Parse a TaskArtifactUpdateEvent
   */
  private parseArtifactEvent(event: TaskArtifactUpdateEvent, eventNum: number): ParsedA2AEvent {
    const artifact = event.artifact;
    const artifactName = artifact?.name || "";
    const textContent = artifact?.parts ? this.extractTextFromParts(artifact.parts) : "";

    // Extract sourceAgent from artifact metadata
    const sourceAgent = artifact?.metadata?.sourceAgent as string | undefined;

    // Determine if this is a final result
    const isFinalResult = artifactName === "final_result" || artifactName === "partial_result";
    const shouldAppend = event.append !== false;

    // Check for HITL form data (caipe_form artifact)
    let hitlFormData: HITLFormData | undefined = undefined;
    if (artifactName === "caipe_form" && artifact?.parts) {
      hitlFormData = this.extractHITLFormData(artifact.parts);
      if (hitlFormData?.requiresInput) {
        console.log(`[A2A SDK] #${eventNum} 📋 HITL FORM: ${hitlFormData.toolName || 'unknown'} with ${hitlFormData.inputFields?.length || 0} fields`);
      }
    }

    console.log(`[A2A SDK] #${eventNum} ARTIFACT: ${artifactName} append=${shouldAppend} content=${textContent.length} chars agent=${sourceAgent || 'none'}`);

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
      sourceAgent, // Include sourceAgent in parsed event
      hitlFormData,
      requiresInput: hitlFormData?.requiresInput,
    };
  }

  /**
   * Extract HITL form data from artifact parts (DataPart)
   */
  private extractHITLFormData(parts: (TextPart | DataPart | FilePart)[] | undefined): HITLFormData | undefined {
    if (!parts || !Array.isArray(parts)) return undefined;

    for (const part of parts) {
      // Check for DataPart (kind === "data" or has data property)
      const dataPart = part as DataPart;
      if (dataPart.kind === "data" && dataPart.data) {
        return this.parseHITLDataPart(dataPart.data);
      }
      // Also check for nested root structure (A2A SDK sometimes wraps parts)
      const nestedPart = part as { root?: DataPart };
      if (nestedPart.root?.kind === "data" && nestedPart.root?.data) {
        return this.parseHITLDataPart(nestedPart.root.data);
      }
    }

    return undefined;
  }

  /**
   * Parse the data from a DataPart to extract HITL form fields
   */
  private parseHITLDataPart(data: Record<string, unknown>): HITLFormData | undefined {
    // The data structure from agent_executor.py can be in several formats:
    // 
    // Format 1 (direct tool_calls):
    // {
    //   "tool_calls": [{ "name": "CAIPEAgentResponse", "args": { "metadata": { "input_fields": [...] } } }],
    //   "additional_kwargs": { "agent_type": "caipe" }
    // }
    //
    // Format 2 (langchain message_to_dict output):
    // {
    //   "type": "ai",
    //   "content": "...",
    //   "tool_calls": [...],
    //   ...
    // }
    //
    // Format 3 (nested in data key - from message_to_dict["data"]):
    // {
    //   "content": "...",
    //   "tool_calls": [...],
    //   ...
    // }
    
    // First, try direct tool_calls
    let toolCalls = data.tool_calls as Array<{ name: string; args: Record<string, unknown> }> | undefined;
    
    // If not found, check additional_kwargs
    if (!toolCalls || toolCalls.length === 0) {
      const additionalKwargs = data.additional_kwargs as Record<string, unknown> | undefined;
      if (additionalKwargs?.tool_calls) {
        toolCalls = additionalKwargs.tool_calls as Array<{ name: string; args: Record<string, unknown> }>;
      }
    }
    
    // If found tool_calls, extract form fields
    if (toolCalls && toolCalls.length > 0) {
      console.log('[A2A SDK] Found tool_calls in HITL data:', toolCalls);
      return this.extractFromToolCalls(toolCalls);
    }

    // Try alternate structures
    const content = data.content;
    
    // Check for content that contains input_fields
    if (content) {
      // Content can be a string (JSON) or an array (Bedrock/Anthropic format)
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          if (parsed.metadata?.input_fields) {
            console.log('[A2A SDK] Found input_fields in parsed content');
            return {
              requiresInput: true,
              inputFields: parsed.metadata.input_fields as HITLInputField[],
              toolName: 'CAIPEAgentResponse',
            };
          }
        } catch {
          // Not JSON, continue
        }
      } else if (Array.isArray(content)) {
        // Bedrock format: content is array of objects like [{ type: "tool_use", name, input: {...} }]
        console.log('[A2A SDK] content is array, checking for tool_use');
        for (const item of content) {
          if (item && typeof item === 'object') {
            const contentItem = item as { type?: string; name?: string; input?: Record<string, unknown> };
            if (contentItem.type === 'tool_use' && contentItem.input) {
              const metadata = contentItem.input.metadata as { input_fields?: HITLInputField[] } | undefined;
              if (metadata?.input_fields) {
                console.log('[A2A SDK] Found input_fields in content array tool_use item');
                return {
                  requiresInput: true,
                  inputFields: metadata.input_fields,
                  toolName: contentItem.name || 'CAIPEAgentResponse',
                };
              }
            }
          }
        }
      }
    }
    
    // Check if there's a nested 'data' key (from message_to_dict wrapper)
    const nestedData = data.data as Record<string, unknown> | undefined;
    if (nestedData) {
      console.log('[A2A SDK] Found nested data, recursing');
      return this.parseHITLDataPart(nestedData);
    }
    
    console.log('[A2A SDK] Could not find tool_calls in HITL data:', Object.keys(data));
    return undefined;
  }

  /**
   * Extract HITL form data from tool_calls array
   */
  private extractFromToolCalls(toolCalls: Array<{ name: string; args: Record<string, unknown> }>): HITLFormData | undefined {
    const inputFields: HITLInputField[] = [];
    let toolName: string | undefined;

    for (const toolCall of toolCalls) {
      toolName = toolCall.name;
      const args = toolCall.args || {};
      
      // Check for metadata.input_fields pattern (CAIPEAgentResponse)
      const metadata = args.metadata as { input_fields?: HITLInputField[] } | undefined;
      if (metadata?.input_fields) {
        inputFields.push(...metadata.input_fields);
      }
      
      // Also check for direct input_fields
      const directInputFields = args.input_fields as HITLInputField[] | undefined;
      if (directInputFields) {
        inputFields.push(...directInputFields);
      }
    }

    if (inputFields.length === 0) {
      return undefined;
    }

    return {
      requiresInput: true,
      inputFields,
      toolName,
      toolCalls,
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
  type: "task" | "artifact" | "status" | "message" | "tool_start" | "tool_end" | "execution_plan" | "error";
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
  let storeType: "task" | "artifact" | "status" | "message" | "tool_start" | "tool_end" | "execution_plan" | "error" = "artifact";
  if (event.type === "task") storeType = "task";
  else if (event.type === "status") storeType = "status";
  else if (event.type === "message") storeType = "message";
  else if (artifactName === "tool_notification_start") storeType = "tool_start";
  else if (artifactName === "tool_notification_end") storeType = "tool_end";
  else if (artifactName === "execution_plan_update" || artifactName === "execution_plan_status_update") storeType = "execution_plan";

  // Extract artifact from raw event - ensure it has proper structure
  let artifact: unknown = undefined;
  let extractedSourceAgent: string | undefined = event.sourceAgent;

  // Handle TaskArtifactUpdateEvent (has artifact property)
  if (event.raw && "artifact" in event.raw) {
    const rawArtifact = (event.raw as { artifact?: unknown }).artifact;
    // Ensure artifact has name property for parsing
    if (rawArtifact && typeof rawArtifact === "object") {
      const artifactObj = rawArtifact as { name?: string; metadata?: { sourceAgent?: string } };
      // Extract sourceAgent from artifact metadata if not already set
      if (!extractedSourceAgent && artifactObj.metadata?.sourceAgent) {
        extractedSourceAgent = artifactObj.metadata.sourceAgent;
      }
      artifact = {
        ...rawArtifact,
        name: artifactName || artifactObj.name,
      };
    } else {
      artifact = rawArtifact;
    }
  }
  // Handle Task events (has artifacts array)
  else if (event.raw && "artifacts" in event.raw && Array.isArray((event.raw as { artifacts?: unknown[] }).artifacts)) {
    const artifacts = (event.raw as { artifacts?: unknown[] }).artifacts || [];
    // Find execution plan artifact if artifactName matches
    if (artifactName && (artifactName === "execution_plan_update" || artifactName === "execution_plan_status_update")) {
      const planArtifact = artifacts.find((a: unknown) =>
        a && typeof a === "object" && "name" in a &&
        ((a as { name?: string }).name === "execution_plan_update" || (a as { name?: string }).name === "execution_plan_status_update")
      );
      if (planArtifact) {
        artifact = planArtifact;
      }
    }
    // Otherwise use first artifact or last artifact
    else if (artifacts.length > 0) {
      artifact = artifacts[artifacts.length - 1];
    }
  }
  // Fallback: create artifact structure from artifactName
  else if (artifactName) {
    artifact = {
      name: artifactName,
      parts: event.displayContent ? [{ kind: "text", text: event.displayContent }] : [],
    };
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
    sourceAgent: extractedSourceAgent, // Extract from parsed event or artifact metadata
    displayName: formatArtifactName(artifactName) || event.type,
    displayContent: event.displayContent,
    color: getArtifactColor(artifactName),
    icon: getArtifactIcon(artifactName),
  };
}
