/** Orchestrates isolated, paired TOME model experiments. */

import { randomUUID } from "node:crypto";

import {
  buildIngestRequest,
  type AgentExperimentRunContext,
  type AgentIngestRequest,
} from "@/lib/tome/agent-proxy";
import { resolveAreaChildren, resolveBhagChildren } from "@/lib/tome/bhag";
import { captureEvidenceBundle } from "@/lib/tome/evidence-bundle";
import { resolveExperimentTerminalOutcome } from "@/lib/tome/experiment-outcome";
import {
  QUICK_COST_CEILING_USD,
  QUICK_CANDIDATE_CALL_BUDGET_USD,
  QUICK_EVALUATION_CALL_BUDGET_USD,
  QUICK_MAX_CLAIMS,
  QUICK_REPEAT_COUNT,
  QUICK_REQUEST_TIMEOUT_MS,
  QUICK_TURN_LIMIT,
  evaluationCallBudgetUsd,
  isQuickEvaluation,
  quickRubricPolicy,
} from "@/lib/tome/experiment-mode";
import {
  evaluationPaths,
  normalizeExperimentPageScope,
  pageIsInEvaluationScope,
  scopedRubrics,
} from "@/lib/tome/experiment-page-scope";
import {
  createExperimentArtifact,
  claimExperimentFileRetry,
  finalizeExperimentArtifact,
  getEvidenceBundle,
  getExperiment,
  insertExperiment,
  listArtifactEvaluations,
  listArtifactFileEvaluations,
  listExperimentArtifacts,
  requestExperimentCancellation,
  resolveQualityPolicy,
  sha256,
  stableJson,
  upsertArtifactEvaluation,
  upsertArtifactFileEvaluation,
  updateExperiment,
} from "@/lib/tome/evaluation-store";
import {
  assertEvaluationRequestFits,
  abortSignalWithTimeout,
  EvaluationBudget,
  evidenceForFile,
  evaluationChunkCharacterLimit,
  isEvaluatorBudgetFailure,
  isEvaluatorCapacityFailure,
  isTransientEvaluatorFailure,
  isTransientPersistenceFailure,
  mapWithConcurrency,
  normalizeEvaluationResponse,
  pageChunkCharacterLimit,
  retryWithBackoff,
  splitMarkdown,
  splitMarkdownChunk,
  type MarkdownChunk,
} from "@/lib/tome/file-evaluation";
import {
  blindAssignments,
  candidateOrder,
  costCeilingReached,
  deterministicUuid,
} from "@/lib/tome/experiment-planning";
import { testTomeModel } from "@/lib/tome/model-check";
import { modelProfile, upperBoundEvaluatorError } from "@/lib/tome/model-catalog";
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
  ArtifactFileEvaluation,
  EvidenceBundle,
  EvaluatorPromptContract,
  ExperimentEvaluationMode,
  ExperimentArtifact,
  ExperimentOperation,
  ExperimentPageScope,
  ExperimentTrial,
  RubricPolicy,
  TomeExperiment,
} from "@/types/tome-evaluation";
import { TOME_RUBRIC_IDS } from "@/types/tome-evaluation";

const inflight = new Set<Promise<void>>();
const activeControllers = new Map<string, AbortController>();
const PROMPT_CONTRACT_VERSION = "tome-grounded-experiment-v1";
const TOOL_CONTRACT_VERSION = "tome-offline-evidence-tools-v1";
const DEFAULT_EVALUATION_CONCURRENCY = 3;
const DEFAULT_EVALUATION_RETRY_LIMIT = 3;
const DEFAULT_EVALUATION_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_EVALUATION_CALL_BUDGET_USD = 2;
const DEFAULT_PERSISTENCE_RETRY_LIMIT = 4;
const MAX_ADAPTIVE_CHUNK_DEPTH = 3;

async function persistWithBackoff<T>(action: () => Promise<T>): Promise<T> {
  const result = await retryWithBackoff({
    attempts: DEFAULT_PERSISTENCE_RETRY_LIMIT,
    action: () => action(),
    shouldRetry: isTransientPersistenceFailure,
  });
  return result.value;
}

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
  evaluationPageScope?: ExperimentPageScope;
  evaluationMode?: ExperimentEvaluationMode;
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

