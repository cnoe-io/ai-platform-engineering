import { A2AMessage, A2AEvent, A2ARequest } from "@/types/a2a";
import { generateId } from "./utils";

export interface A2AClientConfig {
  endpoint: string;
  /** JWT access token for Bearer authentication */
  accessToken?: string;
  onEvent?: (event: A2AEvent) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

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
    };

    // Add Authorization header if access token is available
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: this.abortController.signal,
    });

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

    const stream = new ReadableStream<A2AEvent>({
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();

          if (done) {
            this.config.onComplete?.();
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr) {
                try {
                  const message: A2AMessage = JSON.parse(jsonStr);
                  const event = this.parseA2AMessage(message);
                  if (event) {
                    this.config.onEvent?.(event);
                    controller.enqueue(event);
                  }
                } catch (e) {
                  console.error("Failed to parse A2A message:", e);
                }
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            controller.close();
            return;
          }
          this.config.onError?.(error as Error);
          controller.error(error);
        }
      },
      cancel: () => {
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

        return {
          ...baseEvent,
          type: eventType,
          artifact: artifact,
          isLastChunk: result.lastChunk,
          // append flag from A2A: false = replace, true = append
          shouldAppend: result.append !== false, // default to append if not specified
          displayName: this.formatArtifactName(artifactName),
          displayContent: artifact?.parts?.[0]?.text || "",
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
        // Extract text from message parts (agent messages contain the actual content)
        const messageParts = result.parts || [];
        const messageTextPart = messageParts.find((p: { kind?: string }) => p.kind === "text");
        const messageText = messageTextPart && "text" in messageTextPart ? (messageTextPart as { text: string }).text : "";
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
