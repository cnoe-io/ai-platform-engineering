"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, FlaskConical, Loader2, RefreshCw, Square, Trophy } from "lucide-react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";

import { RubricInfo } from "@/components/tome/admin/RubricInfo";
import { RubricRadarChart } from "@/components/tome/admin/RubricRadarChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  CUSTOM_MODEL_VALUE,
  MODEL_CATALOG,
  isCatalogModel,
} from "@/lib/tome/model-catalog";
import { buildExperimentProgress } from "@/lib/tome/experiment-progress";
import { buildPageEvaluationView } from "@/lib/tome/page-evaluation";
import { RUBRIC_DEFINITIONS } from "@/lib/tome/rubric-definitions";
import type { ProjectDocument } from "@/types/projects";
import {
  TOME_RUBRIC_IDS,
  type ArtifactEvaluation,
  type ExperimentAggregate,
  type ExperimentArtifact,
  type ExperimentOperation,
  type QualityPolicy,
  type RubricPolicy,
  type TomeExperiment,
} from "@/types/tome-evaluation";

interface Detail {
  experiment: TomeExperiment;
  artifacts: ExperimentArtifact[];
  evaluations: ArtifactEvaluation[];
  aggregates: ExperimentAggregate[];
  warnings: string[];
}

const PROJECT_OPERATIONS: ReadonlyArray<{ value: ExperimentOperation; label: string }> = [
  { value: "ingest", label: "Ingest" },
  { value: "compact", label: "Compact" },
];
const SYNTHESIZED_OPERATIONS: ReadonlyArray<{ value: ExperimentOperation; label: string }> = [
  { value: "synthesize", label: "Synthesize" },
  { value: "compact", label: "Compact" },
];

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: TomeExperiment["status"]): string {
  if (status === "completed") return "text-emerald-600";
  if (status === "failed") return "text-destructive";
  if (["stopped_cost_ceiling", "stopped_by_user"].includes(status)) return "text-amber-600";
  return "text-primary";
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
  const [custom, setCustom] = useState(Boolean(value) && !isCatalogModel(value));

  return (
    <label className="text-xs font-medium">
      {name}
      <select
        aria-label={name}
        value={custom ? CUSTOM_MODEL_VALUE : value}
        onChange={(event) => {
          if (event.target.value === CUSTOM_MODEL_VALUE) {
            setCustom(true);
            onChange("");
            return;
          }
          setCustom(false);
          onChange(event.target.value);
        }}
        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
      >
        <option value="" disabled>Select a model</option>
        {MODEL_CATALOG.map((model) => (
          <option key={model} value={model}>{model}</option>
        ))}
        <option value={CUSTOM_MODEL_VALUE}>Custom…</option>
      </select>
      {custom && (
        <Input
          aria-label={`${name} custom model id`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="provider/model-id"
          className="mt-2 font-mono text-xs"
        />
      )}
    </label>
  );
}

export function ExperimentsTab() {
  const { toast } = useToast();
  const policiesInitialized = useRef(false);
  const [entities, setEntities] = useState<ProjectDocument[]>([]);
  const [experiments, setExperiments] = useState<TomeExperiment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [entityId, setEntityId] = useState("");
  const [modelA, setModelA] = useState(MODEL_CATALOG[0] ?? "");
  const [modelB, setModelB] = useState(MODEL_CATALOG[1] ?? MODEL_CATALOG[0] ?? "");
  const [evaluatorModel, setEvaluatorModel] = useState(MODEL_CATALOG[0] ?? "");
  const [operation, setOperation] = useState<ExperimentOperation>("ingest");
  const [evaluationSuiteId, setEvaluationSuiteId] = useState("live-entity");
  const [repeatCount, setRepeatCount] = useState(3);
  const [costCeiling, setCostCeiling] = useState(25);
  const [turnLimit, setTurnLimit] = useState(100);
  const [seed, setSeed] = useState(1);
  const [instruction, setInstruction] = useState("");
  const [policy, setPolicy] = useState<QualityPolicy | null>(null);
  const [policies, setPolicies] = useState<QualityPolicy[]>([]);
  const [policyScopeKind, setPolicyScopeKind] = useState<QualityPolicy["scope_kind"]>("global");
  const [policyScopeId, setPolicyScopeId] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [selectedTrial, setSelectedTrial] = useState(1);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [newEvaluationExpanded, setNewEvaluationExpanded] = useState(true);
  const [qualityPolicyExpanded, setQualityPolicyExpanded] = useState(true);
  const [evaluationRunsExpanded, setEvaluationRunsExpanded] = useState(true);
  const [evaluatorPromptExpanded, setEvaluatorPromptExpanded] = useState(false);

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
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to start experiment");
      toast("Experiment started from a frozen evidence bundle", "success");
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

  const diffPaths = useMemo(() => [...new Set([
    ...(paired.a?.pages.map((page) => page.path) ?? []),
    ...(paired.b?.pages.map((page) => page.path) ?? []),
  ])].sort(), [paired]);
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

      <section className="rounded-xl border border-border bg-card p-5">
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
            <select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
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
            <Input type="number" min={1} max={10} value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} className="mt-1" />
          </label>
          <label className="text-xs font-medium">Cost ceiling (USD)
            <Input type="number" min={0.01} step={0.5} value={costCeiling} onChange={(event) => setCostCeiling(Number(event.target.value))} className="mt-1" />
          </label>
          <label className="text-xs font-medium">Turn limit
            <Input type="number" min={1} max={200} value={turnLimit} onChange={(event) => setTurnLimit(Number(event.target.value))} className="mt-1" />
          </label>
          <label className="text-xs font-medium">Seed
            <Input type="number" min={0} value={seed} onChange={(event) => setSeed(Number(event.target.value))} className="mt-1" />
          </label>
        </div>
        <label className="block text-xs font-medium">Optional operation instruction
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border bg-background p-2 text-sm" />
        </label>
        {evaluatorModel && [modelA, modelB].includes(evaluatorModel) && (
          <p className="flex items-center gap-2 text-xs text-amber-600"><AlertTriangle className="h-4 w-4" /> The evaluator is also a candidate model; results may be self-favoring.</p>
        )}
        <Button onClick={() => void start()} disabled={starting || !entityId || !operationAllowed || !modelA || !modelB || !evaluatorModel} className="gap-2">
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
        <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => void loadList()} className="gap-2"><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button></div>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : experiments.length === 0 ? <p className="text-sm text-muted-foreground">No experiments yet.</p> : (
          <div className="grid gap-2">{experiments.map((experiment) => (
            <button key={experiment._id} type="button" onClick={() => setSelectedId(experiment._id)} className="rounded-lg border p-3 text-left hover:bg-muted/50">
              <div className="flex justify-between gap-3"><span className="font-medium">{experiment.project_slug} · {experiment.config.operation}</span><span className={`text-xs ${statusClass(experiment.status)}`}>{label(experiment.status)}</span></div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{experiment.config.model_a} vs {experiment.config.model_b} · {experiment.config.repeat_count} paired trial(s)</p>
            </button>
          ))}</div>
        )}
          </div>
        )}
      </section>

      {detail && (
        <section className="space-y-5 rounded-xl border border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Results · {detail.experiment.project_slug}</h2>
              <p className="font-mono text-[11px] text-muted-foreground">Evidence {detail.experiment.evidence_hash}</p>
              <p className="font-mono text-[11px] text-muted-foreground">Suite {detail.experiment.config.evaluation_suite_id}@{detail.experiment.config.evaluation_suite_version} · prompt {detail.experiment.config.prompt_hash} · tools {detail.experiment.config.tool_contract_version}</p>
            </div>
            {["queued", "running", "evaluating"].includes(detail.experiment.status) && (
              <Button variant="destructive" size="sm" onClick={() => void stop()} disabled={stopping} className="gap-2">
                {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                {stopping ? "Stopping…" : "Stop evaluation"}
              </Button>
            )}
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
                  <p className="font-medium text-destructive">Evaluator failed for {evaluationErrors.length} candidate output{evaluationErrors.length === 1 ? "" : "s"}</p>
                  <p className="text-muted-foreground">
                    Radar charts, W/T/L, pass rate, and score statistics exclude failed judge calls. Winner selection is disabled for those outputs.
                  </p>
                </div>
              </div>
              <ul className="space-y-1 pl-6">
                {evaluationErrors.map((evaluation) => {
                  const model = detail.artifacts.find((artifact) => artifact._id === evaluation.artifact_id)?.model
                    ?? evaluation.blind_label;
                  return (
                    <li key={evaluation._id ?? evaluation.artifact_id} className="break-words">
                      <span className="font-mono">{model}</span>: {evaluation.error
                        || evaluation.blocking_findings[0]
                        || "Evaluator failed without an error message."}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div>
            <h3 className="font-medium">Run totals · all pages</h3>
            <p className="text-xs text-muted-foreground">Wins, pass rate, and scores include only completed judge calls. Cost and latency include every recorded call.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">{detail.aggregates.map((aggregate) => (
            <div key={aggregate.candidate} className="rounded-lg border p-3 text-sm"><h3 className="break-all font-mono text-xs font-medium">{aggregate.candidate === "a" ? detail.experiment.config.model_a : detail.experiment.config.model_b}</h3><p className="text-xs text-muted-foreground">W/T/L {aggregate.wins}/{aggregate.ties}/{aggregate.losses} · pass {aggregate.pass_rate === null ? "—" : `${(aggregate.pass_rate * 100).toFixed(0)}%`}</p><p className="text-xs text-muted-foreground">Mean {aggregate.mean_score?.toFixed(3) ?? "—"} · median {aggregate.median_score?.toFixed(3) ?? "—"} · variance {aggregate.variance?.toFixed(4) ?? "—"}</p><p className="text-xs text-muted-foreground">Generation ${aggregate.generation_cost_usd.toFixed(4)} · eval ${aggregate.evaluation_cost_usd.toFixed(4)} · ${aggregate.cost_per_supported_claim?.toFixed(4) ?? "—"}/supported claim</p><p className="text-xs text-muted-foreground">Median generation {aggregate.median_generation_latency_ms?.toFixed(0) ?? "—"} ms · evaluation {aggregate.median_evaluation_latency_ms?.toFixed(0) ?? "—"} ms</p></div>
          ))}</div>
          <div className="flex items-center gap-3"><label className="text-xs font-medium">Trial <select value={selectedTrial} onChange={(event) => setSelectedTrial(Number(event.target.value))} className="ml-2 h-8 rounded border bg-background px-2">{[...new Set(detail.artifacts.map((artifact) => artifact.trial))].map((trial) => <option key={trial}>{trial}</option>)}</select></label><select aria-label="Evaluation page" value={selectedPath ?? ""} onChange={(event) => setSelectedPath(event.target.value)} className="h-8 min-w-60 rounded border bg-background px-2 text-xs">{diffPaths.map((path) => <option key={path}>{path}</option>)}</select></div>
          {selectedPath && (
            <div className="space-y-3">
              <div>
                <h3 className="font-medium">Selected file · {selectedPath}</h3>
                <p className="text-xs text-muted-foreground">Claim, citation, grounding, safety, attribution, and confidence metrics are recalculated from this file&apos;s judge findings.</p>
              </div>
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
            const pageClaims = evaluation?.claims.filter((claim) => claim.page === selectedPath) ?? [];
            return (
              <div key={artifact._id} className="space-y-3 rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><h3 className="break-all font-mono text-xs font-medium">{artifact.model}</h3><span className={evaluation?.status === "passed" ? "shrink-0 text-xs text-emerald-600" : "shrink-0 text-xs text-destructive"}>{evaluation?.status ?? "not evaluated"}</span></div>
                {evaluation?.status === "error" && (
                  <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">
                    {evaluation.error || evaluation.blocking_findings[0] || "Evaluator failed without an error message."}
                  </p>
                )}
                <div className="max-h-48 overflow-auto text-xs">{pageView?.rubrics.filter((rubric) => rubric.enabled).map((rubric) => <div key={rubric.id} className="flex justify-between gap-3 border-b py-1"><span className="flex items-center gap-1.5">{RUBRIC_DEFINITIONS[rubric.id].label}<RubricInfo rubricId={rubric.id} /></span><span>{rubric.passed === null ? "telemetry" : rubric.passed ? "pass" : "fail"}{rubric.score !== undefined ? ` · ${rubric.score.toFixed(3)}` : rubric.rate !== undefined ? ` · ${(rubric.rate * 100).toFixed(0)}%` : rubric.count !== undefined ? ` · ${rubric.count}` : ""}</span></div>)}</div>
                <div className="max-h-48 space-y-2 overflow-auto">{pageClaims.filter((claim) => claim.classification !== "supported").map((claim) => <div key={claim.id} className="rounded bg-muted p-2 text-xs"><p className="font-medium">{claim.classification} · {claim.page}</p><p>&ldquo;{claim.exact_text}&rdquo;</p><p className="text-muted-foreground">{claim.reason}</p>{claim.citations.filter((citation) => /^https?:\/\//.test(citation)).map((citation) => <a key={citation} href={citation} target="_blank" rel="noreferrer" className="block truncate text-primary underline">{citation}</a>)}{claim.evidence.map((evidence) => <p key={evidence.evidence_item_id} className="truncate font-mono text-[10px] text-muted-foreground" title={evidence.canonical_uri}>{evidence.canonical_uri} · sha256:{evidence.content_hash}</p>)}</div>)}</div>
                <Button size="sm" variant="outline" disabled={Boolean(detail.experiment.promoted_run_id) || promoting !== null || !evaluation || evaluation.status === "error" || !["completed", "stopped_cost_ceiling", "stopped_by_user"].includes(detail.experiment.status)} onClick={() => void promote(artifact._id)} className="gap-2"><Trophy className="h-3.5 w-3.5" />{promoting === artifact._id ? "Copying…" : "Select winner for draft review"}</Button>
                {evaluation?.status === "error" && <p className="text-[11px] text-muted-foreground">Winner selection is unavailable because evaluation failed.</p>}
              </div>
            ); })}</div>
        </section>
      )}
    </div>
  );
}