async function loadEvaluatorPromptContract(
  mode: ExperimentEvaluationMode,
): Promise<EvaluatorPromptContract | undefined> {
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) return undefined;
  try {
    const response = await fetch(
      `${agentUrl.replace(/\/$/, "")}/evaluate/prompt?mode=${mode === "quick" ? "quick" : "deep"}`,
    );
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
    evaluation_mode: experiment.config.evaluation_mode ?? "deep",
    evaluation_page_paths: experiment.config.evaluation_page_scope?.paths ?? [],
    max_budget_usd: isQuickEvaluation(experiment.config)
      ? QUICK_CANDIDATE_CALL_BUDGET_USD
      : undefined,
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
  const quick = isQuickEvaluation(experiment.config);
  const quickPaths = experiment.config.evaluation_page_scope?.paths ?? [];
  const quickInstruction = quick
    ? [
        `QUICK PAGE EVALUATION: update only ${quickPaths.map((path) => `\`${path}\``).join(", ")}.`,
        "Read those pages and only the frozen evidence needed for those edits.",
        "Do not edit any other page. Stop immediately after the selected pages are updated.",
        experiment.config.instruction?.trim() || "",
      ].filter(Boolean).join(" ")
    : experiment.config.instruction ?? null;
  const request = buildIngestRequest(project, {
    runId: trial.run_identity,
    reportId: trial.run_identity,
    seed: quickInstruction,
    isGreenfield: Object.keys(pagesForProject(bundle, project._id)).length === 0,
    mode: quick ? "quick" : "full",
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

function mergeSignals(values: EvaluatorSignals[]): EvaluatorSignals {
  const merged: EvaluatorSignals = {};
  for (const signals of values) {
    for (const [name, signal] of Object.entries(signals) as Array<[
      keyof EvaluatorSignals,
      NonNullable<EvaluatorSignals[keyof EvaluatorSignals]>,
    ]>) {
      const current = merged[name] ?? { passed: 0, total: 0, findings: [] };
      merged[name] = {
        passed: current.passed + signal.passed,
        total: current.total + signal.total,
        findings: [...new Set([...(current.findings ?? []), ...(signal.findings ?? [])])],
      };
    }
  }
  return merged;
}

function fileCheckpointId(artifactId: string, path: string): string {
  return `${artifactId}:${sha256(path).slice(0, 20)}`;
}

function evaluatorRequestBody(input: {
  experiment: TomeExperiment;
  artifact: ExperimentArtifact;
  bundle: EvidenceBundle;
  path: string;
  markdown: string;
  requiredTemplatePaths: string[];
  baselinePages: Record<string, string>;
  maxCostUsd?: number;
}) {
  const evaluatorProfile = input.experiment.config.evaluator_model_profile
    ?? modelProfile(input.experiment.config.evaluator_model);
  if (!evaluatorProfile) throw new Error("Evaluator capacity profile is unavailable.");
  return {
    blind_label: input.artifact.blind_label,
    evaluator_model: input.experiment.config.evaluator_model,
    evaluator_profile: {
      model_id: evaluatorProfile.id,
      profile_version: evaluatorProfile.profile_version,
      capability_rank: evaluatorProfile.capability_rank,
      context_window_tokens: evaluatorProfile.context_window_tokens,
      max_output_tokens: evaluatorProfile.max_output_tokens,
      supports_structured_output: evaluatorProfile.supports_structured_output,
    },
    evaluator_prompt_version: input.experiment.config.evaluator_prompt_contract?.version,
    evaluation_mode: isQuickEvaluation(input.experiment.config) ? "quick" : "deep",
    ...(isQuickEvaluation(input.experiment.config)
      ? { max_claims: input.experiment.config.quick_max_claims ?? QUICK_MAX_CLAIMS }
      : {}),
    entity_type: input.experiment.config.entity_type,
    candidate_pages: { [input.path]: input.markdown },
    evidence: evidenceForFile(input.bundle.items, input.path, input.markdown, {
      // Quick mode computes template compliance deterministically. Sending every
      // unrelated template and seed adds cost without improving the four core
      // quick-eval checks.
      includeUnreferencedScaffolding: !isQuickEvaluation(input.experiment.config),
    }).map((item) => ({
      id: item.id,
      canonical_uri: item.canonical_uri,
      content_hash: item.content_hash,
      content: item.content,
    })),
    required_template_paths: input.requiredTemplatePaths.includes(input.path) ? [input.path] : [],
    live_stable_pages: input.path in input.baselinePages
      ? { [input.path]: input.baselinePages[input.path] }
      : {},
    ...(input.maxCostUsd ? { max_cost_usd: input.maxCostUsd } : {}),
  };
}

async function evaluateFile(input: {
  experiment: TomeExperiment;
  artifact: ExperimentArtifact;
  page: ExperimentArtifact["pages"][number];
  bundle: EvidenceBundle;
  requiredTemplatePaths: string[];
  baselinePages: Record<string, string>;
  existing?: ArtifactFileEvaluation;
  budget?: EvaluationBudget;
  signal?: AbortSignal;
}): Promise<ArtifactFileEvaluation> {
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) throw new Error("TOME_AGENT_URL not configured");
  const profile = input.experiment.config.evaluator_model_profile
    ?? modelProfile(input.experiment.config.evaluator_model);
  if (!profile) throw new Error("Evaluator capacity profile is unavailable.");
  const baseRequest = evaluatorRequestBody({
    ...input,
    path: input.page.path,
    markdown: "",
  });
  const chunks = splitMarkdown(
    input.page.markdown,
    Math.min(
      pageChunkCharacterLimit(profile),
      evaluationChunkCharacterLimit(baseRequest, profile),
    ),
  );
  const now = new Date().toISOString();
  const canResume = input.existing?.content_hash === input.page.content_hash
    && input.existing.completed_chunks > 0
    && input.existing.completed_chunks < chunks.length;
  const checkpoint: ArtifactFileEvaluation = canResume ? {
    ...input.existing!,
    status: "running",
    error: undefined,
    retryable: undefined,
    updated_at: now,
  } : {
    _id: fileCheckpointId(input.artifact._id, input.page.path),
    experiment_id: input.experiment._id,
    artifact_id: input.artifact._id,
    blind_label: input.artifact.blind_label,
    path: input.page.path,
    content_hash: input.page.content_hash,
    status: "running",
    claims: [],
    signals: {},
    chunk_count: chunks.length,
    completed_chunks: 0,
    attempts: 0,
    evaluation_tokens: { input: 0, output: 0 },
    evaluation_turns: 0,
    evaluation_latency_ms: 0,
    evaluation_cost_usd: 0,
    evaluation_budget_usd: 0,
    started_at: now,
    updated_at: now,
  };
  await persistWithBackoff(() => upsertArtifactFileEvaluation(checkpoint));
  const started = Date.now();
  let budgetConsumed = 0;
  let attemptsConsumed = 0;
  const timeoutMs = input.experiment.config.evaluation_request_timeout_ms
    ?? DEFAULT_EVALUATION_REQUEST_TIMEOUT_MS;
  const callBudgetUsd = evaluationCallBudgetUsd(
    input.experiment.config,
    DEFAULT_EVALUATION_CALL_BUDGET_USD,
  );

  const evaluateChunk = async (
    chunk: MarkdownChunk,
    depth = 0,
  ): Promise<{ responses: ReturnType<typeof normalizeEvaluationResponse>[]; attempts: number }> => {
    try {
      const retried = await retryWithBackoff({
        attempts: input.experiment.config.evaluation_retry_limit ?? DEFAULT_EVALUATION_RETRY_LIMIT,
        signal: input.signal,
        shouldRetry: (error) => !isEvaluatorCapacityFailure(error)
          && !isEvaluatorBudgetFailure(error)
          && isTransientEvaluatorFailure(error),
        action: async () => {
          const lease = input.budget
            ? await input.budget.reserveWhenAvailable(callBudgetUsd, input.signal)
            : undefined;
          if (input.budget && !lease) {
            throw new Error("Evaluation cost ceiling reached before starting this file.");
          }
          attemptsConsumed += 1;
          let leaseSettled = false;
          try {
            const body = evaluatorRequestBody({
              ...input,
              path: input.page.path,
              markdown: chunk.markdown,
              maxCostUsd: lease?.limitUsd,
            });
            assertEvaluationRequestFits(body, profile);
            const response = await fetch(`${agentUrl.replace(/\/$/, "")}/evaluate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: abortSignalWithTimeout(input.signal, timeoutMs),
              body: JSON.stringify(body),
            });
            if (!response.ok) {
              throw new Error(
                `Evaluator failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
              );
            }
            const normalized = normalizeEvaluationResponse(
              await response.json(),
              input.page.path,
              chunk,
            );
            if (lease) {
              budgetConsumed += lease.settle(normalized.costUsd);
              leaseSettled = true;
            }
            attemptsConsumed += normalized.attempts - 1;
            return normalized;
          } catch (error) {
            if (lease && !leaseSettled) budgetConsumed += lease.settle();
            throw error;
          }
        },
      });
      return {
        responses: [retried.value],
        attempts: retried.attempts + retried.value.attempts - 1,
      };
    } catch (error) {
      if (isQuickEvaluation(input.experiment.config)
        || !isEvaluatorCapacityFailure(error)
        || depth >= MAX_ADAPTIVE_CHUNK_DEPTH
        || chunk.markdown.length <= 1_000) {
        throw error;
      }
      const children = splitMarkdownChunk(chunk);
      if (children.length < 2) throw error;
      const results: ReturnType<typeof normalizeEvaluationResponse>[] = [];
      let attempts = 1;
      for (const child of children) {
        const evaluated = await evaluateChunk(child, depth + 1);
        results.push(...evaluated.responses);
        attempts += evaluated.attempts;
      }
      return { responses: results, attempts };
    }
  };
  try {
    for (const chunk of chunks.slice(checkpoint.completed_chunks)) {
      const evaluated = await evaluateChunk(chunk);
      const normalized = evaluated.responses;
      checkpoint.claims.push(...normalized.flatMap((value) => value.claims));
      checkpoint.signals = mergeSignals([
        checkpoint.signals as EvaluatorSignals,
        ...normalized.map((value) => value.signals),
      ]);
      checkpoint.completed_chunks += 1;
      checkpoint.attempts = (input.existing?.attempts ?? 0) + attemptsConsumed;
      checkpoint.evaluation_tokens = {
        input: (checkpoint.evaluation_tokens?.input ?? 0)
          + normalized.reduce((sum, value) => sum + value.tokens.input, 0),
        output: (checkpoint.evaluation_tokens?.output ?? 0)
          + normalized.reduce((sum, value) => sum + value.tokens.output, 0),
      };
      checkpoint.evaluation_turns = (checkpoint.evaluation_turns ?? 0)
        + normalized.reduce((sum, value) => sum + value.turns, 0);
      checkpoint.evaluation_cost_usd = (checkpoint.evaluation_cost_usd ?? 0)
        + normalized.reduce((sum, value) => sum + (value.costUsd ?? 0), 0);
      checkpoint.evaluation_budget_usd = (input.existing?.evaluation_budget_usd ?? 0)
        + budgetConsumed;
      checkpoint.evaluation_latency_ms = Date.now() - started
        + (canResume ? input.existing?.evaluation_latency_ms ?? 0 : 0);
      checkpoint.updated_at = new Date().toISOString();
      await persistWithBackoff(() => upsertArtifactFileEvaluation(checkpoint));
    }
    checkpoint.status = "succeeded";
    checkpoint.completed_at = new Date().toISOString();
    checkpoint.updated_at = checkpoint.completed_at;
    await persistWithBackoff(() => upsertArtifactFileEvaluation(checkpoint));
    return checkpoint;
  } catch (error) {
    checkpoint.attempts = (input.existing?.attempts ?? 0) + attemptsConsumed;
    checkpoint.status = "error";
    checkpoint.error = String((error as Error)?.message ?? error);
    checkpoint.retryable = (isQuickEvaluation(input.experiment.config)
      && isEvaluatorBudgetFailure(error))
      || (!isEvaluatorBudgetFailure(error) && (isTransientEvaluatorFailure(error)
        || checkpoint.error.includes("upper bound")
        || checkpoint.error.includes("batch budget")
        || checkpoint.error.includes("error_max_turns")));
    checkpoint.evaluation_budget_usd = (input.existing?.evaluation_budget_usd ?? 0)
      + budgetConsumed;
    checkpoint.evaluation_latency_ms = Date.now() - started
      + (canResume ? input.existing?.evaluation_latency_ms ?? 0 : 0);
    checkpoint.updated_at = new Date().toISOString();
    await persistWithBackoff(() => upsertArtifactFileEvaluation(checkpoint));
    return checkpoint;
  }
}

async function evaluateArtifact(
  experiment: TomeExperiment,
  artifact: ExperimentArtifact,
  trial: ExperimentTrial,
  bundle: EvidenceBundle,
  requiredTemplatePaths: string[],
  requiredTemplates: Array<{ path: string; kind: string; body?: string }>,
  baselinePages: Record<string, string>,
  budget?: EvaluationBudget,
  signal?: AbortSignal,
  pagePaths?: ReadonlySet<string>,
  expectedPagePaths?: ReadonlySet<string>,
): Promise<ArtifactEvaluation> {
  const started = Date.now();
  const evaluatorEligibilityError = upperBoundEvaluatorError(
    experiment.config.model_a,
    experiment.config.model_b,
    experiment.config.evaluator_model,
  );
  if (evaluatorEligibilityError) throw new Error(evaluatorEligibilityError);
  const priorFiles = await listArtifactFileEvaluations(experiment._id, artifact._id);
  const priorByPath = new Map(priorFiles.map((file) => [file.path, file]));
  const scopedPages = artifact.pages.filter((page) =>
    !expectedPagePaths || expectedPagePaths.has(page.path));
  await mapWithConcurrency(
    scopedPages.filter((page) => {
      if (pagePaths && !pagePaths.has(page.path)) return false;
      const existing = priorByPath.get(page.path);
      return existing?.status !== "succeeded" || existing.content_hash !== page.content_hash;
    }),
    experiment.config.evaluation_concurrency ?? DEFAULT_EVALUATION_CONCURRENCY,
    (page) => evaluateFile({
      experiment,
      artifact,
      page,
      bundle,
      requiredTemplatePaths,
      baselinePages,
      existing: priorByPath.get(page.path),
      budget,
      signal,
    }),
  );
  const currentFiles = (await listArtifactFileEvaluations(experiment._id, artifact._id))
    .filter((file) => (!expectedPagePaths || expectedPagePaths.has(file.path))
      && artifact.pages.some((page) =>
        page.path === file.path && page.content_hash === file.content_hash));
  const successfulFiles = currentFiles.filter((file) => file.status === "succeeded");
  const failedFiles = currentFiles.filter((file) => file.status === "error");
  const claims = successfulFiles.flatMap((file) => file.claims);
  const signals = mergeSignals(successfulFiles.map((file) => file.signals as EvaluatorSignals));
  const evaluationCost = currentFiles.reduce(
    (sum, file) => sum + (file.evaluation_cost_usd ?? 0),
    0,
  );
  const evaluationBudget = currentFiles.reduce(
    (sum, file) => sum + (file.evaluation_budget_usd ?? file.evaluation_cost_usd ?? 0),
    0,
  );
  const candidatePages = Object.fromEntries(scopedPages.map((page) => [page.path, page.markdown]));
  const scopedRequiredTemplatePaths = requiredTemplatePaths.filter((path) => path in candidatePages);
  const scopedLiveStablePages = Object.fromEntries(
    Object.entries(stablePages(baselinePages)).filter(([path]) => path in candidatePages),
  );
  const rubrics = scopedRubrics(
    calculateRubrics(experiment.config.rubric_policy, {
      claims,
      candidatePages,
      evidencePagePaths: bundle.items.flatMap((item) => item.page_path ? [item.page_path] : []),
      evidenceItems: bundle.items,
      requiredTemplatePaths: scopedRequiredTemplatePaths,
      requiredTemplates,
      liveStablePages: scopedLiveStablePages,
      signals,
      generationCostUsd: trial?.cost_usd,
      evaluationCostUsd: evaluationCost,
      generationLatencyMs: trial?.generation_latency_ms,
      evaluationLatencyMs: Date.now() - started,
    }),
    experiment.config,
  );
  const blocking = rubrics
    .filter((rubric) => rubric.enabled && rubric.blocking && rubric.passed !== true)
    .flatMap((rubric) => [rubric.id, ...rubric.findings]);
  const expectedPaths = expectedPagePaths ?? new Set(scopedPages.map((page) => page.path));
  const producedPaths = new Set(artifact.pages.map((page) => page.path));
  const successfulPaths = new Set(successfulFiles.map((file) => file.path));
  const missingPaths = [...expectedPaths].filter((path) => !producedPaths.has(path));
  const failedPaths = [...new Set([...failedFiles.map((file) => file.path), ...missingPaths])];
  const incompletePaths = [...expectedPaths].filter((path) => !successfulPaths.has(path));
  if (incompletePaths.length) {
    blocking.unshift(
      `${incompletePaths.length} of ${expectedPaths.size} file evaluations are incomplete.`,
    );
    if (missingPaths.length) {
      blocking.unshift(`Selected page(s) not produced by this candidate: ${missingPaths.join(", ")}`);
    }
  }
  const existingEvaluation = (await listArtifactEvaluations(experiment._id))
    .find((evaluation) => evaluation.artifact_id === artifact._id);
  const status = successfulFiles.length === 0
    ? "error"
    : incompletePaths.length > 0
      ? "partial"
      : blocking.length === 0
        ? "passed"
        : "failed";
  return {
    _id: existingEvaluation?._id ?? randomUUID(),
    experiment_id: experiment._id,
    artifact_id: artifact._id,
    blind_label: artifact.blind_label,
    evaluator_model: experiment.config.evaluator_model,
    evaluator_is_candidate: [experiment.config.model_a, experiment.config.model_b]
      .includes(experiment.config.evaluator_model),
    status,
    claims,
    rubrics,
    blocking_findings: blocking,
    evaluation_tokens: currentFiles.reduce((tokens, file) => ({
      input: tokens.input + (file.evaluation_tokens?.input ?? 0),
      output: tokens.output + (file.evaluation_tokens?.output ?? 0),
    }), { input: 0, output: 0 }),
    evaluation_turns: currentFiles.reduce((sum, file) => sum + (file.evaluation_turns ?? 0), 0),
    evaluation_latency_ms: currentFiles.reduce(
      (sum, file) => sum + (file.evaluation_latency_ms ?? 0),
      0,
    ),
    evaluation_cost_usd: evaluationCost,
    evaluation_budget_usd: evaluationBudget,
    evaluation_batches: currentFiles.reduce((sum, file) => sum + file.chunk_count, 0),
    evaluation_attempts: currentFiles.reduce((sum, file) => sum + file.attempts, 0),
    evaluated_files: successfulFiles.length,
    total_files: expectedPaths.size,
    failed_files: failedPaths,
    created_at: existingEvaluation?.created_at ?? new Date().toISOString(),
    ...(incompletePaths.length
      ? { error: [
          `${incompletePaths.length} file evaluation(s) incomplete; successful file results were preserved.`,
          ...failedFiles.map((file) => `${file.path}: ${file.error ?? "unknown evaluator error"}`),
        ].join(" ") }
      : {}),
  };
}

async function evaluateArtifactPair(input: {
  experiment: TomeExperiment;
  artifacts: Array<{ artifact: ExperimentArtifact; trial: ExperimentTrial }>;
  bundle: EvidenceBundle;
  requiredTemplatePaths: string[];
  requiredTemplates: Array<{ path: string; kind: string; body?: string }>;
  baselinePages: Record<string, string>;
  budget: EvaluationBudget;
  signal?: AbortSignal;
}): Promise<{ evaluations: ArtifactEvaluation[]; budgetStopped: boolean }> {
  const callBudget = evaluationCallBudgetUsd(
    input.experiment.config,
    DEFAULT_EVALUATION_CALL_BUDGET_USD,
  );
  const paths = evaluationPaths(
    input.experiment.config,
    input.artifacts.map(({ artifact }) => artifact),
  );
  const expectedPaths = new Set(paths);
  const latest = new Map<string, ArtifactEvaluation>();
  for (const path of paths) {
    input.signal?.throwIfAborted();
    const evaluable = input.artifacts.filter(({ artifact }) =>
      artifact.pages.some((page) => page.path === path));
    // Reserve enough room for both candidates before starting either side of
    // the pair. This preserves comparable evidence at a budget boundary.
    if (input.budget.availableUsd < callBudget * evaluable.length) {
      return { evaluations: [...latest.values()], budgetStopped: true };
    }
    const evaluations = await Promise.all(input.artifacts.map(({ artifact, trial }) =>
      evaluateArtifact(
        input.experiment,
        artifact,
        trial,
        input.bundle,
        input.requiredTemplatePaths,
        input.requiredTemplates,
        input.baselinePages,
        input.budget,
        input.signal,
        new Set([path]),
        expectedPaths,
      )));
    for (const evaluation of evaluations) {
      latest.set(evaluation.artifact_id, evaluation);
      await persistWithBackoff(() => upsertArtifactEvaluation(evaluation));
    }
  }
  return { evaluations: [...latest.values()], budgetStopped: false };
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
  let evaluationAttempts = 0;
  let evaluationSuccesses = 0;
  let evaluationFailures = 0;
  try {
    await persistWithBackoff(() => updateExperiment(experiment._id, {
      status: "running",
      started_at: new Date().toISOString(),
    }));
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
        await persistWithBackoff(() => updateExperiment(experiment._id, { trials }));
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
        await persistWithBackoff(() => updateExperiment(experiment._id, { trials }));
        if (stoppedByUser) break;
      }

      if (stoppedByUser) break;
      await persistWithBackoff(() => updateExperiment(
        experiment._id,
        { status: "evaluating", trials },
      ));
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
      const evaluationBudget = new EvaluationBudget(
        experiment.config.cost_ceiling_usd,
        totalCost,
      );
      const pairedArtifacts = artifacts.flatMap((artifact) => {
        const trial = trials.find((value) => value.artifact_id === artifact._id);
        return trial?.status === "succeeded" ? [{ artifact, trial }] : [];
      });
      evaluationAttempts += pairedArtifacts.length;
      if (pairedArtifacts.length > 0) {
        try {
          const pairedResult = await withExperimentAbort(
            experiment._id,
            (signal) => evaluateArtifactPair({
              experiment,
              artifacts: pairedArtifacts,
              bundle,
              requiredTemplatePaths: requiredPaths,
              requiredTemplates,
              baselinePages: pagesForProject(bundle, project._id),
              budget: evaluationBudget,
              signal,
            }),
          );
          totalCost = evaluationBudget.spentUsd;
          stopped = pairedResult.budgetStopped;
          for (const evaluation of pairedResult.evaluations) {
            if (evaluation.status === "error") {
              evaluationFailures += 1;
            } else {
              evaluationSuccesses += 1;
              if (evaluation.status === "partial") evaluationFailures += 1;
            }
          }
        } catch (error) {
          if (await cancellationRequested(experiment._id)) {
            stoppedByUser = true;
          } else {
            for (const { artifact } of pairedArtifacts) {
              await persistWithBackoff(() => upsertArtifactEvaluation({
                _id: randomUUID(),
                experiment_id: experiment._id,
                artifact_id: artifact._id,
                blind_label: artifact.blind_label,
                evaluator_model: experiment.config.evaluator_model,
                evaluator_is_candidate: [experiment.config.model_a, experiment.config.model_b]
                  .includes(experiment.config.evaluator_model),
                status: "error",
                claims: [],
                rubrics: scopedRubrics(
                  calculateRubrics(experiment.config.rubric_policy, {
                    claims: [],
                    candidatePages: Object.fromEntries(
                      artifact.pages
                        .filter((page) => pageIsInEvaluationScope(experiment.config, page.path))
                        .map((page) => [page.path, page.markdown]),
                    ),
                    evidencePagePaths: bundle.items.flatMap(
                      (item) => item.page_path ? [item.page_path] : [],
                    ),
                    evidenceItems: bundle.items,
                    requiredTemplatePaths: requiredPaths,
                    requiredTemplates,
                  }),
                  experiment.config,
                ),
                blocking_findings: [String((error as Error)?.message ?? error)],
                created_at: new Date().toISOString(),
                error: String((error as Error)?.message ?? error),
              }));
            }
            evaluationFailures += pairedArtifacts.length;
          }
        }
      }
      if (stoppedByUser) break;
      if (stopped) break;
      await persistWithBackoff(() => updateExperiment(
        experiment._id,
        { status: "running", trials },
      ));
    }
    if (stopped || stoppedByUser) {
      for (const trial of trials) {
        if (["queued", "running"].includes(trial.status)) trial.status = "not_started";
      }
    }
    const generationFailures = trials.filter((trial) => trial.status === "failed").length;
    const successfulGenerations = trials.filter((trial) => trial.status === "succeeded").length;
    const outcome = resolveExperimentTerminalOutcome({
      stoppedByUser,
      stoppedAtCostCeiling: stopped,
      totalGenerations: trials.length,
      successfulGenerations,
      generationFailures,
      evaluationAttempts,
      evaluationSuccesses,
      evaluationFailures,
    });
    await persistWithBackoff(() => updateExperiment(experiment._id, {
      status: outcome.status,
      trials,
      finished_at: new Date().toISOString(),
      ...(outcome.error ? { error: outcome.error } : {}),
    }));
  } catch (error) {
    const cancelled = await cancellationRequested(experiment._id);
    await persistWithBackoff(() => updateExperiment(experiment._id, cancelled ? {
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
    }));
  }
}

async function driveFailedFileRetry(
  experiment: TomeExperiment,
  bundle: EvidenceBundle,
): Promise<void> {
  try {
    const templates = await getAllPageTemplates();
    const requiredPaths = templates
      .find((template) => template.scope === "top-level")?.pages
      .filter((page) => page.enabled !== false)
      .map((page) => page.path) ?? [];
    const requiredTemplates = templates
      .find((template) => template.scope === "top-level")?.pages
      .filter((page) => page.enabled !== false) ?? [];
    const artifacts = await listExperimentArtifacts(experiment._id);
    const checkpoints = await listArtifactFileEvaluations(experiment._id);
    const recordedBudget = experiment.trials.reduce(
      (sum, trial) => sum + (trial.cost_usd ?? 0),
      0,
    ) + checkpoints.reduce(
      (sum, checkpoint) => sum
        + (checkpoint.evaluation_budget_usd ?? checkpoint.evaluation_cost_usd ?? 0),
      0,
    );
    const evaluationBudget = new EvaluationBudget(
      experiment.config.cost_ceiling_usd,
      recordedBudget,
    );
    const checkpointByFile = new Map(checkpoints.map((checkpoint) => [
      `${checkpoint.artifact_id}:${checkpoint.path}`,
      checkpoint,
    ]));
    const retryArtifactIds = new Set(artifacts
      .filter((artifact) => artifact.pages.some((page) => {
        if (!pageIsInEvaluationScope(experiment.config, page.path)) return false;
        const checkpoint = checkpointByFile.get(`${artifact._id}:${page.path}`);
        return checkpoint?.status !== "succeeded"
          || checkpoint.content_hash !== page.content_hash;
      }))
      .map((artifact) => artifact._id));
    for (const artifact of artifacts.filter((value) => retryArtifactIds.has(value._id))) {
      if (await cancellationRequested(experiment._id)) break;
      const trial = experiment.trials.find((value) => value.artifact_id === artifact._id);
      if (!trial || trial.status !== "succeeded") continue;
      const evaluation = await withExperimentAbort(experiment._id, (signal) => {
        const trialArtifacts = artifacts.filter((candidate) => candidate.trial === artifact.trial);
        const scopedPaths = new Set(evaluationPaths(experiment.config, trialArtifacts));
        return evaluateArtifact(
          experiment,
          artifact,
          trial,
          bundle,
          requiredPaths,
          requiredTemplates,
          pagesForProject(bundle, experiment.project_id),
          evaluationBudget,
          signal,
          scopedPaths,
          scopedPaths,
        );
      });
      await persistWithBackoff(() => upsertArtifactEvaluation(evaluation));
    }
    if (await cancellationRequested(experiment._id)) {
      await persistWithBackoff(() => updateExperiment(experiment._id, {
        status: "stopped_by_user",
        finished_at: new Date().toISOString(),
      }));
      return;
    }
    const evaluations = await listArtifactEvaluations(experiment._id);
    const attempted = evaluations.length;
    const successes = evaluations.filter((evaluation) => evaluation.status !== "error").length;
    const failures = evaluations.filter((evaluation) =>
      evaluation.status === "error" || evaluation.status === "partial").length;
    const outcome = resolveExperimentTerminalOutcome({
      stoppedByUser: false,
      stoppedAtCostCeiling: false,
      totalGenerations: experiment.trials.length,
      successfulGenerations: experiment.trials.filter((trial) => trial.status === "succeeded").length,
      generationFailures: experiment.trials.filter((trial) => trial.status === "failed").length,
      evaluationAttempts: attempted,
      evaluationSuccesses: successes,
      evaluationFailures: failures,
    });
    await persistWithBackoff(() => updateExperiment(experiment._id, {
      status: outcome.status,
      finished_at: new Date().toISOString(),
      ...(outcome.error ? { error: outcome.error } : {}),
    }));
  } catch (error) {
    await persistWithBackoff(() => updateExperiment(experiment._id, {
      status: "failed",
      error: String((error as Error)?.message ?? error),
      finished_at: new Date().toISOString(),
    }));
  }
}

export async function retryFailedExperimentFiles(input: {
  experimentId: string;
  actor: string;
}): Promise<TomeExperiment> {
  const [experiment, checkpoints, artifacts] = await Promise.all([
    getExperiment(input.experimentId),
    listArtifactFileEvaluations(input.experimentId),
    listExperimentArtifacts(input.experimentId),
  ]);
  if (!experiment) throw new Error("Experiment not found.");
  const checkpointByFile = new Map(checkpoints.map((checkpoint) => [
    `${checkpoint.artifact_id}:${checkpoint.path}`,
    checkpoint,
  ]));
  const hasIncompleteFiles = artifacts.some((artifact) => artifact.pages.some((page) => {
    if (!pageIsInEvaluationScope(experiment.config, page.path)) return false;
    const checkpoint = checkpointByFile.get(`${artifact._id}:${page.path}`);
    return checkpoint?.status !== "succeeded" || checkpoint.content_hash !== page.content_hash;
  }));
  if (!hasIncompleteFiles) {
    throw new Error("This experiment has no incomplete files to retry.");
  }
  const recordedCost = experiment.trials.reduce(
    (sum, trial) => sum + (trial.cost_usd ?? 0),
    0,
  ) + checkpoints.reduce(
    (sum, checkpoint) => sum
      + (checkpoint.evaluation_budget_usd ?? checkpoint.evaluation_cost_usd ?? 0),
    0,
  );
  if (costCeilingReached(recordedCost, experiment.config.cost_ceiling_usd)) {
    throw new Error("The experiment cost ceiling has been reached; increase it before retrying.");
  }
  const bundle = await getEvidenceBundle(experiment.evidence_bundle_id);
  if (!bundle) throw new Error("Frozen evidence bundle not found.");
  if (!(await claimExperimentFileRetry({ id: experiment._id, actor: input.actor }))) {
    throw new Error("The experiment is active or no longer retryable.");
  }
  const retrying = { ...experiment, status: "evaluating" as const };
  const task = driveFailedFileRetry(retrying, bundle).finally(() => inflight.delete(task));
  inflight.add(task);
  return retrying;
}

export async function startExperiment(input: StartExperimentInput): Promise<TomeExperiment> {
  const modelA = input.modelA.trim();
  const modelB = input.modelB.trim();
  const evaluatorModel = input.evaluatorModel.trim();
  if (!modelA || !modelB || !evaluatorModel) throw new Error("All three model ids are required.");
  if (modelA === modelB) throw new Error("Model A and Model B must be different.");
  const evaluatorEligibilityError = upperBoundEvaluatorError(modelA, modelB, evaluatorModel);
  if (evaluatorEligibilityError) throw new Error(evaluatorEligibilityError);
  const evaluatorProfile = modelProfile(evaluatorModel);
  if (!evaluatorProfile) throw new Error("Evaluator capacity profile is unavailable.");
  await requireSmokeTests([modelA, modelB, evaluatorModel]);

  const evaluationMode = input.evaluationMode
    ?? (input.evaluationPageScope?.mode === "selected" ? "deep" : "all_pages");
  if (!(["quick", "deep", "all_pages"] as const).includes(evaluationMode)) {
    throw new Error("Evaluation mode must be quick, deep, or all_pages.");
  }
  if (evaluationMode === "all_pages" && input.evaluationPageScope?.mode === "selected") {
    throw new Error("All-pages audits cannot use a selected-page scope.");
  }
  if (evaluationMode !== "all_pages" && input.evaluationPageScope?.mode !== "selected") {
    throw new Error("Quick evaluations and deep audits require selected pages.");
  }

  const childProjects = await childrenFor(input.project);
  const [templates, resolvedPolicy, evaluatorPromptContract] = await Promise.all([
    getAllPageTemplates(),
    resolveQualityPolicy({
      entityId: input.project._id,
      entityType: input.project.type ?? "project",
    }),
    loadEvaluatorPromptContract(evaluationMode),
  ]);
  if (evaluationMode === "quick" && !evaluatorPromptContract) {
    throw new Error("Quick evaluator prompt contract is unavailable; try again when the TOME agent is healthy.");
  }
  const bundle = await captureEvidenceBundle({
    project: input.project,
    childProjects,
    createdBy: input.createdBy,
    seed: input.instruction,
  });
  const availablePaths = new Set([
    ...Object.keys(pagesForProject(bundle, input.project._id)),
    ...(templates.find((template) => template.scope === "top-level")?.pages
      .filter((page) => page.enabled !== false)
      .map((page) => page.path) ?? []),
  ]);
  const evaluationPageScope = normalizeExperimentPageScope(
    evaluationMode === "all_pages"
      ? { mode: "all", paths: [] }
      : input.evaluationPageScope,
    availablePaths,
  );
  const id = randomUUID();
  const repeatCount = evaluationMode === "quick"
    ? QUICK_REPEAT_COUNT
    : boundedInteger(input.repeatCount, evaluationMode === "all_pages" ? 1 : 3, 1, 10);
  const seed = boundedInteger(input.seed, 1, 0, 2_147_483_647);
  const configuredRubricPolicy = Object.fromEntries(TOME_RUBRIC_IDS.map((rubricId) => {
    const override = input.rubricPolicy?.[rubricId];
    return [rubricId, {
      ...resolvedPolicy.policy.rubrics[rubricId],
      ...(override && typeof override === "object" ? override : {}),
    }];
  })) as RubricPolicy;
  const rubricPolicy = evaluationMode === "quick"
    ? quickRubricPolicy(configuredRubricPolicy)
    : configuredRubricPolicy;
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
      evaluator_model_profile: evaluatorProfile,
      operation,
      entity_type: input.project.type ?? "project",
      entity_id: input.project._id,
      repeat_count: repeatCount,
      cost_ceiling_usd: evaluationMode === "quick"
        ? Math.min(
            QUICK_COST_CEILING_USD,
            Math.max(0.01, input.costCeilingUsd ?? QUICK_COST_CEILING_USD),
          )
        : Math.max(0.01, input.costCeilingUsd ?? 25),
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
        evaluatorProfile,
        toolContractVersion: TOOL_CONTRACT_VERSION,
        operation,
        instruction: input.instruction?.trim() || null,
        evaluationMode,
        evaluationPageScope,
      })),
      evaluator_prompt_contract: evaluatorPromptContract,
      tool_contract_version: TOOL_CONTRACT_VERSION,
      template_versions: Object.fromEntries(templates.map((template) => [template.scope, template.version])),
      turn_limit: evaluationMode === "quick"
        ? Math.min(QUICK_TURN_LIMIT, boundedInteger(input.turnLimit, QUICK_TURN_LIMIT, 1, 200))
        : boundedInteger(input.turnLimit, 100, 1, 200),
      seed,
      instruction: input.instruction?.trim() || null,
      evaluation_concurrency: evaluationMode === "quick" ? 2 : DEFAULT_EVALUATION_CONCURRENCY,
      evaluation_retry_limit: evaluationMode === "quick" ? 2 : DEFAULT_EVALUATION_RETRY_LIMIT,
      evaluation_request_timeout_ms: evaluationMode === "quick"
        ? QUICK_REQUEST_TIMEOUT_MS
        : DEFAULT_EVALUATION_REQUEST_TIMEOUT_MS,
      evaluation_call_budget_usd: evaluationMode === "quick"
        ? QUICK_EVALUATION_CALL_BUDGET_USD
        : DEFAULT_EVALUATION_CALL_BUDGET_USD,
      evaluation_page_scope: evaluationPageScope,
      evaluation_mode: evaluationMode,
      ...(evaluationMode === "quick" ? { quick_max_claims: QUICK_MAX_CLAIMS } : {}),
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
