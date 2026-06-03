/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}/snapshots
 *
 * Snapshot artifacts produced during the last X runs: GitHub Actions
 * workflow runs, deploy snapshots, and recently-touched agentic
 * artifacts. See `lib/agentic-sdlc/repo-insights.ts#getRecentSnapshots`.
 *
 * Query params:
 *   - recentRuns  (default 5, max 50)
 *   - windowHours (default 24, max 720)
 *   - kinds       comma-separated subset of
 *                 `github_actions_artifact,deploy_snapshot,agentic_artifact`
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { getAgenticSdlcReposCollection } from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { getRecentSnapshots } from "@/lib/agentic-sdlc/repo-insights";
import type { SnapshotArtifactKind } from "@/types/agentic-sdlc";

const ALLOWED_KINDS: SnapshotArtifactKind[] = [
  "github_actions_artifact",
  "deploy_snapshot",
  "agentic_artifact",
];

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
    { projection: { repo_id: 1 } },
  );
  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const recentRuns = positiveIntegerParam(url.searchParams.get("recentRuns"));
  const windowHours = positiveIntegerParam(url.searchParams.get("windowHours"));
  const kinds = parseKinds(url.searchParams.get("kinds"));

  const snapshots = await getRecentSnapshots(repoDoc.repo_id, {
    recentRuns,
    windowHours,
    kinds,
  });

  return Response.json({
    repo: { owner, name: repo },
    window_hours: windowHours ?? 24,
    recent_runs: recentRuns ?? 5,
    by_kind: snapshots.by_kind,
    items: snapshots.items,
  });
}

function parseKinds(raw: string | null): SnapshotArtifactKind[] | undefined {
  if (!raw) return undefined;
  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s): s is SnapshotArtifactKind =>
      ALLOWED_KINDS.includes(s as SnapshotArtifactKind),
    );
  return requested.length > 0 ? requested : undefined;
}

function positiveIntegerParam(value: string | null): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const GET = withAgenticSdlcGate(handle);
