/**
 * GitHub webhook receiver for the Agentic SDLC.
 *
 * Synchronous part:
 *   1. Read the raw body (must use the bytes GitHub signed; do NOT
 *      JSON.parse → JSON.stringify).
 *   2. Verify HMAC (per FR-025) using the per-repo secret looked up by
 *      `repository.id`.
 *   3. Persist the event with `projection_status="deferred"`.
 *   4. Enqueue on the in-process async worker.
 *   5. Return 202.
 *
 * Per `contracts/github-webhook-events.md` we accept a fixed set of
 * event types; everything else is acknowledged with 204 (so GitHub's
 * delivery health stays green) but never persisted.
 *
 * Server-only.
 */

import { NextResponse } from "next/server";

import {
  enqueueAgenticSdlcEvent,
} from "@/lib/agentic-sdlc/async-worker";
import { extractEpicId } from "@/lib/agentic-sdlc/epic-linkage";
import { isAgenticSdlcServerEnabled } from "@/lib/agentic-sdlc/guard";
import {
  getAgenticSdlcEventsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import { recordWebhook } from "@/lib/agentic-sdlc/sli";
import {
  hashWebhookSecret,
  verifyGitHubWebhook,
} from "@/lib/agentic-sdlc/webhook-verify";
import type {
  ActorKind,
  ArtifactKind,
  AgenticSdlcEvent,
} from "@/types/agentic-sdlc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTED_EVENT_TYPES = new Set<string>([
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "check_run",
  "check_suite",
  "deployment",
  "deployment_status",
  "label",
  "ping",
  "sub_issues",
]);
const ROOT_EPIC_AGENT_LABELS = new Set([
  "agent:specify",
  "agent:architect",
  "agent:deep-think",
]);

export async function POST(req: Request): Promise<Response> {
  if (!isAgenticSdlcServerEnabled()) {
    return new Response(null, { status: 404 });
  }

  const eventType = req.headers.get("x-github-event");
  const signature = req.headers.get("x-hub-signature-256");
  const deliveryId = req.headers.get("x-github-delivery");

  if (!eventType) {
    recordWebhook("rejected_malformed");
    return NextResponse.json(
      { error: "missing X-GitHub-Event" },
      { status: 400 },
    );
  }
  if (!ACCEPTED_EVENT_TYPES.has(eventType)) {
    recordWebhook("accepted");
    return new Response(null, { status: 204 });
  }

  // Raw body — must verify against the exact bytes GitHub signed.
  const rawBody = await req.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    recordWebhook("rejected_malformed");
    return NextResponse.json(
      { error: "body not valid JSON" },
      { status: 400 },
    );
  }

  const repository = parsed.repository as
    | { id?: number; full_name?: string }
    | undefined;
  if (!repository?.id) {
    recordWebhook("rejected_malformed");
    return NextResponse.json(
      { error: "missing repository.id" },
      { status: 400 },
    );
  }

  // ping events from GitHub on hook creation: don't require persistence.
  if (eventType === "ping") {
    recordWebhook("accepted");
    return NextResponse.json({ ok: true, pong: true }, { status: 200 });
  }

  // Resolve repo by GitHub repository id.
  const reposCol = await getAgenticSdlcReposCollection();
  const repo = await reposCol.findOne({ repo_id: String(repository.id) });
  if (!repo || repo.offboarded_at) {
    recordWebhook("rejected_unknown_repo");
    // 404 to keep cross-account scanning quiet; GitHub treats this as a
    // dead delivery and surfaces it in the hook-deliveries page.
    return new Response(null, { status: 404 });
  }

  // Verify HMAC against the *per-repo* secret. We never store the raw
  // secret in the DB (only its fingerprint hash); receivers fetch the
  // live secret from `process.env.GITHUB_WEBHOOK_SECRET` for the MVP.
  // Multi-secret rotation lands as part of T020 enhancements (deferred).
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  // Fingerprint check: if the repo was onboarded under a different
  // secret rotation, reject early so the operator notices.
  if (
    secret.length > 0 &&
    repo.webhook_secret_hash &&
    repo.webhook_secret_hash !== hashWebhookSecret(secret)
  ) {
    recordWebhook("rejected_signature");
    return new Response(null, { status: 401 });
  }

  const verifyResult = verifyGitHubWebhook(rawBody, signature, deliveryId, secret);
  if (!verifyResult.valid) {
    recordWebhook("rejected_signature");
    return new Response(null, { status: 401 });
  }

  // Persist the event in deferred state, enqueue, return 202.
  const action =
    typeof parsed.action === "string" ? (parsed.action as string) : null;

  const { artifactKind, artifactId, epicId, actorKind, actorLogin, occurredAt } =
    summariseEvent(eventType, parsed);

  const events = await getAgenticSdlcEventsCollection();
  const evDoc: AgenticSdlcEvent = {
    repo_id: repo.repo_id,
    source: "github",
    github_delivery_id: deliveryId,
    github_event_type: eventType,
    github_action: action,
    artifact_kind: artifactKind,
    artifact_id: artifactId,
    epic_id: epicId,
    actor_kind: actorKind,
    actor_login: actorLogin,
    payload: parsed,
    delivered_at: new Date(),
    occurred_at: occurredAt,
    projection_status: "deferred",
    projection_attempts: 0,
  };
  const insertResult = await events.insertOne(evDoc);

  enqueueAgenticSdlcEvent(insertResult.insertedId);
  recordWebhook("accepted");
  return NextResponse.json({ accepted: true }, { status: 202 });
}

