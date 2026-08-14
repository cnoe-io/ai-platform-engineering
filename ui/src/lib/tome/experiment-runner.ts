/** Orchestrates isolated, paired TOME model experiments. */

import { randomUUID } from "node:crypto";

import {
  buildIngestRequest,
  type AgentExperimentRunContext,
  type AgentIngestRequest,
} from "@/lib/tome/agent-proxy";
import { resolveAreaChildren, resolveBhagChildren } from "@/lib/tome/bhag";
import { captureEvidenceBundle } from "@/lib/tome/evidence-bundle";
import {
  createExperimentArtifact,
  finalizeExperimentArtifact,
  getExperiment,
  insertArtifactEvaluation,
  insertExperiment,
  listExperimentArtifacts,
  requestExperimentCancellation,
  resolveQualityPolicy,
  sha256,
  stableJson,
  updateExperiment,
} from "@/lib/tome/evaluation-store";
import {
  blindAssignments,
  candidateOrder,
  costCeilingReached,
  deterministicUuid,
} from "@/lib/tome/experiment-planning";
import { testTomeModel } from "@/lib/tome/model-check";
import { getAllPageTemplates } from "@/lib/tome/page-templates-store";
import { parseFrontmatter } from "@/lib/tome/schema";
import {
  aggregateExperiment,
  calculateRubrics,
  type EvaluatorSignals,
} from "@/lib/tome/rubric-evaluator";
import type { ProjectDocument } from "@/types/projects";
import type {
  ArtifactEvaluation,
  ClaimFinding,
  EvidenceBundle,
  EvaluatorPromptContract,
  ExperimentArtifact,
  ExperimentOperation,
  ExperimentTrial,
  RubricPolicy,
  TomeExperiment,
} from "@/types/tome-evaluation";
import { TOME_RUBRIC_IDS } from "@/types/tome-evaluation";

const inflight = new Set<Promise<void>>();
const activeControllers = new Map<string, AbortController>();
const PROMPT_CONTRACT_VERSION = "tome-grounded-experiment-v1";
const TOOL_CONTRACT_VERSION = "tome-offline-evidence-tools-v1";

export interface StartExperimentInput {
  project: ProjectDocument & { _id: string };
  createdBy: string;
  modelA: string;
  modelB: string;
  evaluatorModel: string;
  operation: ExperimentOperation;
  evaluationSuiteId?: string;
  repeatCount?: number;
  rubricPolicy?: RubricPolicy;
  costCeilingUsd?: number;
  turnLimit?: number;
  seed?: number;
  instruction?: string | null;
}

async function cancellationRequested(id: string): Promise<boolean> {
  const experiment = await getExperiment(id);
  return Boolean(experiment?.cancel_requested_at || experiment?.status === "stopped_by_user");
}

async function withExperimentAbort<T>(
  id: string,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  activeControllers.set(id, controller);
  try {
    return await action(controller.signal);
  } finally {
    if (activeControllers.get(id) === controller) activeControllers.delete(id);
  }
}

export async function stopExperiment(input: { id: string; actor: string }): Promise<boolean> {
  const requested = await requestExperimentCancellation(input);
  if (requested) activeControllers.get(input.id)?.abort();
  return requested;
}

interface ExperimentChildProject {
  _id: string;
  slug: string;
  name: string;
}

interface AgentAccounting {
  model?: string;
  model_provenance?: ExperimentTrial["model_provenance"];
  cost_usd?: number;
  turns?: number;
  usage?: { input: number; output: number };
}

interface RawEvaluationResponse {
  claims?: ClaimFinding[];
  signals?: EvaluatorSignals;
  tokens?: { input?: number; output?: number };
  turns?: number;
  cost_usd?: number | null;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value!)));
}

async function requireSmokeTests(models: string[]): Promise<void> {
  const unique = [...new Set(models.map((model) => model.trim()))];
  const results = await Promise.all(unique.map(async (model) => ({
    model,
    result: await testTomeModel(model),
  })));
  const failures = results.filter(({ result }) => !result.ok);
  if (failures.length > 0) {
    throw new Error(
      `Model smoke test failed: ${failures.map(({ model, result }) =>
        `${model}: ${"error" in result ? result.error : "unknown error"}`
      ).join("; ")}`,
    );
  }
}

