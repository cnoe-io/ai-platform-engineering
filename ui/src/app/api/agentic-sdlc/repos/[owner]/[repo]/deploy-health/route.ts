/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}/deploy-health
 *
 * Rich per-environment deployment health: success rate, failure
 * count, median duration, median recovery (MTTR-ish), recent deploys,
 * and failure reasons. Driven by `deployment_status` events plus the
 * projected `deploy` artifacts. See
 * `lib/agentic-sdlc/repo-insights.ts#getDeploymentHealth`.
 *
 * Query params:
 *   - windowHours (default 168 = 7d, max 2160 = 90d)
 *   - recentPerEnv (default 10, max 50)
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { getAgenticSdlcReposCollection } from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { getDeploymentHealth } from "@/lib/agentic-sdlc/repo-insights";

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
  const windowHours = positiveIntegerParam(url.searchParams.get("windowHours"));
  const recentPerEnv = positiveIntegerParam(url.searchParams.get("recentPerEnv"));

  const health = await getDeploymentHealth(repoDoc.repo_id, {
    windowHours,
    recentPerEnv,
  });

  return Response.json({
    repo: { owner, name: repo },
    ...health,
  });
}

function positiveIntegerParam(value: string | null): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const GET = withAgenticSdlcGate(handle);
