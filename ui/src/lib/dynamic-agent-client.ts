/**
 * Dynamic Agent Client
 *
 * Lightweight SSE streaming client for Dynamic Agents.
 * POSTs to the UI proxy route and parses SSE events, yielding
 * ParsedA2AEvent-compatible objects so ChatPanel can use the same
 * accumulation/update logic as A2ASDKClient.
 *
 * Unlike A2ASDKClient which uses the @a2a-js/sdk and JSON-RPC transport,
 * this client speaks plain SSE with a simple REST POST.
 *
 * SSE event types from the backend:
 *   - content: streaming text token (data is a string)
 *   - tool_notification_start: tool started (data is JSON with artifact shape)
 *   - tool_notification_end: tool ended (data is JSON with artifact shape)
 *   - execution_plan_update: task list update (data is JSON with artifact shape)
 *   - final_result: completion with final content (data is JSON with artifact shape)
 *   - error: error message (data is JSON with error field)
 *   - done: stream complete (data is empty JSON)
 */

import type { ParsedA2AEvent } from "@/lib/a2a-sdk-client";

export interface DynamicAgentClientConfig {
  /** Proxy route URL (e.g. /api/dynamic-agents/chat/stream) */
  proxyUrl: string;
  /** JWT access token for Bearer authentication */
  accessToken?: string;
}

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Dynamic Agent Client — streams responses from the Dynamic Agents backend
 * via a UI proxy route, yielding ParsedA2AEvent objects.
 */
export class DynamicAgentClient {
  private proxyUrl: string;
  private accessToken?: string;
  private abortController: AbortController | null = null;

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
   * Send a message and stream the response as ParsedA2AEvent objects.
   *
   * @param message User message text
   * @param conversationId Conversation/session ID
   * @param agentId Dynamic agent config ID
   */
  async *sendMessageStream(
    message: string,
    conversationId: string,
    agentId: string,
  ): AsyncGenerator<ParsedA2AEvent, void, undefined> {
    // Abort any previous request
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
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

    try {
      console.log(`[DynamicAgent] Sending to ${this.proxyUrl}`);

      const response = await fetch(this.proxyUrl, {
        method: "POST",
        headers,
        body,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Session expired: Your authentication token has expired. " +
            "Please save your work and log in again."
          );
        }
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `HTTP error: ${response.status} ${response.statusText}. ${errorBody || "(empty)"}`
        );
      }

      // Parse SSE stream using getReader (Safari-compatible)
      for await (const sseEvent of this.parseSSEStream(response)) {
        eventCount++;

        const parsed = this.mapToA2AEvent(sseEvent, eventCount);
        if (!parsed) continue;

        yield parsed;

        // Check for terminal events
        if (sseEvent.event === "done" || sseEvent.event === "error") {
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
   * Parse SSE stream from a fetch Response using getReader (Safari-compatible).
   */
  private async *parseSSEStream(response: Response): AsyncGenerator<SSEEvent, void, undefined> {
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
   * Map a backend SSE event into a ParsedA2AEvent for ChatPanel consumption.
   *
   * The goal is to produce the same shape that A2ASDKClient.parseEvent() returns,
   * so ChatPanel's submitMessage() can use identical accumulation logic.
   */
  private mapToA2AEvent(sse: SSEEvent, eventNum: number): ParsedA2AEvent | null {
    const { event, data } = sse;

    // ─── content: streaming text token ───────────────────────────────
    if (event === "content") {
      return {
        raw: { kind: "message" } as never,
        type: "message",
        displayContent: data,
        isFinal: false,
        shouldAppend: true,
      };
    }

    // ─── Artifact-shaped events (tool_notification_*, execution_plan_*, final_result) ───
    if (
      event === "tool_notification_start" ||
      event === "tool_notification_end" ||
      event === "execution_plan_update" ||
      event === "execution_plan_status_update" ||
      event === "final_result"
    ) {
      try {
        const parsed = JSON.parse(data);
        const artifact = parsed.artifact;

        if (!artifact) {
          console.warn(`[DynamicAgent] ${event} event missing artifact`, data);
          return null;
        }

        // Extract text content from artifact parts
        const textContent =
          artifact.parts
            ?.filter((p: { kind: string }) => p.kind === "text")
            .map((p: { text: string }) => p.text || "")
            .join("") || "";

        // Map SSE event type to A2AEvent type
        let a2aType: ParsedA2AEvent["type"] = "artifact";
        if (event === "tool_notification_start") a2aType = "artifact";
        if (event === "tool_notification_end") a2aType = "artifact";

        const isFinal = event === "final_result";

        // Build raw object that toStoreEvent() can extract artifact from
        const rawEvent = {
          kind: "artifact-update" as const,
          artifact,
          append: true,
        };

        return {
          raw: rawEvent as never,
          type: a2aType,
          artifactName: artifact.name,
          displayContent: textContent,
          isFinal,
          shouldAppend: true,
          sourceAgent: artifact.metadata?.sourceAgent,
        };
      } catch (e) {
        console.error(`[DynamicAgent] Failed to parse ${event} data:`, e, data);
        return null;
      }
    }

    // ─── done: stream complete ───────────────────────────────────────
    if (event === "done") {
      return {
        raw: { kind: "status-update", status: { state: "completed" }, final: true } as never,
        type: "status",
        displayContent: "Stream complete",
        isFinal: true,
        shouldAppend: false,
      };
    }

    // ─── error: agent error ──────────────────────────────────────────
    if (event === "error") {
      try {
        const parsed = JSON.parse(data);
        const errorMsg = parsed.error || "Unknown error";
        return {
          raw: { kind: "status-update", status: { state: "failed" }, final: true } as never,
          type: "status",
          displayContent: `Error: ${errorMsg}`,
          isFinal: true,
          shouldAppend: false,
        };
      } catch {
        return {
          raw: { kind: "status-update", status: { state: "failed" }, final: true } as never,
          type: "status",
          displayContent: `Error: ${data}`,
          isFinal: true,
          shouldAppend: false,
        };
      }
    }

    // Unknown event type — skip
    console.log(`[DynamicAgent] Skipping unknown event: ${event}`);
    return null;
  }
}