async function loadEvaluatorPromptContract(): Promise<EvaluatorPromptContract | undefined> {
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) return undefined;
  try {
    const response = await fetch(`${agentUrl.replace(/\/$/, "")}/evaluate/prompt`);
    if (!response.ok) {
      console.warn(`[TomeExperiment] evaluator prompt snapshot unavailable (${response.status})`);
      return undefined;
    }
    const value = await response.json() as Partial<EvaluatorPromptContract>;
    if (typeof value.version !== "string"
      || typeof value.system_prompt !== "string"
      || typeof value.request_template !== "string"
      || value.editable !== false) {
      console.warn("[TomeExperiment] evaluator prompt snapshot returned an invalid contract");
      return undefined;
    }
    return value as EvaluatorPromptContract;
  } catch (error) {
    console.warn("[TomeExperiment] evaluator prompt snapshot failed", error);
    return undefined;
  }
}

function pagesForProject(bundle: EvidenceBundle, projectId: string): Record<string, string> {
  return Object.fromEntries(
    bundle.items
      .filter((item) => item.workspace_project_id === projectId && item.page_path)
      .map((item) => [item.page_path!, item.content]),
  );
}

function stablePages(pages: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pages).filter(([, markdown]) => parseFrontmatter(markdown)[0].kind === "stable"),
  );
}

function experimentContext(
  experiment: TomeExperiment,
  trial: ExperimentTrial,
  bundle: EvidenceBundle,
  templates: Awaited<ReturnType<typeof getAllPageTemplates>>,
  childProjects: ExperimentChildProject[],
): AgentExperimentRunContext {
  return {
    experiment_id: experiment._id,
    artifact_id: trial.artifact_id,
    evidence_bundle_id: bundle._id,
    blind_label: blindAssignments(experiment._id, trial.trial)[trial.candidate],
    model: trial.model,
    turn_limit: experiment.config.turn_limit,
    seed: experiment.config.seed + trial.trial,
    frozen_pages: pagesForProject(bundle, experiment.project_id),
    frozen_child_pages: Object.fromEntries(
      childProjects.map((project) => [project._id, pagesForProject(bundle, project._id)]),
    ),
    frozen_evidence: bundle.items.map((item) => ({
      canonical_uri: item.canonical_uri,
      content_hash: item.content_hash,
      content: item.content,
    })),
    template_overrides: Object.fromEntries(
      templates.map((template) => [
        template.scope,
        template.pages.map((page) => ({ ...page })),
      ]),
    ),
  };
}

async function parseAgentStream(response: Response): Promise<AgentAccounting> {
  if (!response.ok || !response.body) {
    throw new Error(`TOME agent generation failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: AgentAccounting = {};
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
      const json = frame.split("\n").filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim()).join("\n");
      if (event === "error") throw new Error(json || "TOME agent returned an error");
      if (event === "done" && json) done = JSON.parse(json) as AgentAccounting;
      separator = buffer.indexOf("\n\n");
    }
  }
  return done;
}

async function runCandidate(
  experiment: TomeExperiment,
  trial: ExperimentTrial,
  bundle: EvidenceBundle,
  templates: Awaited<ReturnType<typeof getAllPageTemplates>>,
  childProjects: ExperimentChildProject[],
  project: ProjectDocument & { _id: string },
  signal?: AbortSignal,
): Promise<AgentAccounting> {
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) throw new Error("TOME_AGENT_URL not configured");
  const request = buildIngestRequest(project, {
    runId: trial.run_identity,
    reportId: trial.run_identity,
    seed: experiment.config.instruction ?? null,
    isGreenfield: Object.keys(pagesForProject(bundle, project._id)).length === 0,
    mode: "full",
    credentials: {},
    childProjects: childProjects.map((child) => ({
      project_id: child._id,
      slug: child.slug,
      name: child.name || child.slug,
    })),
    triggeredBy: "manual",
  }) as AgentIngestRequest;
  request.experiment = experimentContext(experiment, trial, bundle, templates, childProjects);
  const response = await fetch(
    `${agentUrl.replace(/\/$/, "")}/${experiment.config.operation}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    },
  );
  return parseAgentStream(response);
}

