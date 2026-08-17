/** Mongo persistence for TOME experiments, immutable evidence, and policies. */

import { createHash, randomUUID } from "node:crypto";

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ProjectType } from "@/types/projects";
import {
  TOME_RUBRIC_IDS,
  type ArtifactEvaluation,
  type ArtifactFileEvaluation,
  type EvidenceBundle,
  type ExperimentArtifact,
  type ExperimentArtifactPage,
  type ExperimentCandidate,
  type QualityGateOverride,
  type QualityPolicy,
  type QualityPolicyScopeKind,
  type ResolvedQualityPolicy,
  type RubricPolicy,
  type TomeExperiment,
} from "@/types/tome-evaluation";

export const TOME_EVIDENCE_BUNDLES_COLLECTION = "tome_evidence_bundles";
export const TOME_EXPERIMENTS_COLLECTION = "tome_experiments";
export const TOME_EXPERIMENT_ARTIFACTS_COLLECTION = "tome_experiment_artifacts";
export const TOME_ARTIFACT_EVALUATIONS_COLLECTION = "tome_artifact_evaluations";
export const TOME_ARTIFACT_FILE_EVALUATIONS_COLLECTION = "tome_artifact_file_evaluations";
export const TOME_QUALITY_POLICIES_COLLECTION = "tome_quality_policies";
export const TOME_QUALITY_GATE_OVERRIDES_COLLECTION = "tome_quality_gate_overrides";

export const TERMINAL_EXPERIMENT_STATUSES: TomeExperiment["status"][] = [
  "stopped_by_user",
  "completed",
  "completed_with_errors",
  "stopped_cost_ceiling",
  "failed",
];

interface DeletionLockedExperiment extends TomeExperiment {
  deletion_token?: string;
  deletion_started_at?: string;
  deletion_started_by?: string;
  deletion_failed_at?: string;
}

