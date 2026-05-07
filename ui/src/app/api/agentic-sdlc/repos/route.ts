/**
 * GET /api/agentic-sdlc/repos
 *
 * Lists active onboarded repos with per-repo counts. Auth model:
 *   - Always 404 when SHIP_LOOP_ENABLED=false (server gate).
 *   - In production, requires a NextAuth session (401 otherwise).
 *   - In dev, SHIP_LOOP_ALLOW_NO_AUTH=true bypasses the session check
 *     so the mock-webhook flow can be driven without OAuth.
 *
 * Pilot scope: returns *every* active repo. The full spec restricts
 * the list by GitHub repo visibility for the calling user; that
 * filter is intentionally deferred (see tasks T031-T033 / FR-029)
 * because (a) the mock flow needs deterministic output and (b)
 * GitHub OAuth wiring is its own commit. When the visibility filter
 * lands, replace the `find({offboarded_at: null})` below with the
 * user-scoped query.
 */

import {
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import {
  GitHubClientError,
  createGitHubClient,
} from "@/lib/agentic-sdlc/github-client";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { getRepoCounts } from "@/lib/agentic-sdlc/repo-stats";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { hashWebhookSecret } from "@/lib/agentic-sdlc/webhook-verify";
import type { OnboardedRepo } from "@/types/agentic-sdlc";

interface RepoListItem {
  repo_id: string;
  owner: string;
  name: string;
  full_name: string;
  sandbox_environment: string;
  webhook_status: OnboardedRepo["webhook_status"];
  last_activity_at: string | null;
  counts: {
    open_epics: number;
    in_flight_subtasks: number;
    prs_awaiting_review: number;
    deploys_24h: number;
  };
}

const GITHUB_SHIP_LOOP_EVENTS = [
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
];

async function handle(req: Request): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const repos = await getAgenticSdlcReposCollection();
  const cursor = repos
    .find(
      { offboarded_at: null },
      {
        projection: {
          _id: 0,
          repo_id: 1,
          owner: 1,
          name: 1,
          full_name: 1,
          sandbox_environment: 1,
          webhook_status: 1,
          webhook_last_event_at: 1,
          updated_at: 1,
        },
        sort: { onboarded_at: -1 },
        limit: 100,
      },
    );

  const docs = await cursor.toArray();

  const items: RepoListItem[] = (
    await Promise.all(
      docs.map(async (doc) => ({
        repo_id: doc.repo_id,
        owner: doc.owner,
        name: doc.name,
        full_name: doc.full_name,
        sandbox_environment: doc.sandbox_environment,
        webhook_status: doc.webhook_status,
        last_activity_at: lastActivityAt(doc),
        counts: await getRepoCounts(doc.repo_id),
      })),
    )
  ).sort(
    (a, b) =>
      Date.parse(b.last_activity_at ?? "") - Date.parse(a.last_activity_at ?? ""),
  );

  return Response.json({ items });
}

export const GET = withAgenticSdlcGate(handle);

function lastActivityAt(doc: {
  webhook_last_event_at?: Date | null;
  updated_at?: Date | null;
}): string | null {
  const dates = [doc.webhook_last_event_at, doc.updated_at].filter(
    (date): date is Date => date instanceof Date,
  );
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

interface OnboardRepoRequest {
  owner?: unknown;
  repo?: unknown;
  callback_url?: unknown;
  webhook_secret?: unknown;
  sandbox_environment?: unknown;
}

async function handlePost(req: Request): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  let body: OnboardRepoRequest;
  try {
    body = (await req.json()) as OnboardRepoRequest;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const owner = stringField(body.owner).trim();
  const repo = stringField(body.repo).trim();
  const callbackUrl = stringField(body.callback_url).trim();
  const webhookSecret = stringField(body.webhook_secret);
  const sandboxEnvironment =
    stringField(body.sandbox_environment).trim() || "sandbox";

  if (!owner || !repo) {
    return Response.json({ error: "bad_repo" }, { status: 400 });
  }
  if (!webhookSecret || webhookSecret.length < 8) {
    return Response.json({ error: "bad_webhook_secret" }, { status: 400 });
  }
  const parsedCallbackUrl = parseWebhookCallbackUrl(callbackUrl);
  if (!parsedCallbackUrl) {
    return Response.json({ error: "bad_callback_url" }, { status: 400 });
  }

  const authToken = process.env.GITHUB_TOKEN;
  if (!authToken) {
    return Response.json(
      {
        error: "missing_github_token",
        message:
          "Set GITHUB_TOKEN on the UI server to create the webhook automatically.",
      },
      { status: 503 },
    );
  }

  try {
    const client = createGitHubClient({ authToken });
    const meta = await client.getRepoMetadata(owner, repo);
    if (!meta.permissions?.admin) {
      return Response.json(
        {
          error: "github_admin_required",
          message:
            "GITHUB_TOKEN must have admin access to create repository webhooks.",
        },
        { status: 403 },
      );
    }

    const existingHooks = await client.listRepoWebhooks(owner, repo);
    const hook =
      existingHooks.find((candidate) => candidate.config.url === parsedCallbackUrl) ??
      (await client.createRepoWebhook(owner, repo, {
        callbackUrl: parsedCallbackUrl,
        secret: webhookSecret,
        events: GITHUB_SHIP_LOOP_EVENTS,
      }));

    const now = new Date();
    const repos = await getAgenticSdlcReposCollection();
    const doc: Omit<OnboardedRepo, "_id" | "onboarded_at" | "created_at"> = {
      repo_id: String(meta.id),
      owner,
      name: repo,
      full_name: meta.full_name,
      default_branch: meta.default_branch,
      sandbox_environment: sandboxEnvironment,
      webhook_id: hook.id,
      webhook_secret_hash: hashWebhookSecret(webhookSecret),
      webhook_status: "healthy",
      webhook_last_event_at: null,
      label_to_stage_overrides: {},
      onboarded_by_user_id: reader.user.email,
      offboarded_at: null,
      updated_at: now,
    };

    await repos.updateOne(
      { repo_id: doc.repo_id },
      {
        $set: doc,
        $setOnInsert: {
          onboarded_at: now,
          created_at: now,
        },
      },
      { upsert: true },
    );

    return Response.json(
      {
        item: {
          repo_id: doc.repo_id,
          owner: doc.owner,
          name: doc.name,
          full_name: doc.full_name,
          default_branch: doc.default_branch,
          sandbox_environment: doc.sandbox_environment,
          webhook_id: doc.webhook_id,
          webhook_url: parsedCallbackUrl,
          github_webhook_settings_url: `https://github.com/${doc.full_name}/settings/hooks/${doc.webhook_id}`,
          webhook_events: GITHUB_SHIP_LOOP_EVENTS,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof GitHubClientError) {
      return Response.json(
        {
          error: `github_${err.code}`,
          message: err.message,
          documentation_url: err.documentationUrl,
        },
        { status: err.status ?? 502 },
      );
    }
    throw err;
  }
}

export const POST = withAgenticSdlcGate(handlePost);

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseWebhookCallbackUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    const isLocalForwardTarget =
      url.pathname.endsWith("/api/agentic-sdlc/webhooks/github");
    const isEticloudReceiver =
      url.protocol === "https:" &&
      url.hostname === "github-webhook.eticloud.io" &&
      url.pathname === "/github";
    if (!isLocalForwardTarget && !isEticloudReceiver) return null;
    return url.toString();
  } catch {
    return null;
  }
}
