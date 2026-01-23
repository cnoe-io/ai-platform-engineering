import { A2AMessage, A2AEvent, A2ARequest } from "@/types/a2a";
import { generateId } from "./utils";

export interface A2AClientConfig {
  endpoint: string;
  /** JWT access token for Bearer authentication */
  accessToken?: string;
  onEvent?: (event: A2AEvent) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  /** Timeout in milliseconds for SSE stream inactivity. Default: 900000 (15 minutes) */
  streamTimeoutMs?: number;
}

/** Default timeout: 15 minutes (900 seconds) for long-running A2A streams */
const DEFAULT_STREAM_TIMEOUT_MS = 900000;

export class A2AClient {
  private endpoint: string;
  private accessToken?: string;
  private abortController: AbortController | null = null;

  constructor(private config: A2AClientConfig) {
    this.endpoint = config.endpoint;
    this.accessToken = config.accessToken;
  }

  /**
   * Update the access token (e.g., after token refresh)
   */
  setAccessToken(token: string | undefined): void {
    this.accessToken = token;
  }

  async sendMessage(
    message: string,
    contextId?: string
  ): Promise<ReadableStreamDefaultReader<A2AEvent>> {
    // Abort any previous request to prevent connection conflicts
    if (this.abortController) {
      console.log(`[A2A Client] 🔄 Aborting previous request before starting new one`);
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const request: A2ARequest = {
      jsonrpc: "2.0",
      id: generateId(),
      method: "message/stream",
      params: {
        message: {
          messageId: generateId(),
          role: "user",
          parts: [{ text: message }],
          // contextId MUST be inside message for A2A conversation continuity
          ...(contextId && { contextId }),
        },
      },
    };

    // Build headers with optional Bearer token
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      // Request keep-alive to maintain SSE connection
      "Connection": "keep-alive",
    };

    // Add Authorization header if access token is available
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    console.log(`[A2A Client] 📤 Sending message to ${this.endpoint}`);
    console.log(`[A2A Client] 📤 contextId: ${contextId}`);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: this.abortController.signal,
      // Prevent caching and connection reuse issues
      cache: "no-store",
      // @ts-expect-error - keepalive is valid for fetch but not in all TS types
      keepalive: false, // We want long-lived SSE, not keepalive which is for short requests
    });

    console.log(`[A2A Client] 📥 Response status: ${response.status} ${response.statusText}`);
    console.log(`[A2A Client] 📥 Response headers: Content-Type=${response.headers.get("content-type")}`);

    if (!response.ok) {
      throw new Error(`A2A request failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return this.createEventStream(reader, decoder);
  }

  private createEventStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder
  ): ReadableStreamDefaultReader<A2AEvent> {
    let buffer = "";
    let eventCount = 0;
    let lastEventTime = Date.now();
    let receivedFinalResult = false;
    
    // Activity-based timeout (15 minutes default)
    const timeoutMs = this.config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
    let activityTimeoutId: ReturnType<typeof setTimeout> | null = null;
    
    const resetActivityTimeout = () => {
      if (activityTimeoutId) {
        clearTimeout(activityTimeoutId);
      }
      activityTimeoutId = setTimeout(() => {
        console.error(`[A2A Client] ⏰ Stream timeout after ${timeoutMs / 1000}s of inactivity. Events received: ${eventCount}`);
        this.abort();
      }, timeoutMs);
    };
    
    const clearActivityTimeout = () => {
      if (activityTimeoutId) {
        clearTimeout(activityTimeoutId);
        activityTimeoutId = null;
      }
    };
    
    // Start the activity timeout
    resetActivityTimeout();
    console.log(`[A2A Client] ⏱️ Stream timeout set to ${timeoutMs / 1000} seconds`);

    const stream = new ReadableStream<A2AEvent>({
      pull: async (controller) => {
        try {
          // Log when we're waiting for data (helps detect stuck streams)
          const readStartTime = Date.now();
          const { done, value } = await reader.read();
          const readDuration = Date.now() - readStartTime;
          
          // Log if read took unusually long (possible network issue)
          if (readDuration > 5000) {
            console.log(`[A2A Client] ⏳ Read took ${readDuration}ms (possible network delay)`);
          }

          if (done) {
            clearActivityTimeout();
            console.log(`[A2A Client] 🏁 Stream ended (done=true). Total events: ${eventCount}, receivedFinalResult: ${receivedFinalResult}`);
            console.log(`[A2A Client] 🏁 Time since last event: ${Date.now() - lastEventTime}ms`);
            if (!receivedFinalResult) {
              console.warn(`[A2A Client] ⚠️ Stream ended WITHOUT receiving final_result!`);
            }
            this.config.onComplete?.();
            controller.close();
            return;
          }

          // Reset timeout on any data received
          resetActivityTimeout();
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            // Handle keep-alive/heartbeat (empty lines or comments)
            if (line.trim() === "" || line.startsWith(":")) {
              lastEventTime = Date.now();
              // Log heartbeat every 10 seconds of activity
              if (eventCount > 0 && eventCount % 50 === 0) {
                console.log(`[A2A Client] 💓 Stream alive - ${eventCount} events processed`);
              }
              continue;
            }

            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr) {
                try {
                  const message: A2AMessage = JSON.parse(jsonStr);
                  const event = this.parseA2AMessage(message);
                  if (event) {
                    eventCount++;
                    lastEventTime = Date.now();
                    
                    // Track if we received final_result
                    if (event.artifact?.name === "final_result" || event.artifact?.name === "partial_result") {
                      receivedFinalResult = true;
                      console.log(`[A2A Client] ✅ Received ${event.artifact.name} - event #${eventCount}`);
                    }
                    
                    // Log progress every 100 events to track stream health
                    if (eventCount % 100 === 0) {
                      console.log(`[A2A Client] 📊 Progress: ${eventCount} events received`);
                    }
                    
                    this.config.onEvent?.(event);
                    controller.enqueue(event);
                  }
                } catch (e) {
                  console.error("[A2A Client] Failed to parse A2A message:", e, "Line:", line.substring(0, 200));
                }
              }
            }
          }
        } catch (error) {
          clearActivityTimeout();
          if (error instanceof Error && error.name === "AbortError") {
            console.log(`[A2A Client] 🛑 Stream aborted. Total events: ${eventCount}`);
            controller.close();
            return;
          }
          console.error(`[A2A Client] ❌ Stream error after ${eventCount} events:`, error);
          this.config.onError?.(error as Error);
          controller.error(error);
        }
      },
      cancel: () => {
        clearActivityTimeout();
        console.log(`[A2A Client] 🛑 Stream cancelled. Total events: ${eventCount}`);
        this.abort();
      },
    });

    return stream.getReader();
  }

  private parseA2AMessage(message: A2AMessage): A2AEvent | null {
    const result = message.result;
    if (!result) {
      if (message.error) {
        return {
          id: generateId(),
          timestamp: new Date(),
          type: "error",
          raw: message,
          displayName: "Error",
          displayContent: message.error.message,
          color: "destructive",
          icon: "AlertCircle",
        };
      }
      return null;
    }

    const baseEvent = {
      id: generateId(),
      timestamp: new Date(),
      raw: message,
      taskId: result.taskId,
      contextId: result.contextId,
    };

    switch (result.kind) {
      case "task":
        return {
          ...baseEvent,
          type: "task",
          status: result.status,
          displayName: "Task",
          displayContent: result.status?.state || "unknown",
          color: "a2a-task",
          icon: "Layers",
        };

      case "artifact-update":
        const artifact = result.artifact;
        const artifactName = artifact?.name || "unknown";
        const isToolStart = artifactName === "tool_notification_start";
        const isToolEnd = artifactName === "tool_notification_end";

        let eventType: A2AEvent["type"] = "artifact";
        if (isToolStart) eventType = "tool_start";
        if (isToolEnd) eventType = "tool_end";

        // Extract ALL text parts from artifact, not just the first one
        // A2A library uses parts[].root.text structure (Part -> TextPart)
        const artifactText = artifact?.parts
          ?.filter((p: { kind?: string; root?: { kind?: string } }) => 
            p.kind === "text" || p.root?.kind === "text" || !p.kind)
          ?.map((p: { text?: string; root?: { text?: string } }) => 
            p.text || p.root?.text || "")
          ?.join("") || "";

        // Extract sourceAgent from artifact metadata for sub-agent message grouping
        const sourceAgent = artifact?.metadata?.sourceAgent as string | undefined;

        return {
          ...baseEvent,
          type: eventType,
          artifact: artifact,
          isLastChunk: result.lastChunk,
          // append flag from A2A: false = replace, true = append
          shouldAppend: result.append !== false, // default to append if not specified
          // Source agent for grouping sub-agent messages
          sourceAgent: sourceAgent || this.extractAgentFromDescription(artifact?.description),
          displayName: this.formatArtifactName(artifactName),
          displayContent: artifactText,
          color: this.getArtifactColor(artifactName),
          icon: this.getArtifactIcon(artifactName),
        };

      case "status-update":
        return {
          ...baseEvent,
          type: "status",
          status: result.status,
          isFinal: result.final,
          displayName: "Status",
          displayContent: result.status?.state || "unknown",
          color: "a2a-status",
          icon: "Activity",
        };

      case "message":
        // Extract ALL text from message parts (agent messages contain the actual content)
        // A2A library uses parts[].root.text structure (Part -> TextPart)
        const messageParts = result.parts || [];
        const messageText = messageParts
          .filter((p: { kind?: string; root?: { kind?: string } }) => 
            p.kind === "text" || p.root?.kind === "text" || !p.kind)
          .map((p: { text?: string; root?: { text?: string } }) => 
            p.text || p.root?.text || "")
          .join("");
        const isAgentMessage = result.role === "agent";

        return {
          ...baseEvent,
          type: "message",
          // For agent messages, append the content to the chat
          shouldAppend: isAgentMessage, // Agent messages should be appended
          displayName: isAgentMessage ? "Agent" : "Message",
          displayContent: messageText,
          color: "primary",
          icon: "MessageSquare",
        };

      default:
        return null;
    }
  }

  private formatArtifactName(name: string): string {
    const nameMap: Record<string, string> = {
      streaming_result: "Streaming",
      partial_result: "Result",
      final_result: "Final Result",
      tool_notification_start: "Tool Start",
      tool_notification_end: "Tool End",
      execution_plan_update: "Plan Update",
      execution_plan_status_update: "Plan Status",
      UserInputMetaData: "User Input",
    };
    return nameMap[name] || name;
  }

  private getArtifactColor(name: string): string {
    const colorMap: Record<string, string> = {
      streaming_result: "a2a-stream",
      partial_result: "a2a-artifact",
      final_result: "primary",
      tool_notification_start: "a2a-tool",
      tool_notification_end: "a2a-tool",
      execution_plan_update: "a2a-task",
      execution_plan_status_update: "a2a-status",
    };
    return colorMap[name] || "muted";
  }

  private getArtifactIcon(name: string): string {
    const iconMap: Record<string, string> = {
      streaming_result: "Radio",
      partial_result: "FileText",
      final_result: "CheckCircle",
      tool_notification_start: "Wrench",
      tool_notification_end: "CheckSquare",
      execution_plan_update: "ListTodo",
      execution_plan_status_update: "CircleDot",
    };
    return iconMap[name] || "Box";
  }

  /**
   * Extract agent name from artifact description as fallback
   * Handles patterns like "Tool call started: github" or "From github"
   */
  private extractAgentFromDescription(description?: string): string | undefined {
    if (!description) return undefined;

    // Pattern: "Tool call started: agentname" or "Tool call completed: agentname"
    const toolCallMatch = description.match(/Tool call (?:started|completed): (\w+)/i);
    if (toolCallMatch) return toolCallMatch[1].toLowerCase();

    // Pattern: "From agentname"
    const fromMatch = description.match(/From (\w+)/i);
    if (fromMatch && fromMatch[1].toLowerCase() !== "sub-agent") {
      return fromMatch[1].toLowerCase();
    }

    return undefined;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Cancel a running task via A2A protocol
   * This sends a tasks/cancel request to the backend
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const request: A2ARequest = {
      jsonrpc: "2.0",
      id: generateId(),
      method: "tasks/cancel",
      params: {
        taskId,
      },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        console.error("Failed to cancel task:", response.statusText);
        return false;
      }

      const result = await response.json();
      return !result.error;
    } catch (error) {
      console.error("Error cancelling task:", error);
      return false;
    }
  }

  /**
   * Get task status via A2A protocol
   */
  async getTaskStatus(taskId: string): Promise<unknown> {
    const request: A2ARequest = {
      jsonrpc: "2.0",
      id: generateId(),
      method: "tasks/get",
      params: {
        taskId,
      },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to get task: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error getting task status:", error);
      throw error;
    }
  }
}

// Singleton instance
let clientInstance: A2AClient | null = null;

export function getA2AClient(endpoint?: string): A2AClient {
  if (!clientInstance || endpoint) {
    clientInstance = new A2AClient({
      endpoint: endpoint || process.env.A2A_ENDPOINT || "http://localhost:8000",
    });
  }
  return clientInstance;
}
