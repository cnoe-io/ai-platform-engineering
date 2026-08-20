/** Evaluate a normal ingest draft against the evidence frozen before the run. */

import { randomUUID } from "node:crypto";

import {
  defaultRubricPolicy,
  getEvidenceBundle,
  insertArtifactEvaluation,
} from "@/lib/tome/evaluation-store";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { getAllPageTemplates } from "@/lib/tome/page-templates-store";
import { parseFrontmatter } from "@/lib/tome/schema";
import { calculateRubrics, type EvaluatorSignals } from "@/lib/tome/rubric-evaluator";
import type { ClaimFinding, ArtifactEvaluation } from "@/types/tome-evaluation";

interface RawEvaluationResponse {
  claims?: ClaimFinding[];
  signals?: EvaluatorSignals;
  tokens?: { input?: number; output?: number };
  turns?: number;
  cost_usd?: number | null;
}

export async function evaluateDraftQuality(
  runId: string,
  candidatePages: Record<string, string>,
): Promise<ArtifactEvaluation | null> {
  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId });
  if (!run || run.quality_policy_mode === "off" || !run.evidence_bundle_id) return null;
  const bundle = await getEvidenceBundle(run.evidence_bundle_id);
  if (!bundle || (run.evidence_hash && bundle.content_hash !== run.evidence_hash)) {
    throw new Error("Quality evaluation evidence bundle is missing or changed.");
  }
  const templates = await getAllPageTemplates();
  const requiredPaths = templates.find((template) => template.scope === "top-level")?.pages
    .filter((page) => page.enabled !== false).map((page) => page.path) ?? [];
  const requiredTemplates = templates.find((template) => template.scope === "top-level")?.pages
    .filter((page) => page.enabled !== false) ?? [];
  const baseline = Object.fromEntries(
    bundle.items
      .filter((item) => item.workspace_project_id === run.project_id && item.page_path)
      .map((item) => [item.page_path!, item.content]),
  );
  const liveStablePages = Object.fromEntries(
    Object.entries(baseline).filter(([, markdown]) => parseFrontmatter(markdown)[0].kind === "stable"),
  );
  const evaluatorModel = run.quality_evaluator_model?.trim() || run.model?.trim();
  const started = Date.now();
  let raw: RawEvaluationResponse | null = null;
  let error: string | undefined;
  if (!evaluatorModel) {
    error = "Quality policy has no evaluator model and the generator model is unavailable.";
  } else if (!process.env.TOME_AGENT_URL) {
    error = "TOME_AGENT_URL not configured";
  } else {
    try {
      const response = await fetch(`${process.env.TOME_AGENT_URL.replace(/\/$/, "")}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blind_label: `draft-${shaLabel(runId)}`,
          evaluator_model: evaluatorModel,
          entity_type: run.quality_entity_type ?? "project",
          candidate_pages: candidatePages,
          evidence: bundle.items.map((item) => ({
            id: item.id,
            canonical_uri: item.canonical_uri,
            content_hash: item.content_hash,
            content: item.content,
          })),
          required_template_paths: requiredPaths,
          live_stable_pages: liveStablePages,
        }),
      });
      if (!response.ok) throw new Error(`Evaluator failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
      raw = await response.json() as RawEvaluationResponse;
    } catch (caught) {
      error = String((caught as Error)?.message ?? caught);
    }
  }
  const claims = raw?.claims ?? [];
  const rubrics = calculateRubrics(run.quality_rubric_policy ?? defaultRubricPolicy(), {
    claims,
    candidatePages,
    evidencePagePaths: bundle.items.flatMap((item) => item.page_path ? [item.page_path] : []),
    evidenceItems: bundle.items,
    requiredTemplatePaths: requiredPaths,
    requiredTemplates,
    liveStablePages,
    signals: raw?.signals,
    generationCostUsd: run.cost_usd,
    evaluationCostUsd: raw?.cost_usd ?? undefined,
    evaluationLatencyMs: Date.now() - started,
  });
  const blockers = rubrics
    .filter((rubric) => rubric.enabled && rubric.blocking && rubric.passed !== true)
    .flatMap((rubric) => [rubric.id, ...rubric.findings]);
  if (error) blockers.unshift(error);
  const evaluation: ArtifactEvaluation = {
    _id: randomUUID(),
    experiment_id: `ingest:${runId}`,
    artifact_id: `report:${run.report_id ?? runId}`,
    blind_label: `draft-${shaLabel(runId)}`,
    evaluator_model: evaluatorModel ?? "",
    evaluator_is_candidate: Boolean(evaluatorModel && evaluatorModel === run.model),
    status: error ? "error" : blockers.length === 0 ? "passed" : "failed",
    claims,
    rubrics,
    blocking_findings: blockers,
    evaluation_tokens: {
      input: raw?.tokens?.input ?? 0,
      output: raw?.tokens?.output ?? 0,
    },
    evaluation_turns: raw?.turns ?? (error ? undefined : 1),
    evaluation_latency_ms: Date.now() - started,
    evaluation_cost_usd: raw?.cost_usd ?? undefined,
    created_at: new Date().toISOString(),
    error,
  };
  await insertArtifactEvaluation(evaluation);
  await runs.updateOne({ _id: runId }, { $set: { quality_evaluation_id: evaluation._id } });
  return evaluation;
}

function shaLabel(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const __test = { shaLabel };