async function evaluateArtifact(
  experiment: TomeExperiment,
  artifact: ExperimentArtifact,
  trial: ExperimentTrial,
  bundle: EvidenceBundle,
  requiredTemplatePaths: string[],
  requiredTemplates: Array<{ path: string; kind: string; body?: string }>,
  baselinePages: Record<string, string>,
  signal?: AbortSignal,
): Promise<ArtifactEvaluation> {
  const started = Date.now();
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) throw new Error("TOME_AGENT_URL not configured");
  const response = await fetch(`${agentUrl.replace(/\/$/, "")}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      blind_label: artifact.blind_label,
      evaluator_model: experiment.config.evaluator_model,
      evaluator_prompt_version: experiment.config.evaluator_prompt_contract?.version,
      entity_type: experiment.config.entity_type,
      candidate_pages: Object.fromEntries(artifact.pages.map((page) => [page.path, page.markdown])),
      evidence: bundle.items.map((item) => ({
        id: item.id,
        canonical_uri: item.canonical_uri,
        content_hash: item.content_hash,
        content: item.content,
      })),
      required_template_paths: requiredTemplatePaths,
      live_stable_pages: stablePages(baselinePages),
    }),
  });
  if (!response.ok) {
    throw new Error(`Evaluator failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  const raw = await response.json() as RawEvaluationResponse;
  const claims = Array.isArray(raw.claims) ? raw.claims : [];
  const candidatePages = Object.fromEntries(artifact.pages.map((page) => [page.path, page.markdown]));
  const rubrics = calculateRubrics(experiment.config.rubric_policy, {
    claims,
    candidatePages,
    evidencePagePaths: bundle.items.flatMap((item) => item.page_path ? [item.page_path] : []),
    evidenceItems: bundle.items,
    requiredTemplatePaths,
    requiredTemplates,
    liveStablePages: stablePages(baselinePages),
    signals: raw.signals,
    generationCostUsd: trial?.cost_usd,
    evaluationCostUsd: raw.cost_usd ?? undefined,
    generationLatencyMs: trial?.generation_latency_ms,
    evaluationLatencyMs: Date.now() - started,
  });
  const blocking = rubrics
    .filter((rubric) => rubric.enabled && rubric.blocking && rubric.passed !== true)
    .flatMap((rubric) => [rubric.id, ...rubric.findings]);
  return {
    _id: randomUUID(),
    experiment_id: experiment._id,
    artifact_id: artifact._id,
    blind_label: artifact.blind_label,
    evaluator_model: experiment.config.evaluator_model,
    evaluator_is_candidate: [experiment.config.model_a, experiment.config.model_b]
      .includes(experiment.config.evaluator_model),
    status: blocking.length === 0 ? "passed" : "failed",
    claims,
    rubrics,
    blocking_findings: blocking,
    evaluation_tokens: {
      input: raw.tokens?.input ?? 0,
      output: raw.tokens?.output ?? 0,
    },
    evaluation_turns: raw.turns ?? 1,
    evaluation_latency_ms: Date.now() - started,
    evaluation_cost_usd: raw.cost_usd ?? undefined,
    created_at: new Date().toISOString(),
  };
}

async function childrenFor(project: ProjectDocument & { _id: string }): Promise<ExperimentChildProject[]> {
  const children = project.type === "area"
    ? await resolveAreaChildren(project.slug)
    : project.type === "bhag"
      ? await resolveBhagChildren(project.slug)
      : [];
  return children.map((child) => ({
    _id: child.project_id,
    slug: child.slug,
    name: child.name,
  }));
}

