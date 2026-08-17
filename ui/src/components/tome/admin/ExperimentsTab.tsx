"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, FlaskConical, Loader2, RefreshCw, Square, Trash2, Trophy } from "lucide-react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";

import { ExperimentDecisionDashboard } from "@/components/tome/admin/ExperimentDecisionDashboard";
import { RubricInfo } from "@/components/tome/admin/RubricInfo";
import { RubricRadarChart } from "@/components/tome/admin/RubricRadarChart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  MODEL_CATALOG,
  modelProfile,
  recommendedUpperBoundEvaluator,
  upperBoundEvaluatorError,
} from "@/lib/tome/model-catalog";
import { buildExperimentProgress } from "@/lib/tome/experiment-progress";
import {
  QUICK_COST_CEILING_USD,
  QUICK_MAX_CLAIMS,
  QUICK_REPEAT_COUNT,
  QUICK_TURN_LIMIT,
  evaluationModeLabel,
  experimentEvaluationMode,
} from "@/lib/tome/experiment-mode";
import {
  isSelectedPageEvaluation,
  pageIsInEvaluationScope,
} from "@/lib/tome/experiment-page-scope";
import { buildPageEvaluationView } from "@/lib/tome/page-evaluation";
import { RUBRIC_DEFINITIONS } from "@/lib/tome/rubric-definitions";
import type { ProjectDocument } from "@/types/projects";
import {
  TOME_RUBRIC_IDS,
  type ArtifactEvaluation,
  type ArtifactFileEvaluation,
  type ExperimentAggregate,
  type ExperimentArtifact,
  type ExperimentEvaluationMode,
  type ExperimentOperation,
  type QualityPolicy,
  type RubricPolicy,
  type TomeExperiment,
} from "@/types/tome-evaluation";

interface Detail {
  experiment: TomeExperiment;
  artifacts: ExperimentArtifact[];
  evaluations: ArtifactEvaluation[];
  file_evaluations?: ArtifactFileEvaluation[];
  aggregates: ExperimentAggregate[];
  warnings: string[];
}

interface EvaluationPageManifestEntry {
  path: string;
  characters: number;
  origin: "wiki" | "github" | "confluence" | "webex" | "template";
  exists: boolean;
}

const PROJECT_OPERATIONS: ReadonlyArray<{ value: ExperimentOperation; label: string }> = [
  { value: "ingest", label: "Ingest" },
  { value: "compact", label: "Compact" },
];
const SYNTHESIZED_OPERATIONS: ReadonlyArray<{ value: ExperimentOperation; label: string }> = [
  { value: "synthesize", label: "Synthesize" },
  { value: "compact", label: "Compact" },
];
const DEFAULT_MODEL_A = MODEL_CATALOG[0] ?? "";
const DEFAULT_MODEL_B = MODEL_CATALOG[1] ?? DEFAULT_MODEL_A;
const DEFAULT_EVALUATOR = recommendedUpperBoundEvaluator(DEFAULT_MODEL_A, DEFAULT_MODEL_B) ?? "";
const TERMINAL_EXPERIMENT_STATUSES: TomeExperiment["status"][] = [
  "stopped_by_user",
  "completed",
  "completed_with_errors",
  "stopped_cost_ceiling",
  "failed",
];

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: TomeExperiment["status"]): string {
  if (status === "completed") return "text-emerald-600";
  if (status === "failed") return "text-destructive";
  if (["completed_with_errors", "stopped_cost_ceiling", "stopped_by_user"].includes(status)) {
    return "text-amber-600";
  }
  return "text-primary";
}

function artifactStatusPresentation(status: ArtifactEvaluation["status"] | undefined): {
  label: string;
  className: string;
} {
  if (status === "passed") {
    return { label: "Completed · checks passed", className: "text-emerald-600" };
  }
  if (status === "failed") {
    return { label: "Completed · review required", className: "text-amber-600" };
  }
  if (status === "partial") {
    return { label: "Partial result", className: "text-amber-600" };
  }
  if (status === "error") {
    return { label: "Judge failed", className: "text-destructive" };
  }
  return { label: "Not evaluated", className: "text-muted-foreground" };
}

function friendlyEvaluatorError(error: string | undefined): {
  key: string;
  title: string;
  guidance: string;
} {
  const value = error?.toLowerCase() ?? "";
  if (value.includes("error_max_turns")) {
    return {
      key: "turn-budget",
      title: "Evaluator turn budget exceeded",
      guidance: "Retry the failed file. Quick eval now reserves schema-completion turns, while oversized files are pre-chunked before the judge call.",
    };
  }
  if (value.includes("error_max_budget") || value.includes("max budget")) {
    return {
      key: "call-budget",
      title: "Evaluator call budget was too low",
      guidance: "Retry the failed files. Quick eval now sends less scaffolding and gives the judge enough bounded headroom to finish.",
    };
  }
  if (value.includes("rate limit") || /\b429\b/.test(value)) {
    return {
      key: "rate-limit",
      title: "Evaluator was rate limited",
      guidance: "Retry after provider capacity recovers; completed candidate artifacts remain available.",
    };
  }
  if (value.includes("max_tokens")) {
    return {
      key: "output-limit",
      title: "Evaluator output limit exceeded",
      guidance: "Retry with smaller candidate batches or a model with a larger output allowance.",
    };
  }
  return {
    key: "request-failed",
    title: "Evaluator request failed",
    guidance: "Review the technical details, verify provider health, and retry the evaluation.",
  };
}

function ExperimentModelPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-medium">
      {name}
      <select
        aria-label={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
      >
        <option value="" disabled>Select a model</option>
        {MODEL_CATALOG.map((model) => (
          <option key={model} value={model}>{model}</option>
        ))}
      </select>
    </label>
  );
}

