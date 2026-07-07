/**
 * Multiplexed insights endpoint for the Agentic SDLC repo detail page.
 *
 *   GET /api/agentic-sdlc/repos/{owner}/{repo}/insights/{panel}
 *
 * The dynamic `panel` segment is the PanelId from the panel-registry,
 * for example `spec-health`, `intent-drift`, `harness`, `provenance`.
 *
 * One handler per panel keeps the data contract narrow without paying
 * the overhead of N near-identical route files. Each panel resolves to
 * a deterministic JSON payload sourced from
 * `repo-extended-insights.ts`.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { getAgenticSdlcReposCollection } from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import {
  getAgentBudget,
  getAgentRoster,
  getBlackboxAudit,
  getBlastRadius,
  getFailureModes,
  getFanout,
  getHarness,
  getIntentDrift,
  getMistakeEncoded,
  getPrProdMetrics,
  getProdSignals,
  getProvenance,
  getQualityGauntlet,
  getRingActivity,
  getRollbackRehearsal,
  getSpecHealth,
  getVerifierConfidence,
} from "@/lib/agentic-sdlc/repo-extended-insights";

const PANEL_HANDLERS: Record<string, (repoId: string) => Promise<unknown>> = {
  "ring-activity": getRingActivity,
  "spec-health": getSpecHealth,
  "intent-drift": getIntentDrift,
  harness: getHarness,
  "mistake-encoded": getMistakeEncoded,
  "agent-roster": getAgentRoster,
  "agent-budget": getAgentBudget,
  fanout: getFanout,
  "verifier-confidence": getVerifierConfidence,
  "quality-gauntlet": getQualityGauntlet,
  "failure-modes": getFailureModes,
  provenance: getProvenance,
  "blast-radius": getBlastRadius,
  "rollback-rehearsal": getRollbackRehearsal,
  "prod-signals": getProdSignals,
  "pr-prod-metrics": getPrProdMetrics,
  "blackbox-audit": getBlackboxAudit,
};

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string; panel: string }> },
): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const { owner, repo, panel } = await ctx.params;
  const handler = PANEL_HANDLERS[panel];
  if (!handler) {
    return Response.json(
      { error: "unknown_panel", message: `No insights for panel '${panel}'.` },
      { status: 404 },
    );
  }

  const repos = await getAgenticSdlcReposCollection();
  const repoDoc = await repos.findOne(
    { owner, name: repo, offboarded_at: null },
    { projection: { _id: 0, repo_id: 1 } },
  );
  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  try {
    const payload = await handler(repoDoc.repo_id);
    return Response.json(payload);
  } catch (err) {
    return Response.json(
      {
        error: "insights_error",
        message: err instanceof Error ? err.message : "Failed to compute insights.",
      },
      { status: 500 },
    );
  }
}

export const GET = withAgenticSdlcGate(handle);
