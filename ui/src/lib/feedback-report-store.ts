/**
 * Persist Report-a-Problem / TOME product feedback into the unified
 * `feedback` MongoDB collection so Admin → Feedback tracks GitHub issues too.
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { FeedbackContext } from "@/lib/ticket-client";
import type { GitHubTicketResult, TicketReportSource } from "@/lib/github-ticket";

export interface RecordProblemReportInput {
  description: string;
  userEmail: string;
  contextUrl: string;
  source: TicketReportSource;
  category?: string;
  feedbackContext?: FeedbackContext;
  tomeContext?: { projectSlug?: string; pagePath?: string };
  ticket: GitHubTicketResult;
}

function valueForReport(input: RecordProblemReportInput): string {
  if (input.category) return input.category;
  if (input.feedbackContext?.reason) return input.feedbackContext.reason;
  return "problem_report";
}

/**
 * Dual-write problem reports to MongoDB. Failures are logged but do not block
 * the GitHub issue creation response.
 */
export async function recordProblemReportFeedback(
  input: RecordProblemReportInput,
): Promise<void> {
  if (!isMongoDBConfigured) return;

  try {
    const feedbackColl = await getCollection("feedback");
    const now = new Date();

    await feedbackColl.insertOne({
      source: "report",
      rating: "negative",
      value: valueForReport(input),
      comment: input.description.trim(),
      user_email: input.userEmail,
      context_url: input.contextUrl,
      report_kind: input.source,
      tome_project_slug: input.tomeContext?.projectSlug ?? null,
      tome_page_path: input.tomeContext?.pagePath ?? null,
      ticket_provider: input.ticket.provider,
      ticket_id: input.ticket.id,
      ticket_url: input.ticket.url,
      ticket_number: input.ticket.number,
      feedback_type: input.feedbackContext?.feedbackType ?? null,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    console.warn("[feedback-report-store] Failed to write problem report:", err);
  }
}
