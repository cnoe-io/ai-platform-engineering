/**
 * Server-only GitHub issue creation for Report-a-Problem / TOME product feedback.
 * Uses a service token (GITHUB_TICKET_TOKEN or GITHUB_TOKEN) — never the user's OAuth token.
 */

import { Octokit } from "@octokit/rest";

import type { FeedbackContext } from "@/lib/ticket-client";

export type TicketReportSource =
  | "header"
  | "chat-feedback"
  | "tome-product";

export type TomeFeedbackCategory =
  | "Bug"
  | "Confusing UX"
  | "Missing feature"
  | "Other";

export interface GitHubTicketInput {
  description: string;
  userEmail: string;
  contextUrl: string;
  source: TicketReportSource;
  label: string;
  feedbackContext?: FeedbackContext;
  category?: TomeFeedbackCategory | string;
  tomeContext?: {
    projectSlug?: string;
    pagePath?: string;
  };
}

export interface GitHubTicketResult {
  id: string;
  url: string;
  number: number;
  provider: "github";
}

export function parseGitHubRepo(repo: string): { owner: string; repo: string } {
  const trimmed = repo.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`Invalid GITHUB_TICKET_REPO: "${repo}" (expected owner/repo)`);
  }
  return { owner: trimmed.slice(0, slash), repo: trimmed.slice(slash + 1) };
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function titleFor(input: GitHubTicketInput): string {
  const prefix =
    input.source === "tome-product" ? "[TOME Feedback]" : "[CAIPE Report]";
  const category = input.category ?? input.feedbackContext?.reason;
  const summary = truncate(
    input.description.replace(/\s+/g, " "),
    72,
  );
  if (category) {
    return truncate(`${prefix} ${category}: ${summary}`, 240);
  }
  return truncate(`${prefix} ${summary}`, 240);
}

export function buildGitHubIssueBody(input: GitHubTicketInput): string {
  const lines: string[] = [];

  if (input.source === "tome-product") {
    lines.push(
      "> **TOME product feedback** — bugs, confusing UX, or missing product capabilities.",
      "> This is **not** for wiki page content accuracy (use the activity feed for that).",
      "",
    );
  }

  lines.push("## Summary", "", input.description.trim(), "");

  if (input.category) {
    lines.push("## Category", "", String(input.category), "");
  }

  if (input.feedbackContext) {
    lines.push(
      "## Chat feedback",
      "",
      `- Type: ${input.feedbackContext.feedbackType}`,
      `- Reason: ${input.feedbackContext.reason}`,
    );
    if (input.feedbackContext.additionalFeedback) {
      lines.push(`- Details: ${input.feedbackContext.additionalFeedback}`);
    }
    lines.push("");
  }

  lines.push(
    "## Reporter",
    "",
    `- Email: ${input.userEmail}`,
    `- Context URL: ${input.contextUrl}`,
  );

  if (input.tomeContext?.projectSlug) {
    lines.push(`- TOME project: \`${input.tomeContext.projectSlug}\``);
  }
  if (input.tomeContext?.pagePath) {
    lines.push(`- Wiki page: \`${input.tomeContext.pagePath}\``);
  }

  lines.push(
    "",
    "---",
    "_Submitted via CAIPE Report a Problem_",
  );

  return lines.join("\n");
}

export async function createGitHubTicket(
  repoFullName: string,
  token: string,
  input: GitHubTicketInput,
): Promise<GitHubTicketResult> {
  if (!token.trim()) {
    throw new Error("GitHub ticket token is not configured");
  }

  const { owner, repo } = parseGitHubRepo(repoFullName);
  const octokit = new Octokit({ auth: token });

  const labels = [input.label];
  if (input.source === "tome-product") {
    labels.push("tome-feedback");
  }
  if (input.category && input.category !== "Other") {
    labels.push(
      input.category
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, ""),
    );
  }

  const res = await octokit.issues.create({
    owner,
    repo,
    title: titleFor(input),
    body: buildGitHubIssueBody(input),
    labels: [...new Set(labels.filter(Boolean))],
  });

  const number = res.data.number;
  return {
    id: `#${number}`,
    number,
    url: res.data.html_url,
    provider: "github",
  };
}