export function ExperimentsTab() {
  const { toast } = useToast();
  const policiesInitialized = useRef(false);
  const newEvaluationRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const selectedFileRef = useRef<HTMLDivElement>(null);
  const [entities, setEntities] = useState<ProjectDocument[]>([]);
  const [experiments, setExperiments] = useState<TomeExperiment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [retryingFiles, setRetryingFiles] = useState(false);
  const [deletingRuns, setDeletingRuns] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { scope: "one"; experiment: TomeExperiment } | { scope: "terminal" } | null
  >(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [entityId, setEntityId] = useState("");
  const [modelA, setModelA] = useState(DEFAULT_MODEL_A);
  const [modelB, setModelB] = useState(DEFAULT_MODEL_B);
  const [evaluatorModel, setEvaluatorModel] = useState(DEFAULT_EVALUATOR);
  const [operation, setOperation] = useState<ExperimentOperation>("ingest");
  const [evaluationSuiteId, setEvaluationSuiteId] = useState("live-entity");
  const [evaluationMode, setEvaluationMode] = useState<ExperimentEvaluationMode>("quick");
  const [repeatCount, setRepeatCount] = useState(QUICK_REPEAT_COUNT);
  const [costCeiling, setCostCeiling] = useState(QUICK_COST_CEILING_USD);
  const [turnLimit, setTurnLimit] = useState(QUICK_TURN_LIMIT);
  const [seed, setSeed] = useState(1);
  const [instruction, setInstruction] = useState("");
  const [evaluationPageMode, setEvaluationPageMode] = useState<"selected" | "all">("selected");
  const [selectedEvaluationPaths, setSelectedEvaluationPaths] = useState<string[]>([]);
  const [pageManifest, setPageManifest] = useState<EvaluationPageManifestEntry[]>([]);
  const [pageManifestLoading, setPageManifestLoading] = useState(false);
  const [pageManifestError, setPageManifestError] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [confirmAllPages, setConfirmAllPages] = useState(false);
  const [policy, setPolicy] = useState<QualityPolicy | null>(null);
  const [policies, setPolicies] = useState<QualityPolicy[]>([]);
  const evaluatorError = useMemo(
    () => upperBoundEvaluatorError(modelA, modelB, evaluatorModel),
    [evaluatorModel, modelA, modelB],
  );
  const recommendedEvaluator = useMemo(
    () => recommendedUpperBoundEvaluator(modelA, modelB),
    [modelA, modelB],
  );
  const evaluatorProfile = modelProfile(evaluatorModel);
  const [policyScopeKind, setPolicyScopeKind] = useState<QualityPolicy["scope_kind"]>("global");
  const [policyScopeId, setPolicyScopeId] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [selectedTrial, setSelectedTrial] = useState(1);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [newEvaluationExpanded, setNewEvaluationExpanded] = useState(true);
  const [qualityPolicyExpanded, setQualityPolicyExpanded] = useState(true);
  const [evaluationRunsExpanded, setEvaluationRunsExpanded] = useState(true);
  const [evaluatorPromptExpanded, setEvaluatorPromptExpanded] = useState(false);
  const [scrollToResultsId, setScrollToResultsId] = useState<string | null>(null);

  const selectDecisionPath = useCallback((path: string) => {
    setSelectedPath(path);
    requestAnimationFrame(() => {
      selectedFileRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const chooseEvaluationMode = useCallback((mode: ExperimentEvaluationMode) => {
    setEvaluationMode(mode);
    if (mode === "quick") {
      setEvaluationPageMode("selected");
      setRepeatCount(QUICK_REPEAT_COUNT);
      setCostCeiling(QUICK_COST_CEILING_USD);
      setTurnLimit(QUICK_TURN_LIMIT);
      return;
    }
    setEvaluationPageMode(mode === "all_pages" ? "all" : "selected");
    setRepeatCount(mode === "all_pages" ? 1 : 3);
    setCostCeiling(25);
    setTurnLimit(100);
  }, []);

  const loadList = useCallback(async () => {
    const [entityResponse, experimentResponse, policyResponse] = await Promise.all([
      fetch("/api/projects?type=all"),
      fetch("/api/tome/admin/experiments"),
      fetch("/api/tome/admin/quality-policies"),
    ]);
    const [entityBody, experimentBody, policyBody] = await Promise.all([
      entityResponse.json(), experimentResponse.json(), policyResponse.json(),
    ]);
    if (!entityResponse.ok) throw new Error(entityBody.error ?? "Failed to load entities");
    if (!experimentResponse.ok) throw new Error(experimentBody.error ?? "Failed to load experiments");
    if (!policyResponse.ok) throw new Error(policyBody.error ?? "Failed to load quality policies");
    setEntities(entityBody.data?.projects ?? []);
    setExperiments(experimentBody.data ?? []);
    const loadedPolicies = (policyBody.data as QualityPolicy[] | undefined) ?? [];
    if (!policiesInitialized.current) {
      policiesInitialized.current = true;
      setPolicies(loadedPolicies);
      const globalPolicy = loadedPolicies
        .find((item) => item.scope_kind === "global") ?? policyBody.data?.[0];
      if (globalPolicy) {
        setPolicy(globalPolicy);
        if (!evaluatorModel && globalPolicy.evaluator_model) setEvaluatorModel(globalPolicy.evaluator_model);
      }
    }
    if (!entityId && entityBody.data?.projects?.[0]?._id) setEntityId(entityBody.data.projects[0]._id);
  }, [entityId, evaluatorModel]);

  useEffect(() => {
    const scopeId = policyScopeKind === "global" ? null : policyScopeId;
    if (policyScopeKind !== "global" && !scopeId) return;
    const existing = policies.find(
      (item) => item.scope_kind === policyScopeKind && item.scope_id === scopeId,
    );
    const globalPolicy = policies.find((item) => item.scope_kind === "global");
    if (existing) setPolicy(existing);
    else if (globalPolicy) {
      setPolicy({
        ...globalPolicy,
        _id: `${policyScopeKind}:${scopeId ?? "*"}`,
        scope_kind: policyScopeKind,
        scope_id: scopeId,
        version: 0,
      });
    }
  }, [policies, policyScopeId, policyScopeKind]);

  const loadDetail = useCallback(async (id: string) => {
    const response = await fetch(`/api/tome/admin/experiments/${id}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Failed to load experiment");
    setDetail(body.data);
    setSelectedTrial(body.data.experiment.trials[0]?.trial ?? 1);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadList().catch((error) => toast(String(error.message ?? error), "error"))
      .finally(() => setLoading(false));
  }, [loadList, toast]);

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId).catch((error) => toast(String(error.message ?? error), "error"));
  }, [loadDetail, selectedId, toast]);

  useEffect(() => {
    if (!entityId) {
      setPageManifest([]);
      return;
    }
    const controller = new AbortController();
    setPageManifestLoading(true);
    setPageManifestError(null);
    fetch(`/api/tome/admin/experiments/page-manifest?entity_id=${encodeURIComponent(entityId)}`, {
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load evaluation pages");
      const paths = Array.isArray(body.data?.paths) ? body.data.paths : [];
      setPageManifest(paths);
      const available = new Set(paths.map((entry: EvaluationPageManifestEntry) => entry.path));
      setSelectedEvaluationPaths((current) => current.filter((path) => available.has(path)));
    }).catch((error) => {
      if ((error as Error).name === "AbortError") return;
      setPageManifest([]);
      setPageManifestError(String((error as Error)?.message ?? error));
    }).finally(() => {
      if (!controller.signal.aborted) setPageManifestLoading(false);
    });
    return () => controller.abort();
  }, [entityId]);

  useEffect(() => {
    if (!scrollToResultsId || detail?.experiment._id !== scrollToResultsId) return;
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToResultsId(null);
  }, [detail, scrollToResultsId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadList();
      if (selectedId) void loadDetail(selectedId);
    }, 5000);
    return () => window.clearInterval(id);
  }, [loadDetail, loadList, selectedId]);

  const start = async () => {
    setStarting(true);
    try {
      const response = await fetch("/api/tome/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          model_a: modelA,
          model_b: modelB,
          evaluator_model: evaluatorModel,
          operation,
          evaluation_suite_id: evaluationSuiteId,
          repeat_count: repeatCount,
          cost_ceiling_usd: costCeiling,
          turn_limit: turnLimit,
          seed,
          instruction: instruction.trim() || null,
          evaluation_mode: evaluationMode,
          evaluation_page_scope: {
            mode: evaluationPageMode,
            paths: evaluationPageMode === "selected" ? selectedEvaluationPaths : [],
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to start experiment");
      toast(
        evaluationMode === "all_pages"
          ? "All-pages audit started from a frozen evidence bundle"
          : `${evaluationModeLabel(evaluationMode)} started for ${selectedEvaluationPaths.length} selected page${selectedEvaluationPaths.length === 1 ? "" : "s"}`,
        "success",
      );
      setSelectedId(body.data._id);
      await loadList();
    } catch (error) {
      toast(String((error as Error)?.message ?? error), "error");
    } finally {
      setStarting(false);
    }
  };

  const savePolicy = async () => {
    if (!policy) return;
    setPolicySaving(true);
    try {
      const response = await fetch("/api/tome/admin/quality-policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save policy");
      setPolicy(body.data);
      setPolicies((current) => [
        ...current.filter((item) => item._id !== body.data._id),
        body.data,
      ]);
      toast(`${label(body.data.scope_kind)} quality policy saved`, "success");
    } catch (error) {
      toast(String((error as Error)?.message ?? error), "error");
    } finally {
      setPolicySaving(false);
    }
  };

  const stop = async () => {
    if (!detail) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/tome/admin/experiments/${detail.experiment._id}/stop`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to stop experiment");
      toast("Experiment stopped; completed results were preserved", "success");
      await Promise.all([loadList(), loadDetail(detail.experiment._id)]);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), "error");
    } finally {
      setStopping(false);
    }
  };

  const retryFailedFiles = async () => {
    if (!detail) return;
    setRetryingFiles(true);
    try {
      const response = await fetch(
        `/api/tome/admin/experiments/${detail.experiment._id}/retry-files`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to retry files");
      toast("Retrying failed files; completed file checkpoints were preserved", "success");
      await Promise.all([loadList(), loadDetail(detail.experiment._id)]);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), "error");
    } finally {
      setRetryingFiles(false);
    }
  };

  const deleteRuns = async () => {
    if (!deleteTarget) return;
    setDeletingRuns(true);
    try {
      const endpoint = deleteTarget.scope === "one"
        ? `/api/tome/admin/experiments/${deleteTarget.experiment._id}`
        : "/api/tome/admin/experiments?scope=terminal";
      const response = await fetch(endpoint, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to delete evaluation runs");
      const deletedIds = (body.data?.deleted_run_ids as string[] | undefined) ?? [];
      if (selectedId && deletedIds.includes(selectedId)) {
        setSelectedId(null);
        setDetail(null);
        setScrollToResultsId(null);
      }
      setDeleteTarget(null);
      await loadList();
      const deletedCount = Number(body.data?.deleted_experiments ?? 0);
      toast(
        `${deletedCount} evaluation run${deletedCount === 1 ? "" : "s"} deleted`,
        "success",
      );
    } catch (error) {
      toast(String((error as Error)?.message ?? error), "error");
    } finally {
      setDeletingRuns(false);
    }
  };

  const updateRubric = (id: keyof RubricPolicy, changes: Partial<RubricPolicy[keyof RubricPolicy]>) => {
    setPolicy((current) => current ? {
      ...current,
      rubrics: { ...current.rubrics, [id]: { ...current.rubrics[id], ...changes } },
    } : current);
  };

  const promote = async (artifactId: string) => {
    if (!detail) return;
    setPromoting(artifactId);
    try {
      const response = await fetch(`/api/tome/admin/experiments/${detail.experiment._id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact_id: artifactId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to promote winner");
      toast("Winner copied into normal draft review", "success");
      await loadDetail(detail.experiment._id);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), "error");
    } finally {
      setPromoting(null);
    }
  };

  const paired = useMemo(() => {
    if (!detail) return { a: null, b: null };
    return {
      a: detail.artifacts.find((artifact) => artifact.trial === selectedTrial && artifact.candidate === "a") ?? null,
      b: detail.artifacts.find((artifact) => artifact.trial === selectedTrial && artifact.candidate === "b") ?? null,
    };
  }, [detail, selectedTrial]);
  const selectedEntity = useMemo(
    () => entities.find((entity) => String(entity._id) === entityId),
    [entities, entityId],
  );
  const selectedEntityType = selectedEntity?.type ?? "project";
  const operationOptions = selectedEntityType === "project"
    ? PROJECT_OPERATIONS
    : SYNTHESIZED_OPERATIONS;
  const operationAllowed = operationOptions.some((option) => option.value === operation);

  useEffect(() => {
    if (selectedEntity && !operationAllowed) {
      setOperation(selectedEntityType === "project" ? "ingest" : "synthesize");
    }
  }, [operationAllowed, selectedEntity, selectedEntityType]);

  const visibleManifest = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();
    return query
      ? pageManifest.filter((entry) => entry.path.toLowerCase().includes(query))
      : pageManifest;
  }, [pageManifest, pageSearch]);
  const evaluationPageCount = evaluationPageMode === "selected"
    ? selectedEvaluationPaths.length
    : pageManifest.length;
  const plannedJudgeCalls = evaluationPageCount * 2 * repeatCount;
  const selectedScopeReady = evaluationPageMode === "all"
    || (selectedEvaluationPaths.length > 0 && !pageManifestLoading && !pageManifestError);

  const diffPaths = useMemo(() => [...new Set([
    ...(paired.a?.pages.map((page) => page.path) ?? []),
    ...(paired.b?.pages.map((page) => page.path) ?? []),
  ])]
    .filter((path) => !detail || pageIsInEvaluationScope(detail.experiment.config, path))
    .sort(), [detail, paired.a?.pages, paired.b?.pages]);
  useEffect(() => {
    setSelectedPath((current) => current && diffPaths.includes(current)
      ? current
      : (diffPaths[0] ?? null));
  }, [diffPaths]);
  const pageBody = (artifact: ExperimentArtifact | null, path: string | null) =>
    artifact?.pages.find((page) => page.path === path)?.markdown ?? "";
  const selectedPageViews = useMemo(() => {
    if (!detail || !selectedPath) return [];
    return [paired.a, paired.b]
      .filter((artifact): artifact is ExperimentArtifact => Boolean(artifact))
      .map((artifact) => ({
        artifact,
        evaluation: detail.evaluations.find((value) => value.artifact_id === artifact._id),
      }))
      .map(({ artifact, evaluation }) => ({
        artifact,
        evaluation,
        view: buildPageEvaluationView(
          evaluation,
          artifact,
          selectedPath,
          detail.experiment.config.rubric_policy,
        ),
      }));
  }, [detail, paired.a, paired.b, selectedPath]);
  const evaluationErrors = useMemo(
    () => detail?.evaluations.filter((evaluation) => evaluation.status === "error") ?? [],
    [detail],
  );
  const evaluationErrorGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      title: string;
      guidance: string;
      count: number;
      models: Map<string, number>;
    }>();
    for (const evaluation of evaluationErrors) {
      const error = evaluation.error || evaluation.blocking_findings[0];
      const friendly = friendlyEvaluatorError(error);
      const model = detail?.artifacts.find((artifact) => artifact._id === evaluation.artifact_id)?.model
        ?? evaluation.blind_label;
      const group = groups.get(friendly.key) ?? {
        ...friendly,
        count: 0,
        models: new Map<string, number>(),
      };
      group.count += 1;
      group.models.set(model, (group.models.get(model) ?? 0) + 1);
      groups.set(friendly.key, group);
    }
    return [...groups.values()];
  }, [detail?.artifacts, evaluationErrors]);
  const allEvaluationsFailed = Boolean(detail?.evaluations.length)
    && evaluationErrors.length === detail?.evaluations.length;
  const failedFileEvaluations = useMemo(
    () => detail?.file_evaluations?.filter((evaluation) => evaluation.status === "error") ?? [],
    [detail?.file_evaluations],
  );
  const incompleteFileCount = useMemo(() => {
    if (!detail) return 0;
    const checkpointByFile = new Map((detail.file_evaluations ?? []).map((checkpoint) => [
      `${checkpoint.artifact_id}:${checkpoint.path}`,
      checkpoint,
    ]));
    return detail.artifacts.reduce((count, artifact) => count + artifact.pages.filter((page) => {
      if (!pageIsInEvaluationScope(detail.experiment.config, page.path)) return false;
      const checkpoint = checkpointByFile.get(`${artifact._id}:${page.path}`);
      return checkpoint?.status !== "succeeded" || checkpoint.content_hash !== page.content_hash;
    }).length, 0);
  }, [detail]);
  const failedFileRows = useMemo(() => failedFileEvaluations.map((file) => ({
    ...file,
    model: detail?.artifacts.find((artifact) => artifact._id === file.artifact_id)?.model
      ?? file.blind_label,
  })), [detail?.artifacts, failedFileEvaluations]);
  const selectedFileFailures = useMemo(() => failedFileRows.filter((file) =>
    file.path === selectedPath
    && [paired.a?._id, paired.b?._id].includes(file.artifact_id)),
  [failedFileRows, paired.a?._id, paired.b?._id, selectedPath]);
  const radarSeries = useMemo(() => selectedPageViews
    .filter((item) => item.evaluation?.status !== "error" && Boolean(item.view?.rubrics.length))
    .map((item) => ({ label: item.artifact.model, rubrics: item.view?.rubrics ?? [] })),
  [selectedPageViews]);
  const radarEmptyReason = selectedPageViews.some((item) => item.evaluation?.status === "error")
    ? "Radar unavailable because the evaluator failed for this trial. Review the error above and rerun the evaluation."
    : "Radar unavailable because this file has fewer than three comparable rubric dimensions.";
  const experimentProgress = useMemo(() => detail
    ? buildExperimentProgress(detail.experiment, detail.artifacts, detail.evaluations)
    : null, [detail]);
  const detailGeneratedPageCount = useMemo(() => detail
    ? new Set(detail.artifacts.flatMap((artifact) => artifact.pages.map((page) => page.path))).size
    : 0, [detail]);
  const promotionBlockedByScope = Boolean(detail
    && isSelectedPageEvaluation(detail.experiment.config));
  const terminalExperiments = useMemo(
    () => experiments.filter((experiment) =>
      TERMINAL_EXPERIMENT_STATUSES.includes(experiment.status)),
    [experiments],
  );

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-medium text-amber-700 dark:text-amber-400">Note: Experimental</p>
            <p className="text-muted-foreground">
              Model evaluations use an LLM as a judge. Results can reflect evaluator bias,
              prompt sensitivity, and correlated provider failures, and every candidate and
              evaluator call incurs model cost. Review claim-level evidence before acting on a result.
            </p>
            <p className="text-muted-foreground">
              Access is admin-only. Runs smoke-test every model, enforce a cost ceiling, preserve
              candidates outside the wiki, and require manual winner selection.
            </p>
          </div>
        </div>
      </section>

      <section ref={newEvaluationRef} className="scroll-mt-6 rounded-xl border border-border bg-card p-5">
        <h2>
          <button
            type="button"
            aria-expanded={newEvaluationExpanded}
            aria-controls="new-paired-model-evaluation-content"
            onClick={() => setNewEvaluationExpanded((expanded) => !expanded)}
            className="flex w-full items-center justify-between gap-3 text-left font-medium"
          >
            <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> New paired model evaluation</span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${newEvaluationExpanded ? "rotate-180" : ""}`} />
          </button>
        </h2>
        {newEvaluationExpanded && (
          <div id="new-paired-model-evaluation-content" className="mt-4 space-y-4">
          <p className="mt-1 text-xs text-muted-foreground">
            Both candidates receive identical frozen pages, source snapshots, templates, prompt contract, turn limit, and seed. Candidate writes remain artifacts.
          </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium">Entity
            <select aria-label="Entity" value={entityId} onChange={(event) => {
              setEntityId(event.target.value);
              setSelectedEvaluationPaths([]);
              setPageSearch("");
            }} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
              {entities.map((entity) => <option key={String(entity._id)} value={String(entity._id)}>{entity.title} ({entity.type ?? "project"})</option>)}
            </select>
          </label>
          <label className="text-xs font-medium">Operation
            <select aria-label="Operation" aria-describedby="operation-help" value={operation} onChange={(event) => setOperation(event.target.value as ExperimentOperation)} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
              {operationOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <span id="operation-help" className="mt-1 block font-normal text-muted-foreground">
              {selectedEntityType === "project"
                ? "Projects support ingest and compact evaluations."
                : "Areas and BHAGs support synthesize and compact evaluations."}
            </span>
          </label>
          <label className="text-xs font-medium">Evaluation suite
            <select value={evaluationSuiteId} onChange={(event) => setEvaluationSuiteId(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="live-entity">Live entity (frozen snapshot) · v1</option>
            </select>
          </label>
          <label className="text-xs font-medium">Promotion mode
            <select value="manual" disabled className="mt-1 h-9 w-full rounded-md border bg-muted px-2 text-sm">
              <option value="manual">Manual winner selection</option>
            </select>
          </label>
          {[{ name: "Model A", value: modelA, set: setModelA }, { name: "Model B", value: modelB, set: setModelB }, { name: "Evaluator model", value: evaluatorModel, set: setEvaluatorModel }].map((field) => (
            <ExperimentModelPicker
              key={field.name}
              name={field.name}
              value={field.value}
              onChange={field.set}
            />
          ))}
          <label className="text-xs font-medium">Repeat count
            <Input type="number" min={1} max={10} value={repeatCount} disabled={evaluationMode === "quick"} onChange={(event) => setRepeatCount(Number(event.target.value))} className="mt-1" />
          </label>
          <label className="text-xs font-medium">Cost ceiling (USD)
            <Input type="number" min={0.01} step={0.5} value={costCeiling} disabled={evaluationMode === "quick"} onChange={(event) => setCostCeiling(Number(event.target.value))} className="mt-1" />
          </label>
          <label className="text-xs font-medium">Turn limit
            <Input type="number" min={1} max={200} value={turnLimit} disabled={evaluationMode === "quick"} onChange={(event) => setTurnLimit(Number(event.target.value))} className="mt-1" />
          </label>
          <label className="text-xs font-medium">Seed
            <Input type="number" min={0} value={seed} onChange={(event) => setSeed(Number(event.target.value))} className="mt-1" />
          </label>
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid gap-3 md:grid-cols-2 md:items-end">
            <label className="text-xs font-medium">Evaluation type
              <select
                aria-label="Evaluation type"
                value={evaluationMode}
                onChange={(event) => chooseEvaluationMode(event.target.value as ExperimentEvaluationMode)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="quick">Quick eval (recommended)</option>
                <option value="deep">Deep audit · selected pages</option>
                <option value="all_pages">All-pages audit</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              {evaluationPageCount > 0
                ? `${evaluationPageCount} page${evaluationPageCount === 1 ? "" : "s"} × 2 candidates × ${repeatCount} trial${repeatCount === 1 ? "" : "s"} = ${plannedJudgeCalls} judge calls${evaluationMode === "quick" ? " + 2 targeted candidate runs" : ""}`
                : "Choose at least one page to calculate the judge-call count."}
            </p>
          </div>
          {evaluationPageMode === "selected" ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {evaluationMode === "quick"
                  ? `Candidates may read the frozen project but can update only the selected pages. One trial checks up to ${QUICK_MAX_CLAIMS} material claims with the compact safety rubric.`
                  : "Candidates receive the complete frozen project. The selected pages receive an exhaustive claim-level audit."}
              </p>
              {evaluationMode === "quick" && (
                <p className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                  Includes Template Compliance, Claim Evidence, Grounding, Contradictions,
                  Unsupported Critical Claims, Fabricated Entities, Fabricated Quantitative
                  Details, Evaluator Confidence, Internal Links, and Stable-page Preservation.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="Search evaluation pages"
                  value={pageSearch}
                  onChange={(event) => setPageSearch(event.target.value)}
                  placeholder="Search pages"
                  className="min-w-56 flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={visibleManifest.length === 0}
                  onClick={() => setSelectedEvaluationPaths((current) => [
                    ...new Set([...current, ...visibleManifest.map((entry) => entry.path)]),
                  ].sort())}
                >
                  Select visible
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={selectedEvaluationPaths.length === 0}
                  onClick={() => setSelectedEvaluationPaths([])}
                >
                  Clear
                </Button>
              </div>
              {pageManifestLoading ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading pages…
                </p>
              ) : pageManifestError ? (
                <p role="alert" className="text-xs text-destructive">{pageManifestError}</p>
              ) : visibleManifest.length === 0 ? (
                <p className="text-xs text-muted-foreground">No matching pages.</p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                  {visibleManifest.map((entry) => (
                    <label key={entry.path} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs hover:bg-muted/60">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selectedEvaluationPaths.includes(entry.path)}
                        onChange={(event) => setSelectedEvaluationPaths((current) => event.target.checked
                          ? [...new Set([...current, entry.path])].sort()
                          : current.filter((path) => path !== entry.path))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-all font-mono">{entry.path}</span>
                        <span className="text-muted-foreground">
                          {label(entry.origin)}
                          {entry.exists ? ` · ${(entry.characters / 1000).toFixed(1)}k characters` : " · generated from template"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-400">All-pages audits are expensive and slow</p>
                <p className="mt-1 text-muted-foreground">
                  {pageManifest.length > 0
                    ? `This will judge at least ${pageManifest.length} pages across both candidates and ${repeatCount} trial${repeatCount === 1 ? "" : "s"} (${plannedJudgeCalls} calls before chunking). It can take hours, and oversized files may require additional calls.`
                    : "The exact page count will be known after generation. This can take hours and may stop at the configured cost ceiling."}
                </p>
              </div>
            </div>
          )}
        </div>
        <label className="block text-xs font-medium">Optional operation instruction
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border bg-background p-2 text-sm" />
        </label>
        {evaluatorError && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{evaluatorError}</span>
            {recommendedEvaluator && recommendedEvaluator !== evaluatorModel && (
              <Button type="button" variant="outline" size="sm" onClick={() => setEvaluatorModel(recommendedEvaluator)}>
                Use recommended evaluator
              </Button>
            )}
          </div>
        )}
        {!evaluatorError && evaluatorProfile && (
          <p className="text-xs text-muted-foreground">
            Upper-bound judge · {Math.round(evaluatorProfile.context_window_tokens / 1000)}k context · {Math.round(evaluatorProfile.max_output_tokens / 1000)}k maximum output
          </p>
        )}
        <Button
          onClick={() => evaluationMode === "all_pages" ? setConfirmAllPages(true) : void start()}
          disabled={starting || !entityId || !operationAllowed || !modelA || !modelB || !evaluatorModel || Boolean(evaluatorError) || !selectedScopeReady}
          className="gap-2"
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Run model evaluation
        </Button>
          </div>
        )}
      </section>

      {policy && (
        <section className="rounded-xl border border-border p-5">
          <h2>
            <button
              type="button"
              aria-expanded={qualityPolicyExpanded}
              aria-controls="quality-policy-content"
              onClick={() => setQualityPolicyExpanded((expanded) => !expanded)}
              className="flex w-full items-center justify-between gap-3 text-left font-medium"
            >
              <span>Quality policy</span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${qualityPolicyExpanded ? "rotate-180" : ""}`} />
            </button>
          </h2>
          {qualityPolicyExpanded && (
            <div id="quality-policy-content" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-xs text-muted-foreground">Configure the mode here; the global policy starts Off. Exact entity overrides entity type, which overrides the global default.</p>
            <Button size="sm" onClick={() => void savePolicy()} disabled={policySaving}>{policySaving ? "Saving…" : "Save policy"}</Button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium">Scope
              <select value={policyScopeKind} onChange={(event) => {
                const kind = event.target.value as QualityPolicy["scope_kind"];
                setPolicyScopeKind(kind);
                setPolicyScopeId(kind === "type" ? "project" : kind === "exact" ? entityId : "");
              }} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="global">Global</option><option value="type">Entity type</option><option value="exact">Exact entity</option>
              </select>
            </label>
            {policyScopeKind === "type" && <label className="text-xs font-medium">Entity type
              <select value={policyScopeId} onChange={(event) => setPolicyScopeId(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="project">Project</option><option value="area">Area</option><option value="bhag">BHAG</option>
              </select>
            </label>}
            {policyScopeKind === "exact" && <label className="text-xs font-medium">Entity
              <select value={policyScopeId} onChange={(event) => setPolicyScopeId(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                {entities.map((entity) => <option key={String(entity._id)} value={String(entity._id)}>{entity.title}</option>)}
              </select>
            </label>}
            <label className="text-xs font-medium">Mode
              <select value={policy.mode} onChange={(event) => setPolicy({ ...policy, mode: event.target.value as QualityPolicy["mode"] })} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="off">Off</option><option value="observe">Observe</option><option value="enforce">Enforce</option>
              </select>
            </label>
            <label className="text-xs font-medium">Default evaluator<Input value={policy.evaluator_model} onChange={(event) => setPolicy({ ...policy, evaluator_model: event.target.value })} className="mt-1 font-mono text-xs" /></label>
            <div className="space-y-2 pt-5 text-xs">
              <label className="flex gap-2"><input type="checkbox" checked={policy.require_human_review} onChange={(event) => setPolicy({ ...policy, require_human_review: event.target.checked })} /> Require human review</label>
              <label className="flex gap-2"><input type="checkbox" checked={policy.allow_steward_override} onChange={(event) => setPolicy({ ...policy, allow_steward_override: event.target.checked })} /> Allow reasoned steward override</label>
            </div>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="p-2">Rubric</th><th>On</th><th>Block</th><th>Min</th><th>Max</th><th>Count max</th><th>Rate max</th></tr></thead>
              <tbody>{TOME_RUBRIC_IDS.map((id) => { const rubric = policy.rubrics[id]; return (
                <tr key={id} className="border-t"><td className="p-2 font-medium"><span className="flex items-center gap-1.5">{RUBRIC_DEFINITIONS[id].label}<RubricInfo rubricId={id} /></span></td>
                  <td><input type="checkbox" checked={rubric.enabled} onChange={(event) => updateRubric(id, { enabled: event.target.checked })} /></td>
                  <td><input type="checkbox" checked={rubric.blocking} onChange={(event) => updateRubric(id, { blocking: event.target.checked })} /></td>
                  <td><Input type="number" step="0.01" className="h-7 w-20" value={rubric.min ?? ""} onChange={(event) => updateRubric(id, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></td>
                  <td><Input type="number" step="0.01" className="h-7 w-20" value={rubric.max ?? ""} onChange={(event) => updateRubric(id, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></td>
                  <td><Input type="number" step="1" className="h-7 w-20" value={rubric.max_count ?? ""} onChange={(event) => updateRubric(id, { max_count: event.target.value === "" ? undefined : Number(event.target.value) })} /></td>
                  <td><Input type="number" step="0.01" className="h-7 w-20" value={rubric.max_rate ?? ""} onChange={(event) => updateRubric(id, { max_rate: event.target.value === "" ? undefined : Number(event.target.value) })} /></td>
                </tr>); })}</tbody>
            </table>
          </div>
            </div>
          )}
        </section>
      )}

      <section>
        <h2>
          <button
            type="button"
            aria-expanded={evaluationRunsExpanded}
            aria-controls="evaluation-runs-content"
            onClick={() => setEvaluationRunsExpanded((expanded) => !expanded)}
            className="flex w-full items-center justify-between gap-3 text-left font-medium"
          >
            <span>Evaluation runs</span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${evaluationRunsExpanded ? "rotate-180" : ""}`} />
          </button>
        </h2>
        {evaluationRunsExpanded && (
          <div id="evaluation-runs-content" className="mt-3 space-y-3">
            <div className="flex flex-wrap justify-end gap-2">
              {terminalExperiments.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget({ scope: "terminal" })}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete old runs
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void loadList()} className="gap-2"><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
            </div>
            {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : experiments.length === 0 ? <p className="text-sm text-muted-foreground">No experiments yet.</p> : (
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">{experiments.map((experiment) => {
                const selectedEvaluations = detail?.experiment._id === experiment._id
                  ? detail.evaluations
                  : [];
                const selectedErrors = selectedEvaluations.filter((evaluation) => evaluation.status === "error");
                const displayStatus = experiment.status === "completed" && selectedEvaluations.length > 0
                  ? selectedErrors.length === selectedEvaluations.length
                    ? "failed"
                    : selectedErrors.length > 0
                      ? "completed_with_errors"
                      : experiment.status
                  : experiment.status;
                return (
                  <button
                    key={experiment._id}
                    type="button"
                    aria-pressed={selectedId === experiment._id}
                    onClick={() => {
                      setSelectedId(experiment._id);
                      setScrollToResultsId(experiment._id);
                    }}
                    className={`rounded-lg border p-3 text-left hover:bg-muted/50 ${selectedId === experiment._id ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}
                  >
                    <div className="flex justify-between gap-3"><span className="font-medium">{experiment.project_slug} · {experiment.config.operation}</span><span className={`text-xs ${statusClass(displayStatus)}`}>{displayStatus === "failed" && experiment.status === "completed" ? "Evaluation Failed" : label(displayStatus)}</span></div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {evaluationModeLabel(experimentEvaluationMode(experiment.config))} · {experiment.config.model_a} vs {experiment.config.model_b} · {experiment.config.repeat_count} paired trial(s)
                      {isSelectedPageEvaluation(experiment.config)
                        ? ` · ${experiment.config.evaluation_page_scope?.paths.length ?? 0} selected page(s)`
                        : " · all pages"}
                    </p>
                    {selectedErrors.length > 0 && (
                      <p className={`mt-1 text-xs ${allEvaluationsFailed ? "text-destructive" : "text-amber-600"}`}>
                        {selectedErrors.length}/{selectedEvaluations.length} judge calls failed
                      </p>
                    )}
                  </button>
                );
              })}</div>
            )}
          </div>
        )}
      </section>

      {detail && (
        <section ref={resultsRef} className="scroll-mt-6 space-y-5 rounded-xl border border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">Results · {detail.experiment.project_slug}</h2>
                {allEvaluationsFailed && (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">Evaluation failed</span>
                )}
                {!allEvaluationsFailed && failedFileEvaluations.length > 0 && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">Partial results</span>
                )}
                <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-medium">
                  {evaluationModeLabel(experimentEvaluationMode(detail.experiment.config))}
                </span>
                <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-medium">
                  {isSelectedPageEvaluation(detail.experiment.config)
                    ? `${detail.experiment.config.evaluation_page_scope?.paths.length ?? 0} of ${detailGeneratedPageCount} generated pages`
                    : `All ${detailGeneratedPageCount} generated pages`}
                </span>
              </div>
              <details className="mt-1 text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none">Run details</summary>
                <div className="mt-2 space-y-1 rounded-md bg-muted/50 p-3 font-mono">
                  <p>Evidence {detail.experiment.evidence_hash}</p>
                  <p>Suite {detail.experiment.config.evaluation_suite_id}@{detail.experiment.config.evaluation_suite_version}</p>
                  <p>Prompt {detail.experiment.config.prompt_hash}</p>
                  <p>Tools {detail.experiment.config.tool_contract_version}</p>
                  <p>Mode {experimentEvaluationMode(detail.experiment.config)}</p>
                  <p>
                    Scope {isSelectedPageEvaluation(detail.experiment.config)
                      ? detail.experiment.config.evaluation_page_scope?.paths.join(", ")
                      : "all generated pages"}
                  </p>
                </div>
              </details>
            </div>
            <div className="flex flex-wrap gap-2">
              {incompleteFileCount > 0
                && !["queued", "running", "evaluating"].includes(detail.experiment.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void retryFailedFiles()}
                  disabled={retryingFiles}
                  className="gap-2"
                >
                  {retryingFiles
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  {retryingFiles
                    ? "Retrying…"
                    : `Retry ${incompleteFileCount} incomplete file${incompleteFileCount === 1 ? "" : "s"}`}
                </Button>
              )}
              {!["queued", "running", "evaluating"].includes(detail.experiment.status) && (
                <Button variant="outline" size="sm" onClick={() => {
                  const config = detail.experiment.config;
                  setEntityId(config.entity_id);
                  setModelA(config.model_a);
                  setModelB(config.model_b);
                  setEvaluatorModel(config.evaluator_model);
                  setOperation(config.operation);
                  setEvaluationSuiteId(config.evaluation_suite_id);
                  setRepeatCount(config.repeat_count);
                  setCostCeiling(config.cost_ceiling_usd);
                  setTurnLimit(config.turn_limit);
                  setSeed(config.seed);
                  setInstruction(config.instruction ?? "");
                  setEvaluationMode(experimentEvaluationMode(config));
                  setEvaluationPageMode(config.evaluation_page_scope?.mode ?? "all");
                  setSelectedEvaluationPaths(config.evaluation_page_scope?.paths ?? []);
                  setNewEvaluationExpanded(true);
                  newEvaluationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }} className="gap-2">
                  <RefreshCw className="h-3.5 w-3.5" /> Use settings for new run
                </Button>
              )}
              {TERMINAL_EXPERIMENT_STATUSES.includes(detail.experiment.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget({
                    scope: "one",
                    experiment: detail.experiment,
                  })}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete run
                </Button>
              )}
              {["queued", "running", "evaluating"].includes(detail.experiment.status) && (
                <Button variant="destructive" size="sm" onClick={() => void stop()} disabled={stopping} className="gap-2">
                  {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  {stopping ? "Stopping…" : "Stop evaluation"}
                </Button>
              )}
            </div>
          </div>
          {experimentProgress?.active && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">Evaluation progress</h3>
                <span className="text-sm font-medium text-primary">{experimentProgress.percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="Model evaluation progress"
                aria-valuemin={0}
                aria-valuemax={experimentProgress.totalSteps}
                aria-valuenow={experimentProgress.completedSteps}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${experimentProgress.percent}%` }}
                />
              </div>
              <div className="flex items-start gap-2 text-sm">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{experimentProgress.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {experimentProgress.completedSteps} of {experimentProgress.totalSteps} generation and judge steps complete
                    {experimentProgress.trial
                      ? ` · Trial ${experimentProgress.trial} of ${detail.experiment.config.repeat_count}`
                      : ""}
                  </p>
                  {experimentProgress.model && (
                    <p className="break-all font-mono text-xs">Candidate model: {experimentProgress.model}</p>
                  )}
                  {experimentProgress.evaluatorModel && (
                    <p className="break-all font-mono text-xs">Judge model: {experimentProgress.evaluatorModel}</p>
                  )}
                  {experimentProgress.pages.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Pages in this output ({experimentProgress.pages.length}): {experimentProgress.pages.slice(0, 4).join(", ")}
                      {experimentProgress.pages.length > 4
                        ? `, +${experimentProgress.pages.length - 4} more`
                        : ""}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="rounded-lg border border-border">
            <h3>
              <button
                type="button"
                aria-label="Evaluator prompt"
                aria-expanded={evaluatorPromptExpanded}
                aria-controls="evaluator-prompt-content"
                onClick={() => setEvaluatorPromptExpanded((expanded) => !expanded)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <span className="flex items-center gap-2 font-medium">
                  Evaluator prompt
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                    Read-only
                  </span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${evaluatorPromptExpanded ? "rotate-180" : ""}`} />
              </button>
            </h3>
            {evaluatorPromptExpanded && (
              <div id="evaluator-prompt-content" className="space-y-4 border-t border-border p-4">
                {detail.experiment.config.evaluator_prompt_contract ? (
                  <>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>
                        Version <span className="font-mono text-foreground">{detail.experiment.config.evaluator_prompt_contract.version}</span>
                      </p>
                      {detail.experiment.config.evaluator_model_profile && (
                        <p>
                          Upper-bound profile v{detail.experiment.config.evaluator_model_profile.profile_version}
                          {" · "}{Math.round(detail.experiment.config.evaluator_model_profile.context_window_tokens / 1000)}k context
                          {" · "}{Math.round(detail.experiment.config.evaluator_model_profile.max_output_tokens / 1000)}k maximum output
                        </p>
                      )}
                      <p>
                        Frozen when this run was created and included in its prompt hash. Candidate pages,
                        stable pages, and frozen evidence replace the request-template placeholders at evaluation time.
                      </p>
                    </div>
                    <div>
                      <h4 className="mb-2 text-xs font-medium">System prompt</h4>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                        {detail.experiment.config.evaluator_prompt_contract.system_prompt}
                      </pre>
                    </div>
                    <div>
                      <h4 className="mb-2 text-xs font-medium">Request template</h4>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                        {detail.experiment.config.evaluator_prompt_contract.request_template}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This run predates evaluator prompt snapshots. New runs freeze and display the exact versioned prompt contract.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Editing is intentionally disabled to preserve blinded comparisons and reproducible results.
                </p>
              </div>
            )}
          </div>
          {detail.warnings.map((warning) => <p key={warning} className="flex gap-2 text-xs text-amber-600"><AlertTriangle className="h-4 w-4" />{warning}</p>)}
          {evaluationErrors.length > 0 && (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium text-destructive">{allEvaluationsFailed ? "No scores were produced" : "Some scores are unavailable"}</p>
                  <p className="text-muted-foreground">
                    {evaluationErrors.length} of {detail.evaluations.length} judge calls failed. Failed calls are excluded from rankings and cannot be selected as winners.
                  </p>
                </div>
              </div>
              <div className="space-y-2 pl-6">
                {evaluationErrorGroups.map((group) => (
                  <div key={group.key} className="rounded-md border border-destructive/20 bg-background/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{group.title}</p>
                      <span className="text-muted-foreground">{group.count} call{group.count === 1 ? "" : "s"}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{group.guidance}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[...group.models.entries()].map(([model, count]) => (
                        <span key={model} className="rounded bg-muted px-2 py-1 font-mono text-[10px]">{model} ×{count}</span>
                      ))}
                    </div>
                  </div>
                ))}
                <details className="rounded-md border border-border bg-background/60 p-3">
                  <summary className="cursor-pointer select-none font-medium">Technical details ({evaluationErrors.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {evaluationErrors.map((evaluation) => {
                      const model = detail.artifacts.find((artifact) => artifact._id === evaluation.artifact_id)?.model
                        ?? evaluation.blind_label;
                      return (
                        <li key={evaluation._id ?? evaluation.artifact_id} className="break-words font-mono text-[10px] text-muted-foreground">
                          {model}: {evaluation.error || evaluation.blocking_findings[0] || "Evaluator failed without an error message."}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </div>
            </div>
          )}
          {failedFileRows.length > 0 && (
            <div role="alert" className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Partial results · {failedFileRows.length} failed file{failedFileRows.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-muted-foreground">
                    Successful file checkpoints and scores were preserved. Retry processes only the files below.
                  </p>
                </div>
              </div>
              <ul className="max-h-48 space-y-1 overflow-auto pl-6">
                {failedFileRows.map((file) => (
                  <li key={file._id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/60 px-2 py-1.5">
                    <span><span className="font-mono">{file.path}</span> · {file.model}</span>
                    <span className="text-muted-foreground">
                      {file.completed_chunks}/{file.chunk_count} chunks checkpointed
                      {file.retryable === false ? " · review required" : " · retryable"}
                    </span>
                  </li>
                ))}
              </ul>
              <details className="ml-6 rounded-md border border-border bg-background/60 p-3">
                <summary className="cursor-pointer select-none font-medium">
                  Failed file diagnostics ({failedFileRows.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {failedFileRows.map((file) => (
                    <li key={file._id} className="break-words font-mono text-[10px] text-muted-foreground">
                      {file.model} · {file.path}: {file.error ?? "Evaluator failed without an error message."}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          <ExperimentDecisionDashboard
            experiment={detail.experiment}
            artifacts={detail.artifacts}
            evaluations={detail.evaluations}
            fileEvaluations={detail.file_evaluations ?? []}
            aggregates={detail.aggregates}
            selectedPath={selectedPath}
            onSelectPath={selectDecisionPath}
          />
          <div className="flex items-center gap-3"><label className="text-xs font-medium">Trial <select value={selectedTrial} onChange={(event) => setSelectedTrial(Number(event.target.value))} className="ml-2 h-8 rounded border bg-background px-2">{[...new Set(detail.artifacts.map((artifact) => artifact.trial))].map((trial) => <option key={trial}>{trial}</option>)}</select></label><select aria-label="Evaluation page" value={selectedPath ?? ""} onChange={(event) => setSelectedPath(event.target.value)} className="h-8 min-w-60 rounded border bg-background px-2 text-xs">{diffPaths.map((path) => <option key={path}>{path}</option>)}</select></div>
          {selectedPath && (
            <div ref={selectedFileRef} className="scroll-mt-4 space-y-3">
              <div>
                <h3 className="font-medium">Selected file · {selectedPath}</h3>
                <p className="text-xs text-muted-foreground">Claim, citation, grounding, safety, attribution, and confidence metrics are recalculated from this file&apos;s judge findings.</p>
              </div>
              {selectedFileFailures.length > 0 && (
                <p className="rounded bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                  This file failed for {selectedFileFailures.map((file) => file.model).join(" and ")}. Its other file checkpoints remain available.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">{selectedPageViews.map(({ artifact, view }) => (
                <div key={artifact._id} className="rounded-lg border p-3 text-xs">
                  <h4 className="break-all font-mono font-medium">{artifact.model}</h4>
                  {view ? <div className="mt-2 grid grid-cols-2 gap-1 text-muted-foreground">
                    <span>Claims {view.stats.claimCount}</span>
                    <span>Support {view.stats.supportRate === null ? "—" : `${Math.round(view.stats.supportRate * 100)}%`}</span>
                    <span>Supported {view.stats.supported}</span>
                    <span>Partial {view.stats.partiallySupported}</span>
                    <span>Unsupported {view.stats.unsupported}</span>
                    <span>Contradicted {view.stats.contradicted}</span>
                    <span>Unverifiable {view.stats.unverifiable}</span>
                    <span>Citations {view.stats.citationCoverage === null ? "—" : `${Math.round(view.stats.citationCoverage * 100)}%`}</span>
                    <span>Confidence {view.stats.confidence === null ? "—" : `${Math.round(view.stats.confidence * 100)}%`}</span>
                  </div> : <p className="mt-2 text-muted-foreground">Not evaluated.</p>}
                </div>
              ))}</div>
            </div>
          )}
          <RubricRadarChart series={radarSeries} emptyReason={radarEmptyReason} />
          {paired.a && paired.b && selectedPath && <div className="overflow-auto rounded border"><ReactDiffViewer key={`${selectedTrial}:${selectedPath}`} oldValue={pageBody(paired.a, selectedPath)} newValue={pageBody(paired.b, selectedPath)} splitView compareMethod={DiffMethod.WORDS} leftTitle={paired.a.model} rightTitle={paired.b.model} /></div>}
          <div className="grid gap-4 md:grid-cols-2">{[paired.a, paired.b].filter((artifact): artifact is ExperimentArtifact => Boolean(artifact)).map((artifact) => {
            const evaluation = detail.evaluations.find((value) => value.artifact_id === artifact._id);
            const pageView = selectedPageViews.find((item) => item.artifact._id === artifact._id)?.view;
            const pageClaims = (evaluation?.claims ?? []).filter((claim) => claim.page === selectedPath);
            const statusPresentation = artifactStatusPresentation(evaluation?.status);
            const blockingRubrics = (evaluation?.rubrics ?? []).filter((rubric) =>
              rubric.enabled && rubric.blocking && rubric.passed !== true);
            const blockingDetails = (evaluation?.blocking_findings ?? []).filter((finding) =>
              !TOME_RUBRIC_IDS.includes(finding as typeof TOME_RUBRIC_IDS[number]));
            return (
              <div key={artifact._id} className="space-y-3 rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><h3 className="break-all font-mono text-xs font-medium">{artifact.model}</h3><span className={`shrink-0 text-xs ${statusPresentation.className}`}>{statusPresentation.label}</span></div>
                {evaluation?.status === "error" && (
                  <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">
                    Judge call failed. See the evaluator failure summary above.
                  </p>
                )}
                {evaluation?.status === "failed" && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      Quality gate not met
                    </p>
                    {blockingRubrics.length > 0 && (
                      <p className="mt-1 text-muted-foreground">
                        Blocking {blockingRubrics.length === 1 ? "check" : "checks"}: {blockingRubrics
                          .map((rubric) => RUBRIC_DEFINITIONS[rubric.id].label)
                          .join(", ")}
                      </p>
                    )}
                    {blockingDetails.slice(0, 2).map((finding) => (
                      <p key={finding} className="mt-1 text-muted-foreground">{finding}</p>
                    ))}
                  </div>
                )}
                {evaluation && evaluation.status !== "error" && (
                  <p className="text-[11px] text-muted-foreground">
                    Judge batches {evaluation.evaluation_batches ?? 1}
                    {" · attempts "}{evaluation.evaluation_attempts ?? 1}
                    {evaluation.evaluation_peak_estimated_input_tokens && evaluation.evaluation_input_budget_tokens
                      ? ` · peak ${Math.round(evaluation.evaluation_peak_estimated_input_tokens / 1000)}k/${Math.round(evaluation.evaluation_input_budget_tokens / 1000)}k input tokens`
                      : ""}
                  </p>
                )}
                <div className="max-h-48 overflow-auto text-xs">{pageView?.rubrics.filter((rubric) => rubric.enabled).map((rubric) => <div key={rubric.id} className="flex justify-between gap-3 border-b py-1"><span className="flex items-center gap-1.5">{RUBRIC_DEFINITIONS[rubric.id].label}<RubricInfo rubricId={rubric.id} /></span><span>{rubric.passed === null ? "telemetry" : rubric.passed ? "pass" : "fail"}{rubric.score !== undefined ? ` · ${rubric.score.toFixed(3)}` : rubric.rate !== undefined ? ` · ${(rubric.rate * 100).toFixed(0)}%` : rubric.count !== undefined ? ` · ${rubric.count}` : ""}</span></div>)}</div>
                <div className="max-h-48 space-y-2 overflow-auto">{pageClaims.filter((claim) => claim.classification !== "supported").map((claim) => <div key={claim.id} className="rounded bg-muted p-2 text-xs"><p className="font-medium">{claim.classification} · {claim.page}</p><p>&ldquo;{claim.exact_text}&rdquo;</p><p className="text-muted-foreground">{claim.reason}</p>{claim.citations.filter((citation) => /^https?:\/\//.test(citation)).map((citation) => <a key={citation} href={citation} target="_blank" rel="noreferrer" className="block truncate text-primary underline">{citation}</a>)}{claim.evidence.map((evidence) => <p key={evidence.evidence_item_id} className="truncate font-mono text-[10px] text-muted-foreground" title={evidence.canonical_uri}>{evidence.canonical_uri} · sha256:{evidence.content_hash}</p>)}</div>)}</div>
                <Button size="sm" variant="outline" disabled={promotionBlockedByScope || Boolean(detail.experiment.promoted_run_id) || promoting !== null || !evaluation || ["error", "partial"].includes(evaluation.status) || !["completed", "completed_with_errors", "stopped_cost_ceiling", "stopped_by_user"].includes(detail.experiment.status)} onClick={() => void promote(artifact._id)} className="gap-2"><Trophy className="h-3.5 w-3.5" />{promoting === artifact._id ? "Copying…" : "Select winner for draft review"}</Button>
                {promotionBlockedByScope && <p className="text-[11px] text-muted-foreground">Run an all-pages evaluation before selecting a project-wide winner.</p>}
                {["error", "partial"].includes(evaluation?.status ?? "") && <p className="text-[11px] text-muted-foreground">Winner selection is unavailable until every file is evaluated.</p>}
              </div>
            ); })}</div>
        </section>
      )}
      <Dialog
        open={confirmAllPages}
        onOpenChange={(open) => {
          if (!starting) setConfirmAllPages(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run an all-pages evaluation?</DialogTitle>
            <DialogDescription>
              This evaluates every generated page for both candidates. It is intended for final,
              project-wide decisions after a smaller selected-page run looks promising.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Expect a long-running, higher-cost evaluation.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {pageManifest.length > 0
                ? `At least ${plannedJudgeCalls} judge calls (${pageManifest.length} pages × 2 candidates × ${repeatCount} trials), plus extra calls for chunked files. The run can take hours.`
                : "The exact call count depends on generated output. The run can take hours and will stop if it reaches the cost ceiling."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAllPages(false)} disabled={starting}>
              Cancel
            </Button>
            <Button onClick={() => {
              setConfirmAllPages(false);
              void start();
            }} disabled={starting}>
              {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run all-pages evaluation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingRuns) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.scope === "one"
                ? "Delete this evaluation run?"
                : "Delete all old evaluation runs?"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.scope === "one"
                ? `This permanently deletes the ${deleteTarget.experiment.project_slug} run, its generated candidates, judge results, file checkpoints, and unshared frozen evidence.`
                : "This permanently deletes every completed, failed, or stopped run, including older runs outside the visible list. Active runs are protected."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Draft-review runs already created from a selected winner are not deleted.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingRuns}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteRuns()} disabled={deletingRuns}>
              {deletingRuns && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deletingRuns
                ? "Deleting…"
                : deleteTarget?.scope === "one"
                  ? "Delete run"
                  : "Delete all old runs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
