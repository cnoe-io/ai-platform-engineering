/**
 * POST /api/tickets/service-desk
 *
 * Creates a GitHub issue for approved service-desk requests
 * on a repository separate from product feedback. Requires SERVICE_DESK_GITHUB_ENABLED=true,
 * SERVICE_DESK_GITHUB_REPO, and a server token (REPORT_PROBLEM_GITHUB_TOKEN /
 * GITHUB_TICKET_TOKEN / GITHUB_TOKEN with issues:write on the target repo).
 * SERVICE_DESK_GITHUB_TOKEN takes precedence when a dedicated token is configured.
 *
 * The issue is labelled with SERVICE_DESK_GITHUB_LABEL (default "service-desk")
 * so a native GitHub Project auto-add workflow can place it on the board, and
 * assigned to SERVICE_DESK_DEFAULT_ASSIGNEE when configured.
 */

import { NextRequest, NextResponse } from "next/server";

import { withAuth, withErrorHandler, ApiError } from "@/lib/api-middleware";
import { getServerConfig } from "@/lib/config";
import {
  createGitHubTicket,
  uploadScreenshotToGitHub,
  type GitHubTicketInput,
  type TicketReportSource,
} from "@/lib/github-ticket";
import { recordProblemReportFeedback } from "@/lib/feedback-report-store";
import { submitServiceDeskOnce } from "@/lib/service-desk-submissions";
import type { FeedbackContext } from "@/lib/ticket-client";

interface ReportBody {
  title?: string;
  conversationId?: string;
  requestId?: string;
  description?: string;
  contextUrl?: string;
  source?: TicketReportSource;
  feedbackContext?: FeedbackContext;
  area?: string;
  issueType?: "Bug" | "Enhancement";
  screenshotDataUrl?: string;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, user) => {
    const cfg = getServerConfig();
    if (!cfg.serviceDeskGithubEnabled || !cfg.serviceDeskGithubRepo) {
      throw new ApiError(
        "Service-desk GitHub routing is not configured",
        503,
        "service_desk_not_configured",
      );
    }

    const token =
      process.env.SERVICE_DESK_GITHUB_TOKEN || process.env.REPORT_PROBLEM_GITHUB_TOKEN ||
      process.env.GITHUB_TICKET_TOKEN || process.env.GITHUB_TOKEN;
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError("Expected a JSON object", 400, "invalid_body");
    }
    if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.length > 256)) {
      throw new ApiError("title must contain 1–256 characters", 400, "invalid_title");
    }
    if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[a-f0-9]{64}$/.test(body.requestId))) {
      throw new ApiError("Invalid submission identifier", 400, "invalid_request_id");
    }
    if (body.conversationId !== undefined && (typeof body.conversationId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.conversationId) || !body.requestId)) {
      throw new ApiError("Invalid chat submission", 400, "invalid_conversation");
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const contextUrl = body.conversationId
      ? new URL(`/chat/${body.conversationId}`, process.env.NEXTAUTH_URL || request.nextUrl.origin).toString()
      : typeof body.contextUrl === "string" ? body.contextUrl.trim() : "";
    const source: TicketReportSource = body.source ?? "header";

    if (!description && !body.feedbackContext) {
      throw new ApiError("description is required", 400, "missing_description");
    }
    if (!contextUrl) {
      throw new ApiError("contextUrl is required", 400, "missing_context_url");
    }

    const feedbackContext = body.feedbackContext;
    const effectiveDescription =
      description ||
      (feedbackContext
        ? `${feedbackContext.reason}${feedbackContext.additionalFeedback ? `: ${feedbackContext.additionalFeedback}` : ""}`
        : "");

    const screenshotDataUrl =
      typeof body.screenshotDataUrl === "string" && body.screenshotDataUrl
        ? body.screenshotDataUrl
        : undefined;

    let screenshotUrl: string | undefined;
    if (screenshotDataUrl && cfg.githubScreenshotsRepo) {
      try {
        screenshotUrl = await uploadScreenshotToGitHub(
          cfg.githubScreenshotsRepo,
          token,
          screenshotDataUrl,
        );
      } catch (err) {
        console.warn("[api/tickets/service-desk] Failed to upload screenshot:", err);
      }
    }

    const assignees = cfg.serviceDeskDefaultAssignee ? [cfg.serviceDeskDefaultAssignee] : undefined;

    const input: GitHubTicketInput = {
      title: body.title,
      description: effectiveDescription,
      userEmail: user.email,
      contextUrl,
      source,
      label: cfg.serviceDeskGithubLabel,
      assignees,
      feedbackContext,
      area: body.area,
      issueType: body.issueType,
      screenshotDataUrl,
      screenshotUrl,
    };

    const createTicket = () => createGitHubTicket(cfg.serviceDeskGithubRepo!, token, input);
    const result = body.requestId
      ? await submitServiceDeskOnce(user.email, body.requestId, createTicket)
      : await createTicket();

    await recordProblemReportFeedback({
      description: effectiveDescription,
      userEmail: user.email,
      contextUrl,
      source,
      area: body.area,
      issueType: body.issueType,
      feedbackContext,
      ticket: result,
    });

    return NextResponse.json({ success: true, data: result });
  });
});