export interface ExperimentDeletionSummary {
  deleted_experiments: number;
  deleted_artifacts: number;
  deleted_evaluations: number;
  deleted_file_evaluations: number;
  deleted_evidence_bundles: number;
  deleted_run_ids: string[];
  project_slugs: string[];
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function defaultRubricPolicy(): RubricPolicy {
  const defaults = Object.fromEntries(
    TOME_RUBRIC_IDS.map((id) => [id, { enabled: true, blocking: true }]),
  ) as RubricPolicy;
  return {
    ...defaults,
    atomic_claim_inventory: { enabled: true, min: 1, blocking: true },
    claim_evidence: { enabled: true, min: 0.85, blocking: true },
    citation_coverage: { enabled: true, min: 0.8, blocking: true },
    citation_correctness: { enabled: true, min: 0.9, blocking: true },
    citation_specificity: { enabled: true, min: 0.8, blocking: false },
    grounding: { enabled: true, min: 0.85, blocking: true },
    unsupported_claims: { enabled: true, max_rate: 0.1, blocking: true },
    contradictions: { enabled: true, max_count: 0, max_rate: 0, blocking: true },
    unverifiable_claims: { enabled: true, max_rate: 0.1, blocking: true },
    unsupported_critical_claims: { enabled: true, max_count: 0, blocking: true },
    fabricated_entities: { enabled: true, max_count: 0, blocking: true },
    fabricated_quantitative_details: { enabled: true, max_count: 0, blocking: true },
    explicit_gaps: { enabled: true, min: 1, blocking: true },
    semantic_fidelity: { enabled: true, min: 0.9, blocking: true },
    conflict_disclosure: { enabled: true, min: 1, blocking: true },
    source_freshness: { enabled: true, min: 0.9, blocking: true },
    material_coverage: { enabled: true, min: 0.8, blocking: false },
    scope_fidelity: { enabled: true, min: 1, blocking: true },
    stable_page_preservation: { enabled: true, min: 1, blocking: true },
    template_compliance: { enabled: true, min: 1, blocking: true },
    internal_link_validity: { enabled: true, min: 1, blocking: true },
    attribution_integrity: { enabled: true, min: 1, blocking: true },
    evaluator_confidence: { enabled: true, min: 0.7, blocking: false },
    cost_efficiency: { enabled: true, blocking: false },
    latency_efficiency: { enabled: true, blocking: false },
  };
}

export function qualityPolicyId(
  scopeKind: QualityPolicyScopeKind,
  scopeId: string | null,
): string {
  return `${scopeKind}:${scopeKind === "global" ? "*" : (scopeId ?? "").trim()}`;
}

export function fallbackQualityPolicy(): QualityPolicy {
  return {
    _id: qualityPolicyId("global", null),
    scope_kind: "global",
    scope_id: null,
    version: 0,
    mode: "off",
    evaluator_model: "",
    rubrics: defaultRubricPolicy(),
    require_human_review: true,
    allow_steward_override: true,
    updated_at: new Date(0).toISOString(),
    updated_by: null,
  };
}

export async function getQualityPolicy(
  scopeKind: QualityPolicyScopeKind,
  scopeId: string | null,
): Promise<QualityPolicy | null> {
  if (!isMongoDBConfigured) {
    return scopeKind === "global" ? fallbackQualityPolicy() : null;
  }
  const col = await getCollection<QualityPolicy>(TOME_QUALITY_POLICIES_COLLECTION);
  return col.findOne({ _id: qualityPolicyId(scopeKind, scopeId) });
}

export async function resolveQualityPolicy(input: {
  entityId: string;
  entityType: ProjectType;
}): Promise<ResolvedQualityPolicy> {
  const scopes: Array<[QualityPolicyScopeKind, string | null]> = [
    ["exact", input.entityId],
    ["type", input.entityType],
    ["global", null],
  ];
  for (const [kind, id] of scopes) {
    const policy = await getQualityPolicy(kind, id);
    if (policy) return { policy, source: kind };
  }
  return { policy: fallbackQualityPolicy(), source: "global" };
}

export async function saveQualityPolicy(
  input: Omit<QualityPolicy, "_id" | "version" | "updated_at">,
): Promise<QualityPolicy> {
  const col = await getCollection<QualityPolicy>(TOME_QUALITY_POLICIES_COLLECTION);
  const _id = qualityPolicyId(input.scope_kind, input.scope_id);
  const previous = await col.findOne({ _id });
  const policy: QualityPolicy = {
    ...input,
    _id,
    scope_id: input.scope_kind === "global" ? null : input.scope_id?.trim() || null,
    version: (previous?.version ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };
  await col.replaceOne({ _id }, policy, { upsert: true });
  return policy;
}

export async function listQualityPolicies(): Promise<QualityPolicy[]> {
  if (!isMongoDBConfigured) return [fallbackQualityPolicy()];
  const col = await getCollection<QualityPolicy>(TOME_QUALITY_POLICIES_COLLECTION);
  const policies = await col.find({}).sort({ scope_kind: 1, scope_id: 1 }).toArray();
  return policies.length ? policies : [fallbackQualityPolicy()];
}

export async function insertEvidenceBundle(bundle: EvidenceBundle): Promise<void> {
  const col = await getCollection<EvidenceBundle>(TOME_EVIDENCE_BUNDLES_COLLECTION);
  await col.insertOne(bundle);
}

export async function getEvidenceBundle(id: string): Promise<EvidenceBundle | null> {
  const col = await getCollection<EvidenceBundle>(TOME_EVIDENCE_BUNDLES_COLLECTION);
  return col.findOne({ _id: id });
}

export async function insertExperiment(experiment: TomeExperiment): Promise<void> {
  const col = await getCollection<TomeExperiment>(TOME_EXPERIMENTS_COLLECTION);
  await col.insertOne(experiment);
}

export async function getExperiment(id: string): Promise<TomeExperiment | null> {
  const col = await getCollection<TomeExperiment>(TOME_EXPERIMENTS_COLLECTION);
  return col.findOne({ _id: id });
}

export async function listExperiments(limit = 50): Promise<TomeExperiment[]> {
  const col = await getCollection<TomeExperiment>(TOME_EXPERIMENTS_COLLECTION);
  return col.find({}).sort({ created_at: -1 }).limit(limit).toArray();
}

export async function updateExperiment(
  id: string,
  fields: Partial<Omit<TomeExperiment, "_id">>,
): Promise<void> {
  const col = await getCollection<TomeExperiment>(TOME_EXPERIMENTS_COLLECTION);
  await col.updateOne({ _id: id }, { $set: fields });
}

export async function requestExperimentCancellation(input: {
  id: string;
  actor: string;
}): Promise<boolean> {
  const col = await getCollection<TomeExperiment>(TOME_EXPERIMENTS_COLLECTION);
  const now = new Date().toISOString();
  const result = await col.updateOne(
    { _id: input.id, status: { $in: ["queued", "running", "evaluating"] } },
    { $set: {
      status: "stopped_by_user",
      cancel_requested_at: now,
      cancel_requested_by: input.actor,
      finished_at: now,
    } },
  );
  return result.modifiedCount === 1;
}

export async function claimExperimentFileRetry(input: {
  id: string;
  actor: string;
}): Promise<boolean> {
  const col = await getCollection<DeletionLockedExperiment>(TOME_EXPERIMENTS_COLLECTION);
  const now = new Date().toISOString();
  const result = await col.updateOne(
    {
      _id: input.id,
      status: { $in: ["completed", "completed_with_errors", "failed"] },
      deletion_token: { $exists: false },
      deletion_started_at: { $exists: false },
    },
    {
      $set: {
        status: "evaluating",
        last_file_retry_at: now,
        last_file_retry_by: input.actor,
      },
      $unset: {
        finished_at: "",
        error: "",
        cancel_requested_at: "",
        cancel_requested_by: "",
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function deleteTerminalExperiments(input: {
  actor: string;
  experimentId?: string;
}): Promise<ExperimentDeletionSummary> {
  const experiments = await getCollection<DeletionLockedExperiment>(TOME_EXPERIMENTS_COLLECTION);
  const selector = {
    ...(input.experimentId ? { _id: input.experimentId } : {}),
    status: { $in: TERMINAL_EXPERIMENT_STATUSES },
    deletion_token: { $exists: false },
  };
  const candidates = await experiments.find(selector).toArray();
  if (input.experimentId && candidates.length === 0) {
    const existing = await experiments.findOne({ _id: input.experimentId });
    if (!existing) throw new Error("Experiment not found.");
    if (existing.deletion_token) {
      throw new Error("Experiment deletion is already in progress; refresh and try again.");
    }
    throw new Error("Active experiments must be stopped before deletion.");
  }
  if (candidates.length === 0) {
    return {
      deleted_experiments: 0,
      deleted_artifacts: 0,
      deleted_evaluations: 0,
      deleted_file_evaluations: 0,
      deleted_evidence_bundles: 0,
      deleted_run_ids: [],
      project_slugs: [],
    };
  }

  const deletionToken = randomUUID();
  const candidateIds = candidates.map((experiment) => experiment._id);
  await experiments.updateMany(
    { ...selector, _id: { $in: candidateIds } },
    {
      $set: {
        deletion_token: deletionToken,
        deletion_started_at: new Date().toISOString(),
        deletion_started_by: input.actor,
      },
      $unset: { deletion_failed_at: "" },
    },
  );
  const locked = await experiments.find({ deletion_token: deletionToken }).toArray();
  const experimentIds = locked.map((experiment) => experiment._id);
  if (experimentIds.length === 0) {
    throw new Error("The selected experiments changed before deletion; refresh and try again.");
  }

  try {
    const [artifacts, evaluations, fileEvaluations] = await Promise.all([
      getCollection<ExperimentArtifact>(TOME_EXPERIMENT_ARTIFACTS_COLLECTION),
      getCollection<ArtifactEvaluation>(TOME_ARTIFACT_EVALUATIONS_COLLECTION),
      getCollection<ArtifactFileEvaluation>(TOME_ARTIFACT_FILE_EVALUATIONS_COLLECTION),
    ]);
    const [artifactResult, evaluationResult, fileEvaluationResult] = await Promise.all([
      artifacts.deleteMany({ experiment_id: { $in: experimentIds } }),
      evaluations.deleteMany({ experiment_id: { $in: experimentIds } }),
      fileEvaluations.deleteMany({ experiment_id: { $in: experimentIds } }),
    ]);
    const experimentResult = await experiments.deleteMany({
      _id: { $in: experimentIds },
      deletion_token: deletionToken,
    });

    const evidenceBundles = await getCollection<EvidenceBundle>(TOME_EVIDENCE_BUNDLES_COLLECTION);
    let deletedEvidenceBundles = 0;
    for (const evidenceBundleId of new Set(locked.map((experiment) => experiment.evidence_bundle_id))) {
      if (await experiments.countDocuments({ evidence_bundle_id: evidenceBundleId }) === 0) {
        try {
          deletedEvidenceBundles += (await evidenceBundles.deleteOne({ _id: evidenceBundleId }))
            .deletedCount;
        } catch (error) {
          // The run-owned records are already gone. Leave an unreferenced
          // evidence bundle for later cleanup instead of reporting that the
          // requested deletion failed after it actually succeeded.
          console.warn("[tome-evaluations] orphan evidence cleanup failed", {
            evidenceBundleId,
            error,
          });
        }
      }
    }
    return {
      deleted_experiments: experimentResult.deletedCount,
      deleted_artifacts: artifactResult.deletedCount,
      deleted_evaluations: evaluationResult.deletedCount,
      deleted_file_evaluations: fileEvaluationResult.deletedCount,
      deleted_evidence_bundles: deletedEvidenceBundles,
      deleted_run_ids: experimentIds,
      project_slugs: [...new Set(locked.map((experiment) => experiment.project_slug))],
    };
  } catch (error) {
    await experiments.updateMany(
      { deletion_token: deletionToken },
      {
        $set: { deletion_failed_at: new Date().toISOString() },
        $unset: {
          deletion_token: "",
          deletion_started_by: "",
        },
      },
    );
    throw error;
  }
}

export async function claimExperimentPromotion(input: {
  experimentId: string;
  candidate: ExperimentCandidate;
  artifactId: string;
  runId: string;
}): Promise<boolean> {
  const col = await getCollection<DeletionLockedExperiment>(TOME_EXPERIMENTS_COLLECTION);
  const result = await col.updateOne(
    {
      _id: input.experimentId,
      promoted_run_id: { $exists: false },
      deletion_token: { $exists: false },
      deletion_started_at: { $exists: false },
    },
    {
      $set: {
        selected_winner: input.candidate,
        selected_artifact_id: input.artifactId,
        promoted_run_id: input.runId,
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function releaseExperimentPromotion(experimentId: string, runId: string): Promise<void> {
  const col = await getCollection<TomeExperiment>(TOME_EXPERIMENTS_COLLECTION);
  await col.updateOne(
    { _id: experimentId, promoted_run_id: runId },
    { $unset: { selected_winner: "", selected_artifact_id: "", promoted_run_id: "" } },
  );
}

export async function createExperimentArtifact(
  input: Omit<ExperimentArtifact, "pages">,
  initialPages: Record<string, string> = {},
): Promise<void> {
  const col = await getCollection<ExperimentArtifact>(TOME_EXPERIMENT_ARTIFACTS_COLLECTION);
  const pages: ExperimentArtifactPage[] = Object.entries(initialPages).map(([path, markdown]) => ({
    path,
    markdown,
    content_hash: sha256(markdown),
    written_at: input.created_at,
  }));
  await col.insertOne({ ...input, pages });
}

export async function writeExperimentArtifactPage(
  artifactId: string,
  path: string,
  markdown: string,
): Promise<void> {
  const col = await getCollection<ExperimentArtifact>(TOME_EXPERIMENT_ARTIFACTS_COLLECTION);
  const now = new Date().toISOString();
  const page: ExperimentArtifactPage = {
    path,
    markdown,
    content_hash: sha256(markdown),
    written_at: now,
  };
  const result = await col.updateOne(
    { _id: artifactId, finalized_at: { $exists: false } },
    [{
      $set: {
        pages: {
          $concatArrays: [
            {
              $filter: {
                input: "$pages",
                as: "existing",
                cond: { $ne: ["$$existing.path", path] },
              },
            },
            [page],
          ],
        },
        updated_at: now,
      },
    }],
  );
  if (result.matchedCount !== 1) throw new Error(`experiment artifact ${artifactId} not found`);
}

export async function finalizeExperimentArtifact(artifactId: string): Promise<void> {
  const col = await getCollection<ExperimentArtifact>(TOME_EXPERIMENT_ARTIFACTS_COLLECTION);
  const result = await col.updateOne(
    { _id: artifactId, finalized_at: { $exists: false } },
    { $set: { finalized_at: new Date().toISOString() } },
  );
  if (result.matchedCount !== 1) throw new Error(`experiment artifact ${artifactId} not found`);
}

export async function getExperimentArtifact(id: string): Promise<ExperimentArtifact | null> {
  const col = await getCollection<ExperimentArtifact>(TOME_EXPERIMENT_ARTIFACTS_COLLECTION);
  return col.findOne({ _id: id });
}

export async function listExperimentArtifacts(experimentId: string): Promise<ExperimentArtifact[]> {
  const col = await getCollection<ExperimentArtifact>(TOME_EXPERIMENT_ARTIFACTS_COLLECTION);
  return col.find({ experiment_id: experimentId }).sort({ trial: 1, candidate: 1 }).toArray();
}

export async function insertArtifactEvaluation(evaluation: ArtifactEvaluation): Promise<void> {
  const col = await getCollection<ArtifactEvaluation>(TOME_ARTIFACT_EVALUATIONS_COLLECTION);
  await col.insertOne(evaluation);
}

export async function upsertArtifactEvaluation(evaluation: ArtifactEvaluation): Promise<void> {
  const col = await getCollection<ArtifactEvaluation>(TOME_ARTIFACT_EVALUATIONS_COLLECTION);
  await col.replaceOne(
    { experiment_id: evaluation.experiment_id, artifact_id: evaluation.artifact_id },
    evaluation,
    { upsert: true },
  );
}

export async function getArtifactEvaluation(id: string): Promise<ArtifactEvaluation | null> {
  const col = await getCollection<ArtifactEvaluation>(TOME_ARTIFACT_EVALUATIONS_COLLECTION);
  return col.findOne({ _id: id });
}

export async function listArtifactEvaluations(experimentId: string): Promise<ArtifactEvaluation[]> {
  const col = await getCollection<ArtifactEvaluation>(TOME_ARTIFACT_EVALUATIONS_COLLECTION);
  return col.find({ experiment_id: experimentId }).sort({ created_at: 1 }).toArray();
}

export async function upsertArtifactFileEvaluation(
  evaluation: ArtifactFileEvaluation,
): Promise<void> {
  const col = await getCollection<ArtifactFileEvaluation>(
    TOME_ARTIFACT_FILE_EVALUATIONS_COLLECTION,
  );
  await col.replaceOne({ _id: evaluation._id }, evaluation, { upsert: true });
}

export async function listArtifactFileEvaluations(
  experimentId: string,
  artifactId?: string,
): Promise<ArtifactFileEvaluation[]> {
  const col = await getCollection<ArtifactFileEvaluation>(
    TOME_ARTIFACT_FILE_EVALUATIONS_COLLECTION,
  );
  return col.find({
    experiment_id: experimentId,
    ...(artifactId ? { artifact_id: artifactId } : {}),
  }).sort({ artifact_id: 1, path: 1 }).toArray();
}

export async function insertQualityGateOverride(
  override: Omit<QualityGateOverride, "_id" | "created_at">,
): Promise<QualityGateOverride> {
  const doc: QualityGateOverride = {
    ...override,
    _id: randomUUID(),
    created_at: new Date().toISOString(),
  };
  const col = await getCollection<QualityGateOverride>(TOME_QUALITY_GATE_OVERRIDES_COLLECTION);
  await col.insertOne(doc);
  return doc;
}
