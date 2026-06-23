/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}/changelog
 *
 * Completed-feature changelog: merged Epics, merged PRs, and
 * successful deploys in the lookback window.
 *
 * Query params:
 *   - lookbackDays (default 30, max 365)
 *   - limit        (default 50, max 200)
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { getAgenticSdlcReposCollection } from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { getChangelogEntries } from "@/lib/agentic-sdlc/repo-insights";

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
  const lookbackDays = positiveIntegerParam(url.searchParams.get("lookbackDays"));
  const limit = positiveIntegerParam(url.searchParams.get("limit"));

  const entries = await getChangelogEntries(repoDoc.repo_id, {
    lookbackDays,
    limit,
  });

  return Response.json({
    repo: { owner, name: repo },
    lookback_days: lookbackDays ?? 30,
    items: entries,
  });
}

function positiveIntegerParam(value: string | null): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const GET = withAgenticSdlcGate(handle);
