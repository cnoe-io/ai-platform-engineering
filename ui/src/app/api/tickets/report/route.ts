/**
 * POST /api/tickets/report
 *
 * Creates a templated GitHub issue for Report-a-Problem and TOME product feedback.
 * Requires GITHUB_TICKET_ENABLED=true, GITHUB_TICKET_REPO, and a server token
 * (GITHUB_TICKET_TOKEN or GITHUB_TOKEN with issues:write on the target repo).
 */

import { NextRequest, NextResponse } from "next/server";

import { withAuth, withErrorHandler, ApiError } from "@/lib/api-middleware";
import { getServerConfig } from "@/lib/config";
import {
  createGitHubTicket,
  type GitHubTicketInput,
  type TicketReportSource,
  type TomeFeedbackCategory,
} from "@/lib/github-ticket";
import { recordProblemReportFeedback } from "@/lib/feedback-report-store";
import type { FeedbackContext } from "@/lib/ticket-client";

const TOME_CATEGORIES = new Set<TomeFeedbackCategory>([
  "Bug",
  "Confusing UX",
  "Missing feature",
  "Other",
]);

interface ReportBody {
  description?: string;
  contextUrl?: string;
  source?: TicketReportSource;
  category?: string;
  feedbackContext?: FeedbackContext;
  tomeContext?: {
    projectSlug?: string;
    pagePath?: string;
  };
}

function env(name: string): string | undefined {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`];
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, user) => {
    const cfg = getServerConfig();
    if (!cfg.githubTicketEnabled || !cfg.githubTicketRepo) {
      throw new ApiError(
        "GitHub ticket creation is not configured",
        503,
        "ticket_not_configured",
      );
    }

    const token = env("REPORT_PROBLEM_GITHUB_TOKEN") || env("GITHUB_TICKET_TOKEN") || env("GITHUB_TOKEN");
    if (!token?.trim()) {
      throw new ApiError(
        "GitHub ticket token is not configured",
        503,
        "ticket_token_missing",
      );
    }

    let body: ReportBody;
    try {
      body = (await request.json()) as ReportBody;
    } catch {
      throw new ApiError("Invalid JSON body", 400, "invalid_body");
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const contextUrl = typeof body.contextUrl === "string" ? body.contextUrl.trim() : "";
    const source: TicketReportSource = body.source ?? "header";

    if (!description && !body.feedbackContext) {
      throw new ApiError("description is required", 400, "missing_description");
    }
    if (!contextUrl) {
      throw new ApiError("contextUrl is required", 400, "missing_context_url");
    }

    const category: TomeFeedbackCategory | string | undefined = body.category;
    if (source === "tome-product") {
      if (!category || !TOME_CATEGORIES.has(category as TomeFeedbackCategory)) {
        throw new ApiError("Valid category is required for TOME feedback", 400, "missing_category");
      }
      if (!description) {
        throw new ApiError("description is required for TOME feedback", 400, "missing_description");
      }
    }

    const feedbackContext = body.feedbackContext;
    const effectiveDescription =
      description ||
      (feedbackContext
        ? `${feedbackContext.reason}${feedbackContext.additionalFeedback ? `: ${feedbackContext.additionalFeedback}` : ""}`
        : "");

    const input: GitHubTicketInput = {
      description: effectiveDescription,
      userEmail: user.email,
      contextUrl,
      source,
      label: cfg.githubTicketLabel,
      feedbackContext,
      category,
      tomeContext: body.tomeContext,
    };

    const result = await createGitHubTicket(cfg.githubTicketRepo, token, input);

    await recordProblemReportFeedback({
      description: effectiveDescription,
      userEmail: user.email,
      contextUrl,
      source,
      category,
      feedbackContext,
      tomeContext: body.tomeContext,
      ticket: result,
    });

    return NextResponse.json({ success: true, data: result });
  });
});
