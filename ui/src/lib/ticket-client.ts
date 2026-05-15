"use client";

import { SSEClient, type SSEEvent } from "@/lib/sse-streaming-client";
import { getConfig } from "@/lib/config";

export interface FeedbackContext {
  reason: string;
  additionalFeedback?: string;
  feedbackType: "like" | "dislike";
}

export interface TicketRequest {
  description: string;
  userEmail: string;
  contextUrl: string;
  feedbackContext?: FeedbackContext;
}

export interface TicketResult {
  id: string;
  url: string;
  provider: "jira" | "github";
}

function buildPrompt(request: TicketRequest): string {
  const provider = getConfig("ticketProvider");
  const project =
    provider === "jira"
      ? getConfig("jiraTicketProject")
      : getConfig("githubTicketRepo");

  if (!provider || !project) {
    throw new Error("Ticket provider is not configured");
  }

  const target =
    provider === "jira"
      ? `a Jira issue in project ${project}`
      : `a GitHub issue in repository ${project}`;

  const descriptionLines = [
    `Summary: ${request.description}`,
    `Reporter: ${request.userEmail}`,
    `Context URL: ${request.contextUrl}`,
  ];

  if (request.feedbackContext) {
    descriptionLines.push(
      `Feedback Type: ${request.feedbackContext.feedbackType}`,
      `Feedback Reason: ${request.feedbackContext.reason}`
    );
    if (request.feedbackContext.additionalFeedback) {
      descriptionLines.push(
        `Additional Feedback: ${request.feedbackContext.additionalFeedback}`
      );
    }
  }

  const label =
    provider === "jira"
      ? getConfig("jiraTicketLabel")
      : getConfig("githubTicketLabel");

  return `Create ${target} with the following details:\n${descriptionLines.join("\n")}\n\nSet the issue type to Bug. Add the label "${label}" to the ticket. Include the Context URL in the description so the team can navigate directly to the conversation.`;
}

/**
 * Extracts a ticket ID and URL from the final result text using common patterns.
 * Falls back to the raw text if no structured data is found.
 */
function extractTicketResult(text: string): TicketResult | null {
  const provider = getConfig("ticketProvider");
  if (!provider) return null;

  if (provider === "jira") {
    const keyMatch = text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
    const urlMatch = text.match(/(https?:\/\/[^\s)]+\/browse\/[A-Z][A-Z0-9]+-\d+)/);
    if (keyMatch) {
      return {
        id: keyMatch[1],
        url: urlMatch ? urlMatch[1] : "",
        provider: "jira",
      };
    }
  } else {
    const numMatch = text.match(/#(\d+)/);
    const urlMatch = text.match(/(https?:\/\/github\.com\/[^\s)]+\/issues\/\d+)/);
    if (numMatch) {
      return {
        id: `#${numMatch[1]}`,
        url: urlMatch ? urlMatch[1] : "",
        provider: "github",
      };
    }
  }

  return null;
}

export interface CreateTicketOptions {
  request: TicketRequest;
  accessToken?: string;
  onEvent?: (event: SSEEvent, logLine: string) => void;
  onResult?: (result: TicketResult) => void;
  signal?: AbortSignal;
}

/**
 * Create a ticket via the SSE supervisor agent (Jira or GitHub).
 * Streams events back to the caller for progress display.
 */
export async function createTicketViaAgent(
  options: CreateTicketOptions
): Promise<TicketResult | null> {
  const { request, accessToken, onEvent, onResult, signal } = options;
  const endpoint = "/api/chat/stream";

  const prompt = buildPrompt(request);

  let finalContent = "";

  const client = new SSEClient({
    endpoint,
    accessToken,
    onEvent: (event: SSEEvent) => {
      if (signal?.aborted) {
        client.abort();
        return;
      }

      const label = event.type || "event";
      const preview = (event.text || event.message || "")
        .slice(0, 120)
        .replace(/\n/g, "\\n") || "(no content)";
      const logLine = `← ${label}: ${preview}`;

      onEvent?.(event, logLine);

      if (event.type === "done" && event.turn_id) {
        // Stream complete — finalContent already accumulated
      } else if (event.type === "content" && event.text) {
        finalContent += event.text;
      }
    },
  });

  if (signal) {
    signal.addEventListener("abort", () => client.abort());
  }

  await client.sendMessage({
    message: prompt,
    user_email: request.userEmail,
    source: "web",
  });

  if (!finalContent) return null;

  const result = extractTicketResult(finalContent);
  if (result) {
    onResult?.(result);
  }
  return result;
}
