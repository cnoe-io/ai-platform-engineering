/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}/ci
 *
 * CI status for every in-flight task / PR on the repo. Reads the
 * `ci_summary` field maintained by the async worker (see
 * `lib/agentic-sdlc/ci-projection.ts`) and falls back to the stored
 * check_run / check_suite / workflow_run events when callers ask for
 * the per-check breakdown.
 *
 * Optional `?live=true` query: if a server-side GitHub token is
 * configured (`process.env.GITHUB_TOKEN`), the route refreshes CI
 * directly from the GitHub API for the heads we already know about.
 * Live results are merged into the response so the panel can show
 * fresh data when webhooks have lagged.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  getAgenticSdlcEventsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { getInFlightCi, type InFlightCiArtifact } from "@/lib/agentic-sdlc/repo-insights";
import {
  normaliseConclusion,
  normaliseStatus,
} from "@/lib/agentic-sdlc/ci-projection";
import type { AgenticSdlcEvent, CiCheckRun } from "@/types/agentic-sdlc";

interface RepoCiResponse {
  repo: { owner: string; name: string };
  totals: {
    success: number;
    failure: number;
    pending: number;
    no_ci: number;
  };
  items: Array<
    InFlightCiArtifact & {
      checks: CiCheckRun[];
    }
  >;
  live_refreshed: boolean;
}

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const { owner, repo } = await ctx.params;
  const repos = await getAgenticSdlcReposCollection();
  const repoDoc = await repos.findOne(
    { owner, name: repo, offboarded_at: null },
    { projection: { repo_id: 1, full_name: 1 } },
  );
  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const wantsLive = url.searchParams.get("live") === "true";
  const inFlight = await getInFlightCi(repoDoc.repo_id, {
    limit: positiveIntegerParam(url.searchParams.get("limit")),
  });

  // Per-check breakdown from the events collection for the artifact
  // ids we care about. One query per artifact would be too chatty, so
  // we bulk-load with a single `$in` query and group client-side.
  const artifactIds = inFlight.items.map((item) => item.artifact_id);
  const checksByArtifact = new Map<string, CiCheckRun[]>();
  if (artifactIds.length > 0) {
    const events = await getAgenticSdlcEventsCollection();
    const rows = (await events
      .find(
        {
          repo_id: repoDoc.repo_id,
          artifact_id: { $in: artifactIds },
          github_event_type: { $in: ["check_run", "check_suite", "workflow_run"] },
        },
        {
          projection: { _id: 0, payload: 1, artifact_id: 1, occurred_at: 1, github_event_type: 1, github_delivery_id: 1 },
          sort: { occurred_at: -1 },
          limit: artifactIds.length * 30,
        },
      )
      .toArray()) as Array<
      Pick<
        AgenticSdlcEvent,
        | "payload"
        | "artifact_id"
        | "occurred_at"
        | "github_event_type"
        | "github_delivery_id"
      > & { repo_id?: string }
    >;
    for (const row of rows) {
      const parsed = parseRowToCheck(row, repoDoc.repo_id);
      if (!parsed) continue;
      const existing = checksByArtifact.get(parsed.artifact_id) ?? [];
      // Latest per check_name wins.
      const idx = existing.findIndex((c) => c.check_name === parsed.check_name);
      if (idx < 0) existing.push(parsed);
      else if (
        Date.parse(parsed.completed_at ?? parsed.started_at ?? "") >
        Date.parse(existing[idx].completed_at ?? existing[idx].started_at ?? "")
      ) {
        existing[idx] = parsed;
      }
      checksByArtifact.set(parsed.artifact_id, existing);
    }
  }

  let liveRefreshed = false;
  if (wantsLive) {
    liveRefreshed = await tryLiveRefresh(owner, repo, inFlight.items, checksByArtifact);
  }

  const items = inFlight.items.map((item) => ({
    ...item,
    checks: (checksByArtifact.get(item.artifact_id) ?? []).sort(
      (a, b) => a.check_name.localeCompare(b.check_name),
    ),
  }));

  const body: RepoCiResponse = {
    repo: { owner, name: repo },
    totals: inFlight.totals,
    items,
    live_refreshed: liveRefreshed,
  };
  return Response.json(body);
}