interface EventSummary {
  artifactKind: ArtifactKind;
  artifactId: string;
  epicId: string | null;
  actorKind: ActorKind;
  actorLogin: string | null;
  occurredAt: Date;
}

function summariseEvent(
  eventType: string,
  payload: Record<string, unknown>,
): EventSummary {
  const sender = payload.sender as
    | { login?: string; type?: string }
    | undefined;
  const actorLogin = sender?.login ?? null;
  const isBot = sender?.type === "Bot";
  const agentBotLogins = new Set(
    (process.env.SHIP_LOOP_AGENT_BOT_LOGINS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const actorKind: ActorKind =
    actorLogin && isBot && agentBotLogins.has(actorLogin.toLowerCase())
      ? "agent"
      : actorLogin
        ? "human"
        : "system";

  let artifactKind: ArtifactKind = "unknown";
  let artifactId = "";
  let epicId: string | null = null;
  let occurredAt = new Date();

  if (eventType === "pull_request") {
    artifactKind = "pull_request";
    const pr = payload.pull_request as
      | {
          node_id?: string;
          updated_at?: string;
          labels?: { name?: string }[];
          body?: string;
        }
      | undefined;
    artifactId = pr?.node_id ?? "";
    occurredAt = pr?.updated_at ? new Date(pr.updated_at) : new Date();
    epicId = extractEpicId(
      pr?.labels?.map((l) => l.name ?? "").filter(Boolean) ?? [],
      pr?.body ?? null,
    );
  } else if (eventType === "issues") {
    const issue = payload.issue as
      | {
          node_id?: string;
          updated_at?: string;
          labels?: { name?: string }[];
          body?: string;
        }
      | undefined;
    const labels =
      issue?.labels?.map((l) => l.name ?? "").filter(Boolean) ?? [];
    const isRootAgentEpic =
      labels.some((label) => ROOT_EPIC_AGENT_LABELS.has(label)) &&
      !extractEpicId(labels, issue?.body ?? null);
    artifactKind =
      labels.includes("epic") || labels.includes("Epic") || isRootAgentEpic
        ? "epic"
        : "subtask";
    artifactId = issue?.node_id ?? "";
    occurredAt = issue?.updated_at ? new Date(issue.updated_at) : new Date();
    if (artifactKind === "epic") {
      epicId = artifactId || null;
    } else {
      epicId = extractEpicId(labels, issue?.body ?? null);
    }
  } else if (eventType === "deployment_status") {
    artifactKind = "deploy";
    const dep = payload.deployment as
      | {
          node_id?: string;
          updated_at?: string;
          payload?: { epic_id?: string };
        }
      | undefined;
    artifactId = dep?.node_id ?? "";
    occurredAt = dep?.updated_at ? new Date(dep.updated_at) : new Date();
    // Mock + real-world convention: agentic deploys carry the parent
    // Epic id either as a top-level deployment.payload.epic_id field
    // or as a leading "epic:<id>" element in the deployment description
    // / target_url query string. We support the structured form here;
    // the description fallback is best-effort only.
    epicId = dep?.payload?.epic_id ?? null;
  } else if (eventType === "pull_request_review") {
    artifactKind = "review";
    const pr = payload.pull_request as
      | { node_id?: string; labels?: { name?: string }[]; body?: string }
      | undefined;
    artifactId = pr?.node_id ?? "";
    epicId = extractEpicId(
      pr?.labels?.map((l) => l.name ?? "").filter(Boolean) ?? [],
      pr?.body ?? null,
    );
  } else if (eventType === "issue_comment" || eventType === "pull_request_review_comment") {
    artifactKind = "comment";
  } else if (eventType === "sub_issues") {
    artifactKind = "subtask";
    const child = readSubIssuePayload(payload);
    artifactId = child.subIssue?.node_id ?? "";
    occurredAt = child.subIssue?.updated_at ? new Date(child.subIssue.updated_at) : new Date();
    epicId = child.parentIssue?.node_id ?? null;
  } else if (eventType === "label") {
    artifactKind = "label";
  }

  return { artifactKind, artifactId, epicId, actorKind, actorLogin, occurredAt };
}

function readSubIssuePayload(payload: Record<string, unknown>): {
  parentIssue?: { node_id?: string; updated_at?: string };
  subIssue?: { node_id?: string; updated_at?: string };
} {
  const action = typeof payload.action === "string" ? payload.action : "";
  if (action === "parent_issue_added") {
    return {
      parentIssue: payload.parent_issue as { node_id?: string; updated_at?: string } | undefined,
      subIssue: payload.sub_issue as { node_id?: string; updated_at?: string } | undefined,
    };
  }

  return {
    parentIssue:
      (payload.parent_issue as { node_id?: string; updated_at?: string } | undefined) ??
      (payload.issue as { node_id?: string; updated_at?: string } | undefined),
    subIssue: payload.sub_issue as { node_id?: string; updated_at?: string } | undefined,
  };
}