async function driveExperiment(
  experiment: TomeExperiment,
  project: ProjectDocument & { _id: string },
  bundle: EvidenceBundle,
  templates: Awaited<ReturnType<typeof getAllPageTemplates>>,
  childProjects: ExperimentChildProject[],
): Promise<void> {
  const trials = experiment.trials.map((trial) => ({ ...trial }));
  let totalCost = 0;
  let stopped = false;
  let stoppedByUser = false;
  try {
    await updateExperiment(experiment._id, {
      status: "running",
      started_at: new Date().toISOString(),
    });
    for (let trialNumber = 1; trialNumber <= experiment.config.repeat_count; trialNumber += 1) {
      if (await cancellationRequested(experiment._id)) {
        stoppedByUser = true;
        break;
      }
      for (const candidate of candidateOrder(experiment._id, trialNumber)) {
        const index = trials.findIndex((trial) => trial.trial === trialNumber && trial.candidate === candidate);
        if (await cancellationRequested(experiment._id)) {
          stoppedByUser = true;
          break;
        }
        if (costCeilingReached(totalCost, experiment.config.cost_ceiling_usd)) {
          stopped = true;
          trials[index].status = "not_started";
          continue;
        }
        const started = Date.now();
        trials[index].status = "running";
        await updateExperiment(experiment._id, { trials });
        try {
          const accounting = await withExperimentAbort(
            experiment._id,
            (signal) => runCandidate(
              experiment,
              trials[index],
              bundle,
              templates,
              childProjects,
              project,
              signal,
            ),
          );
          trials[index] = {
            ...trials[index],
            status: "succeeded",
            generation_latency_ms: Date.now() - started,
            model: accounting.model || trials[index].model,
            model_provenance: accounting.model_provenance,
            cost_usd: accounting.cost_usd,
            turns: accounting.turns,
            tokens: accounting.usage,
          };
          totalCost += accounting.cost_usd ?? 0;
        } catch (error) {
          if (await cancellationRequested(experiment._id)) {
            stoppedByUser = true;
            trials[index] = { ...trials[index], status: "not_started" };
          } else {
            trials[index] = {
              ...trials[index],
              status: "failed",
              generation_latency_ms: Date.now() - started,
              error: String((error as Error)?.message ?? error),
            };
          }
        }
        await finalizeExperimentArtifact(trials[index].artifact_id);
        await updateExperiment(experiment._id, { trials });
        if (stoppedByUser) break;
      }

      if (stoppedByUser) break;
      await updateExperiment(experiment._id, { status: "evaluating", trials });
      const artifacts = (await listExperimentArtifacts(experiment._id))
        .filter((artifact) => artifact.trial === trialNumber)
        .sort((left, right) => left.blind_label.localeCompare(right.blind_label));
      const requiredPaths = templates
        .find((template) => template.scope === "top-level")?.pages
        .filter((page) => page.enabled !== false)
        .map((page) => page.path) ?? [];
      const requiredTemplates = templates
        .find((template) => template.scope === "top-level")?.pages
        .filter((page) => page.enabled !== false) ?? [];
      for (const artifact of artifacts) {
        if (await cancellationRequested(experiment._id)) {
          stoppedByUser = true;
          break;
        }
        const trial = trials.find((value) => value.artifact_id === artifact._id);
        if (trial?.status !== "succeeded") continue;
        if (costCeilingReached(totalCost, experiment.config.cost_ceiling_usd)) {
          stopped = true;
          continue;
        }
        try {
          const evaluation = await withExperimentAbort(
            experiment._id,
            (signal) => evaluateArtifact(
              experiment,
              artifact,
              trial,
              bundle,
              requiredPaths,
              requiredTemplates,
              pagesForProject(bundle, project._id),
              signal,
            ),
          );
          totalCost += evaluation.evaluation_cost_usd ?? 0;
          await insertArtifactEvaluation(evaluation);
        } catch (error) {
          if (await cancellationRequested(experiment._id)) {
            stoppedByUser = true;
            break;
          }
          await insertArtifactEvaluation({
            _id: randomUUID(),
            experiment_id: experiment._id,
            artifact_id: artifact._id,
            blind_label: artifact.blind_label,
            evaluator_model: experiment.config.evaluator_model,
            evaluator_is_candidate: [experiment.config.model_a, experiment.config.model_b]
              .includes(experiment.config.evaluator_model),
            status: "error",
            claims: [],
            rubrics: calculateRubrics(experiment.config.rubric_policy, {
              claims: [],
              candidatePages: Object.fromEntries(artifact.pages.map((page) => [page.path, page.markdown])),
              evidencePagePaths: bundle.items.flatMap((item) => item.page_path ? [item.page_path] : []),
              evidenceItems: bundle.items,
              requiredTemplatePaths: requiredPaths,
              requiredTemplates,
            }),
            blocking_findings: [String((error as Error)?.message ?? error)],
            created_at: new Date().toISOString(),
            error: String((error as Error)?.message ?? error),
          });
        }
      }
      if (stoppedByUser) break;
      if (stopped) break;
      await updateExperiment(experiment._id, { status: "running", trials });
    }
    if (stopped || stoppedByUser) {
      for (const trial of trials) {
        if (["queued", "running"].includes(trial.status)) trial.status = "not_started";
      }
    }
    await updateExperiment(experiment._id, {
      status: stoppedByUser ? "stopped_by_user" : stopped ? "stopped_cost_ceiling" : "completed",
      trials,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    const cancelled = await cancellationRequested(experiment._id);
    await updateExperiment(experiment._id, cancelled ? {
      status: "stopped_by_user",
      trials: trials.map((trial) => ["queued", "running"].includes(trial.status)
        ? { ...trial, status: "not_started" as const }
        : trial),
      finished_at: new Date().toISOString(),
    } : {
      status: "failed",
      trials,
      error: String((error as Error)?.message ?? error),
      finished_at: new Date().toISOString(),
    });
  }
}

export async function startExperiment(input: StartExperimentInput): Promise<TomeExperiment> {
  const modelA = input.modelA.trim();
  const modelB = input.modelB.trim();
  const evaluatorModel = input.evaluatorModel.trim();
  if (!modelA || !modelB || !evaluatorModel) throw new Error("All three model ids are required.");
  if (modelA === modelB) throw new Error("Model A and Model B must be different.");
  await requireSmokeTests([modelA, modelB, evaluatorModel]);

  const childProjects = await childrenFor(input.project);
  const [templates, resolvedPolicy, evaluatorPromptContract] = await Promise.all([
    getAllPageTemplates(),
    resolveQualityPolicy({
      entityId: input.project._id,
      entityType: input.project.type ?? "project",
    }),
    loadEvaluatorPromptContract(),
  ]);
  const bundle = await captureEvidenceBundle({
    project: input.project,
    childProjects,
    createdBy: input.createdBy,
    seed: input.instruction,
  });
  const id = randomUUID();
  const repeatCount = boundedInteger(input.repeatCount, 3, 1, 10);
  const seed = boundedInteger(input.seed, 1, 0, 2_147_483_647);
  const rubricPolicy = Object.fromEntries(TOME_RUBRIC_IDS.map((rubricId) => {
    const override = input.rubricPolicy?.[rubricId];
    return [rubricId, {
      ...resolvedPolicy.policy.rubrics[rubricId],
      ...(override && typeof override === "object" ? override : {}),
    }];
  })) as RubricPolicy;
  const trials: ExperimentTrial[] = [];
  for (let trial = 1; trial <= repeatCount; trial += 1) {
    const blind = blindAssignments(id, trial);
    for (const candidate of ["a", "b"] as const) {
      const artifactId = randomUUID();
      const now = new Date().toISOString();
      const model = candidate === "a" ? modelA : modelB;
      trials.push({
        trial,
        candidate,
        run_identity: deterministicUuid(`${id}:${trial}:${candidate}:${seed}`),
        artifact_id: artifactId,
        status: "queued",
        model,
      });
      await createExperimentArtifact({
        _id: artifactId,
        experiment_id: id,
        project_id: input.project._id,
        trial,
        candidate,
        blind_label: blind[candidate],
        model,
        run_identity: deterministicUuid(`${id}:${trial}:${candidate}:${seed}`),
        evidence_bundle_id: bundle._id,
        created_at: now,
        updated_at: now,
      }, pagesForProject(bundle, input.project._id));
    }
  }
  const operation = input.operation;
  const experiment: TomeExperiment = {
    _id: id,
    project_id: input.project._id,
    project_slug: input.project.slug,
    evidence_bundle_id: bundle._id,
    evidence_hash: bundle.content_hash,
    config: {
      evaluation_suite_id: input.evaluationSuiteId?.trim() || "live-entity",
      evaluation_suite_version: 1,
      model_a: modelA,
      model_b: modelB,
      evaluator_model: evaluatorModel,
      operation,
      entity_type: input.project.type ?? "project",
      entity_id: input.project._id,
      repeat_count: repeatCount,
      cost_ceiling_usd: Math.max(0.01, input.costCeilingUsd ?? 25),
      promotion_mode: "manual",
      rubric_policy: rubricPolicy,
      rubric_policy_version: resolvedPolicy.policy.version,
      rubric_policy_scope: resolvedPolicy.source,
      rubric_policy_scope_id: resolvedPolicy.policy.scope_id,
      quality_policy_mode: resolvedPolicy.policy.mode,
      require_human_review: resolvedPolicy.policy.require_human_review,
      allow_steward_override: resolvedPolicy.policy.allow_steward_override,
      prompt_hash: sha256(stableJson({
        version: PROMPT_CONTRACT_VERSION,
        evaluatorPromptContract,
        toolContractVersion: TOOL_CONTRACT_VERSION,
        operation,
        instruction: input.instruction?.trim() || null,
      })),
      evaluator_prompt_contract: evaluatorPromptContract,
      tool_contract_version: TOOL_CONTRACT_VERSION,
      template_versions: Object.fromEntries(templates.map((template) => [template.scope, template.version])),
      turn_limit: boundedInteger(input.turnLimit, 100, 1, 200),
      seed,
      instruction: input.instruction?.trim() || null,
    },
    config_version: 1,
    status: "queued",
    trials,
    created_at: new Date().toISOString(),
    created_by: input.createdBy,
  };
  await insertExperiment(experiment);
  const task = driveExperiment(experiment, input.project, bundle, templates, childProjects)
    .finally(() => inflight.delete(task));
  inflight.add(task);
  return experiment;
}

export { aggregateExperiment };
export const __test = { pagesForProject };
