/** Canonical GitHub ingress for the provider-neutral CAIPE event bus. */

import { NextResponse } from "next/server";

import { publishCaipeEvent } from "@/lib/events/bus";
import {
  linkedDiscussionFromWebhook,
  type GitHubDiscussionWebhookShape,
} from "@/lib/github-discussion-snapshot";
import {
  linkedIssueFromGitHub,
  type GitHubIssueShape,
} from "@/lib/github-issue-snapshot";
import { ACCEPTED_GITHUB_WEBHOOK_EVENTS } from "@/lib/github-webhooks/events";
import { isRepositoryAttachedToTome } from "@/lib/github-webhooks/tome-issue-cache";
import { verifyGitHubWebhook } from "@/lib/github-webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GitHubRepositoryPayload {
  id?: number;
  full_name?: string;
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.TOME_GITHUB_WEBHOOK_ENABLED !== "true") {
    return new Response(null, { status: 404 });
  }

  const eventType = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256");
  const deliveryId = request.headers.get("x-github-delivery");
  if (!eventType) {
    return NextResponse.json({ error: "missing X-GitHub-Event" }, { status: 400 });
  }
  if (!ACCEPTED_GITHUB_WEBHOOK_EVENTS.has(eventType)) {
    return new Response(null, { status: 204 });
  }

  // GitHub signs the exact bytes. Never verify a parsed/re-serialized body.
  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body not valid JSON" }, { status: 400 });
  }

  const repository = payload.repository as GitHubRepositoryPayload | undefined;
  if (!repository?.id || !repository.full_name) {
    return NextResponse.json(
      { error: "missing repository identity" },
      { status: 400 },
    );
  }
  if (!(await isRepositoryAttachedToTome(repository.id, repository.full_name))) {
    return new Response(null, { status: 404 });
  }

  const verification = verifyGitHubWebhook(
    rawBody,
    signature,
    deliveryId,
    process.env.GITHUB_WEBHOOK_SECRET,
  );
  if (!verification.valid) {
    return new Response(null, { status: 401 });
  }

  if (eventType === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }

  const action = typeof payload.action === "string" ? payload.action : "received";
  const issue = payload.issue as
    | (GitHubIssueShape & { pull_request?: unknown })
    | undefined;
  const issueSnapshot =
    issue?.number &&
    issue.title &&
    issue.html_url &&
    !("pull_request" in issue)
      ? linkedIssueFromGitHub(repository.full_name, issue)
      : null;
  const discussion = payload.discussion as
    | GitHubDiscussionWebhookShape
    | undefined;
  const discussionSnapshot =
    discussion?.number && discussion.title && discussion.html_url
      ? linkedDiscussionFromWebhook(repository.full_name, discussion)
      : null;
  const receivedAt = new Date();
  const result = await publishCaipeEvent({
    _id: `github:${deliveryId}`,
    specversion: "1.0",
    source: "github",
    type: `github.${eventType}.${action}`,
    subject: issue?.number
      ? `${repository.full_name}#${issue.number}`
      : discussion?.number
        ? `${repository.full_name}:discussion#${discussion.number}`
        : repository.full_name,
    time: githubEventTime(payload) ?? receivedAt,
    received_at: receivedAt,
    data: {
      github_event: eventType,
      action,
      delivery_id: deliveryId,
      repository_id: repository.id,
      repository_full_name: repository.full_name,
      issue_number: issue?.number ?? null,
      issue: issueSnapshot,
      discussion_number: discussion?.number ?? null,
      discussion: discussionSnapshot,
      sender_login: githubSender(payload),
    },
  });
  return NextResponse.json(
    {
      accepted: true,
      duplicate: result.duplicate,
      subscribers: result.subscribers,
    },
    { status: 202 },
  );
}

function githubSender(payload: Record<string, unknown>): string | null {
  const sender = payload.sender as { login?: unknown } | undefined;
  return typeof sender?.login === "string" ? sender.login : null;
}

function githubEventTime(payload: Record<string, unknown>): Date | null {
  const candidates = [
    (payload.issue as { updated_at?: unknown } | undefined)?.updated_at,
    (payload.discussion as { updated_at?: unknown } | undefined)?.updated_at,
    (payload.comment as { updated_at?: unknown } | undefined)?.updated_at,
    (payload.milestone as { updated_at?: unknown } | undefined)?.updated_at,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}
