/**
 * Dynamic Agent Client
 *
 * Lightweight SSE streaming client for Dynamic Agents.
 * POSTs to the UI proxy route and parses SSE events, yielding
 * SSEAgentEvent objects for ChatPanel to process.
 *
 * This client is intentionally separate from A2ASDKClient to maintain
 * clean architectural separation between A2A and Dynamic Agents.
 *
 * SSE event types from the backend (stream_events.py):
 *   - content: streaming text token (data is a string)
 *   - tool_start: tool invocation started (data is structured JSON)
 *   - tool_end: tool invocation completed (data is structured JSON)
 *   - todo_update: task list update (data is structured JSON)
 *   - subagent_start: subagent delegation started (data is structured JSON)
 *   - subagent_end: subagent completed (data is structured JSON)
 *   - warning: non-fatal issue (data is structured JSON, rendered inline)
 *   - error: error message (data is JSON with error field, rendered inline)
 *   - done: stream complete (data is empty JSON)
 */

import {
  type SSEAgentEvent,
  createSSEAgentEvent,
} from "@/components/dynamic-agents/sse-types";

export interface DynamicAgentClientConfig {
  /** Proxy route URL base (e.g. /api/dynamic-agents/chat) */
  proxyUrl: string;
  /** JWT access token for Bearer authentication */
  accessToken?: string;
}

/** Callback for when agent requests user input via form */
export type InputRequiredCallback = (data: {
  interruptId: string;
  prompt: string;
  fields: Array<{
    field_name: string;
    field_label?: string;
    field_description?: string;
    field_type: string;
    field_values?: string[];
    required?: boolean;
    default_value?: string;
    placeholder?: string;
  }>;
  agent: string;
}) => void;

interface RawSSEEvent {
  event: string;
  data: string;
}

/**
 * Dynamic Agent Client — streams responses from the Dynamic Agents backend
 * via a UI proxy route, yielding SSEAgentEvent objects directly.
 */
export class DynamicAgentClient {
  private proxyUrl: string;
  private accessToken?: string;
  private abortController: AbortController | null = null;

  /**
   * Callback for when agent requests user input via form.
   * Set this to handle HITL form rendering.
   */
  public onInputRequired: InputRequiredCallback | null = null;

  constructor(config: DynamicAgentClientConfig) {
    this.proxyUrl = config.proxyUrl;
    this.accessToken = config.accessToken;
  }

  /**
   * Abort the current stream.
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Send a message and stream the response as SSEAgentEvent objects.
   *
   * @param message User message text
   * @param conversationId Conversation/session ID
   * @param agentId Dynamic agent config ID
   */
  async *sendMessageStream(
    message: string,
    conversationId: string,
    agentId: string,
  ): AsyncGenerator<SSEAgentEvent, void, undefined> {
    // Abort any previous request
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const body = JSON.stringify({
      message,
      conversation_id: conversationId,
      agent_id: agentId,
    });

    let eventCount = 0;
    const streamUrl = `${this.proxyUrl}/start-stream`;

    try {
      console.log(`[DynamicAgent] Sending to ${streamUrl}`);

      const response = await fetch(streamUrl, {
        method: "POST",
        headers,
        body,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Session expired: Your authentication token has expired. " +
              "Please save your work and log in again.",
          );
        }
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `HTTP error: ${response.status} ${response.statusText}. ${errorBody || "(empty)"}`,
        );
      }

      // Parse SSE stream using getReader (Safari-compatible)
      for await (const rawEvent of this.parseSSEStream(response)) {
        eventCount++;

        // Debug: log warning events
        if (rawEvent.event === "warning") {
          console.log(`[DynamicAgent] ⚠️ Received warning event:`, rawEvent.data);
        }

        // Handle input_required event (HITL form request)
        if (rawEvent.event === "input_required") {
          console.log(`[DynamicAgent] 📝 Input required:`, rawEvent.data);
          // Continue to yield the event so UI can render form
        }

        const agentEvent = this.mapToAgentEvent(rawEvent);
        if (!agentEvent) continue;

        yield agentEvent;

        // Check for terminal events
        // input_required is also terminal - stream pauses for user input
        if (
          rawEvent.event === "done" ||
          rawEvent.event === "error" ||
          rawEvent.event === "input_required"
        ) {
          break;
        }
      }

