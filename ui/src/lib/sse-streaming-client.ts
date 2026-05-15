/**
 * Simple SSE client for Platform Engineer streaming.
 * Much simpler than A2A - just POST and stream events.
 *
 * Used by: ticket-client, SkillsRunner, SkillsBuilderEditor, AgentBuilderRunner
 * for features that connect to the plain SSE /api/chat/stream endpoint.
 */

export interface SSEClientConfig {
  endpoint: string;
  accessToken?: string;
  onEvent?: (event: SSEEvent) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  /** Timeout in milliseconds for SSE stream inactivity. Default: 900000 (15 minutes) */
  streamTimeoutMs?: number;
}

export interface PlanStep {
  id: string;
  agent: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "input_required";
}

export interface InputField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
}

export interface SSEEvent {
  type: "content" | "tool_start" | "tool_end" | "plan_update" | "input_required" | "done" | "error";
  // Content event
  text?: string;
  // Tool events
  tool?: string;
  description?: string;
  // Plan update
  steps?: PlanStep[];
  // Input required (HITL)
  fields?: InputField[];
  // Done event
  turn_id?: string;
  // Error event
  message?: string;
}

export interface ChatRequest {
  message: string;
  conversation_id?: string;
  user_id?: string;
  user_email?: string;
  trace_id?: string;
  source?: "web" | "slack";
}

/** Default timeout: 15 minutes for long-running SSE streams */
const DEFAULT_STREAM_TIMEOUT_MS = 900_000;

export class SSEClient {
  private abortController: AbortController | null = null;

  constructor(private config: SSEClientConfig) {}

  /**
   * Update the access token (e.g., after token refresh)
   */
  setAccessToken(token: string | undefined): void {
    this.config = { ...this.config, accessToken: token };
  }

  async sendMessage(request: ChatRequest): Promise<void> {
    // Abort any previous request before starting a new one
    if (this.abortController) {
      console.log("[SSE Client] Aborting previous request before starting new one");
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "X-Client-Source": "caipe-ui",
    };

    if (this.config.accessToken) {
      headers["Authorization"] = `Bearer ${this.config.accessToken}`;
    }

    console.log(`[SSE Client] Sending message to ${this.config.endpoint}`);

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: this.abortController.signal,
      cache: "no-store",
    });

    console.log(`[SSE Client] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      if (response.status === 401) {
        const errorMessage =
          "Session expired: Your authentication token has expired. " +
          "Please save your work and log in again.";
        console.error(`[SSE Client] ${errorMessage}`);
        throw new Error(errorMessage);
      }
      throw new Error(`SSE request failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    await this.processStream(response.body);
  }

  private async processStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventCount = 0;
    let lastEventTime = Date.now();

    const timeoutMs = this.config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
    let activityTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const resetActivityTimeout = () => {
      if (activityTimeoutId) clearTimeout(activityTimeoutId);
      activityTimeoutId = setTimeout(() => {
        console.error(
          `[SSE Client] Stream timeout after ${timeoutMs / 1000}s of inactivity. Events received: ${eventCount}`
        );
        this.abort();
      }, timeoutMs);
    };

    const clearActivityTimeout = () => {
      if (activityTimeoutId) {
        clearTimeout(activityTimeoutId);
        activityTimeoutId = null;
      }
    };

    resetActivityTimeout();
    console.log(`[SSE Client] Stream timeout set to ${timeoutMs / 1000} seconds`);

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          clearActivityTimeout();
          console.log(
            `[SSE Client] Stream ended. Total events: ${eventCount}, time since last event: ${Date.now() - lastEventTime}ms`
          );
          this.config.onComplete?.();
          break;
        }

        resetActivityTimeout();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          // Handle keep-alive comments and blank lines
          if (line.trim() === "" || line.startsWith(":")) {
            lastEventTime = Date.now();
            continue;
          }

          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event: SSEEvent = JSON.parse(jsonStr);
              eventCount++;
              lastEventTime = Date.now();

              if (eventCount % 100 === 0) {
                console.log(`[SSE Client] Progress: ${eventCount} events received`);
              }

              this.config.onEvent?.(event);

              if (event.type === "done") {
                clearActivityTimeout();
                this.config.onComplete?.();
                // Drain the rest of the reader and return
                reader.cancel();
                return;
              }
            } catch (e) {
              console.error("[SSE Client] Failed to parse SSE event:", e, "Line:", line.substring(0, 200));
            }
          }
        }
      }
    } catch (error) {
      clearActivityTimeout();
      if (error instanceof Error && error.name === "AbortError") {
        console.log(`[SSE Client] Stream aborted. Total events: ${eventCount}`);
        return;
      }
      console.error(`[SSE Client] Stream error after ${eventCount} events:`, error);
      this.config.onError?.(error as Error);
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
