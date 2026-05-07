/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}
 *
 * Repo-level operating summary for the detail page. Everything is
 * derived from projected Agentic SDLC artifacts/events, so the UI does
 * not need placeholder cards once a repo has live data.
 */

import { getAgenticSdlcReposCollection } from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import {
  getRepoCounts,
  getRepoOperatingSummary,
} from "@/lib/agentic-sdlc/repo-stats";

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
    {
      projection: {
        _id: 0,
        repo_id: 1,
        owner: 1,
        name: 1,
        full_name: 1,
        webhook_status: 1,
        webhook_last_event_at: 1,
        last_reconciled_at: 1,
      },
    },
  );

  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  const [counts, operatingSummary] = await Promise.all([
    getRepoCounts(repoDoc.repo_id),
    getRepoOperatingSummary(repoDoc.repo_id),
  ]);

  return Response.json({
    repo: {
      repo_id: repoDoc.repo_id,
      owner: repoDoc.owner,
      name: repoDoc.name,
      full_name: repoDoc.full_name,
      webhook_status: repoDoc.webhook_status,
      webhook_last_event_at:
        repoDoc.webhook_last_event_at?.toISOString() ?? null,
      last_reconciled_at: repoDoc.last_reconciled_at?.toISOString() ?? null,
    },
    counts,
    ...operatingSummary,
  });
}

export const GET = withAgenticSdlcGate(handle);