      console.log(`[DynamicAgent] Stream ended after ${eventCount} events`);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log(`[DynamicAgent] Stream aborted after ${eventCount} events`);
      } else {
        console.error("[DynamicAgent] Stream error:", error);
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Resume a paused stream after user provides form input.
   * Call this after receiving an input_required event and user submits the form.
   *
   * @param conversationId Conversation/session ID
   * @param agentId Dynamic agent config ID
   * @param formData JSON string of form values, or rejection message
   */
  async *resumeStream(
    conversationId: string,
    agentId: string,
    formData: string,
  ): AsyncGenerator<SSEAgentEvent, void, undefined> {
    // Abort any previous request
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const body = JSON.stringify({
      conversation_id: conversationId,
      agent_id: agentId,
      form_data: formData,
    });

    let eventCount = 0;
    const resumeUrl = `${this.proxyUrl}/resume-stream`;

    try {
      console.log(`[DynamicAgent] Resuming stream at ${resumeUrl}`);

      const response = await fetch(resumeUrl, {
        method: "POST",
        headers,
        body,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Session expired: Your authentication token has expired. " +
              "Please save your work and log in again.",
          );
        }
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `HTTP error: ${response.status} ${response.statusText}. ${errorBody || "(empty)"}`,
        );
      }

      // Parse SSE stream using getReader (Safari-compatible)
      for await (const rawEvent of this.parseSSEStream(response)) {
        eventCount++;

        // Handle input_required event (agent may request more input)
        if (rawEvent.event === "input_required") {
          console.log(`[DynamicAgent] 📝 Additional input required:`, rawEvent.data);
        }

        const agentEvent = this.mapToAgentEvent(rawEvent);
        if (!agentEvent) continue;

        yield agentEvent;

        // Check for terminal events
        if (
          rawEvent.event === "done" ||
          rawEvent.event === "error" ||
          rawEvent.event === "input_required"
        ) {
          break;
        }
      }

      console.log(`[DynamicAgent] Resume stream ended after ${eventCount} events`);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log(`[DynamicAgent] Resume stream aborted after ${eventCount} events`);
      } else {
        console.error("[DynamicAgent] Resume stream error:", error);
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Parse SSE stream from a fetch Response using getReader (Safari-compatible).
   */
  private async *parseSSEStream(
    response: Response,
  ): AsyncGenerator<RawSSEEvent, void, undefined> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on double newlines (SSE event separator)
        const events = buffer.split("\n\n");
        // Keep the last incomplete chunk in the buffer
        buffer = events.pop() || "";

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;

          let eventType = "message";
          let eventData = "";

          for (const line of eventStr.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              eventData = line.slice(6);
            } else if (line.startsWith("data:")) {
              // Handle "data:" without space
              eventData = line.slice(5);
            }
          }

          yield { event: eventType, data: eventData };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Map a backend SSE event into an SSEAgentEvent.
   * Uses the new structured event format from stream_events.py.
   */
  private mapToAgentEvent(raw: RawSSEEvent): SSEAgentEvent | null {
    const { event, data } = raw;

    // ─── Structured events: content, tool_*, todo_update, subagent_*, input_required, warning ───
    if (
      event === "content" ||
      event === "tool_start" ||
      event === "tool_end" ||
      event === "todo_update" ||
      event === "subagent_start" ||
      event === "subagent_end" ||
      event === "input_required" ||
      event === "warning"
    ) {
      try {
        // content events have data as plain string, others are JSON
        let parsedData: unknown;
        if (event === "content") {
          parsedData = data;
        } else {
          parsedData = JSON.parse(data);
        }

        const agentEvent = createSSEAgentEvent(
          { type: event, data: parsedData },
          undefined, // taskId could be added later for crash recovery
        );

        return agentEvent;
      } catch (e) {
        console.error(`[DynamicAgent] Failed to parse ${event} data:`, e, data);
        return null;
      }
    }

    // ─── done: stream complete ───────────────────────────────────────
    // The done event signals that the stream is complete.
    // The chat panel marks isFinal=true when the loop exits after receiving done.
    if (event === "done") {
      console.log(`[DynamicAgent] Stream done event received`);
      return null;
    }

    // ─── error: agent error ──────────────────────────────────────────
    if (event === "error") {
      console.log(`[DynamicAgent] ❌ Received error event:`, data);
      try {
        const parsed = JSON.parse(data);
        const errorMsg = parsed.error || "Unknown error";
        console.log(`[DynamicAgent] ❌ Parsed error message:`, errorMsg);
        return {
          id: `sse-error-${Date.now()}`,
          timestamp: new Date(),
          type: "error",
          raw: { event, data: parsed },
          displayContent: `Error: ${errorMsg}`,
          content: `Error: ${errorMsg}`,
          isFinal: true,
        };
      } catch {
        console.log(`[DynamicAgent] ❌ Failed to parse error, using raw data`);
        return {
          id: `sse-error-${Date.now()}`,
          timestamp: new Date(),
          type: "error",
          raw: { event, data },
          displayContent: `Error: ${data}`,
          content: `Error: ${data}`,
          isFinal: true,
        };
      }
    }

    // Unknown event type — skip
    console.log(`[DynamicAgent] Skipping unknown event: ${event}`);
    return null;
  }
}