function parseRowToCheck(
  row: {
    payload: Record<string, unknown> | unknown;
    artifact_id: string;
    occurred_at: Date;
    github_event_type: string | null;
    github_delivery_id: string | null;
  },
  repoId: string,
): CiCheckRun | null {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  if (row.github_event_type === "check_run") {
    const run = payload.check_run as Record<string, unknown> | undefined;
    if (!run) return null;
    const status = normaliseStatus(run.status as string | undefined);
    return {
      artifact_id: row.artifact_id,
      repo_id: repoId,
      check_name: (run.name as string | undefined) ?? "check",
      external_id:
        toExternalId(run.id) ?? `${row.github_delivery_id ?? "anon"}:check_run`,
      status,
      conclusion:
        status === "completed"
          ? normaliseConclusion(run.conclusion as string | undefined)
          : "pending",
      details_url: (run.details_url as string | undefined) ?? null,
      started_at: (run.started_at as string | undefined) ?? null,
      completed_at: (run.completed_at as string | undefined) ?? null,
      head_sha: (run.head_sha as string | undefined) ?? null,
    };
  }
  if (row.github_event_type === "check_suite") {
    const suite = payload.check_suite as Record<string, unknown> | undefined;
    if (!suite) return null;
    const status = normaliseStatus(suite.status as string | undefined);
    return {
      artifact_id: row.artifact_id,
      repo_id: repoId,
      check_name: "check_suite",
      external_id:
        toExternalId(suite.id) ?? `${row.github_delivery_id ?? "anon"}:check_suite`,
      status,
      conclusion:
        status === "completed"
          ? normaliseConclusion(suite.conclusion as string | undefined)
          : "pending",
      details_url: (suite.url as string | undefined) ?? null,
      started_at: null,
      completed_at: (suite.updated_at as string | undefined) ?? null,
      head_sha: (suite.head_sha as string | undefined) ?? null,
    };
  }
  if (row.github_event_type === "workflow_run") {
    const run = payload.workflow_run as Record<string, unknown> | undefined;
    if (!run) return null;
    const status = normaliseStatus(run.status as string | undefined);
    return {
      artifact_id: row.artifact_id,
      repo_id: repoId,
      check_name: (run.name as string | undefined) ?? "workflow",
      external_id:
        toExternalId(run.id) ?? `${row.github_delivery_id ?? "anon"}:workflow_run`,
      status,
      conclusion:
        status === "completed"
          ? normaliseConclusion(run.conclusion as string | undefined)
          : "pending",
      details_url: (run.html_url as string | undefined) ?? null,
      started_at: (run.run_started_at as string | undefined) ?? null,
      completed_at: (run.updated_at as string | undefined) ?? null,
      head_sha: (run.head_sha as string | undefined) ?? null,
    };
  }
  return null;
}

function toExternalId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * Best-effort live refresh: when a server-side GitHub token is set,
 * fetch check-runs for each known head SHA and overlay onto the
 * existing per-check map. Fails silently when no token is present or
 * the call errors -- the projected data is still returned.
 */
async function tryLiveRefresh(
  owner: string,
  repo: string,
  items: InFlightCiArtifact[],
  checksByArtifact: Map<string, CiCheckRun[]>,
): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN ?? process.env.AGENTIC_SDLC_GITHUB_TOKEN;
  if (!token) return false;

  // Resolve unique head SHAs we know about; skip artifacts without one.
  const heads = items
    .filter((item) => item.kind === "pull_request" && item.head_sha)
    .map((item) => ({ artifact_id: item.artifact_id, head_sha: item.head_sha as string }));
  if (heads.length === 0) return false;

  // Lazy-import Octokit so unit tests that don't exercise the live
  // branch don't pull the SDK in.
  let Octokit: typeof import("@octokit/rest").Octokit;
  try {
    Octokit = (await import("@octokit/rest")).Octokit;
  } catch {
    return false;
  }
  const octokit = new Octokit({ auth: token, request: { timeout: 8_000 } });

  let refreshed = false;
  await Promise.all(
    heads.map(async ({ artifact_id, head_sha }) => {
      try {
        const res = await octokit.checks.listForRef({
          owner,
          repo,
          ref: head_sha,
          per_page: 50,
        });
        const liveChecks: CiCheckRun[] = res.data.check_runs.map((run) => ({
          artifact_id,
          repo_id: "live",
          check_name: run.name ?? "check",
          external_id: String(run.id),
          status: normaliseStatus(run.status as string | undefined),
          conclusion:
            run.status === "completed"
              ? normaliseConclusion(run.conclusion as string | undefined)
              : "pending",
          details_url: run.details_url ?? null,
          started_at: run.started_at ?? null,
          completed_at: run.completed_at ?? null,
          head_sha,
        }));
        const existing = checksByArtifact.get(artifact_id) ?? [];
        const mergedByName = new Map<string, CiCheckRun>();
        for (const c of existing) mergedByName.set(c.check_name, c);
        for (const c of liveChecks) mergedByName.set(c.check_name, c);
        checksByArtifact.set(artifact_id, Array.from(mergedByName.values()));
        refreshed = true;
      } catch {
        // Swallow per-artifact errors -- a single failure shouldn't
        // disable the live overlay for the rest.
      }
    }),
  );
  return refreshed;
}

function positiveIntegerParam(value: string | null): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const GET = withAgenticSdlcGate(handle);
