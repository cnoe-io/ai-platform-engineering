"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Gauge, Scale } from "lucide-react";

import { RubricInfo } from "@/components/tome/admin/RubricInfo";
import {
  buildExperimentDecisionView,
  CLAIM_OUTCOME_KEYS,
  type ClaimOutcomeKey,
  type DecisionHeatmapCell,
} from "@/lib/tome/experiment-decision";
import { QUICK_MAX_CLAIMS, isQuickEvaluation } from "@/lib/tome/experiment-mode";
import { isSelectedPageEvaluation } from "@/lib/tome/experiment-page-scope";
import { RUBRIC_DEFINITIONS } from "@/lib/tome/rubric-definitions";
import type {
  ArtifactEvaluation,
  ArtifactFileEvaluation,
  ExperimentAggregate,
  ExperimentArtifact,
  ExperimentCandidate,
  TomeExperiment,
} from "@/types/tome-evaluation";

interface ExperimentDecisionDashboardProps {
  experiment: TomeExperiment;
  artifacts: ExperimentArtifact[];
  evaluations: ArtifactEvaluation[];
  fileEvaluations: ArtifactFileEvaluation[];
  aggregates: ExperimentAggregate[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
}

const CLAIM_OUTCOME_META: Record<ClaimOutcomeKey, { label: string; className: string }> = {
  supported: { label: "Supported", className: "bg-emerald-500" },
  partially_supported: { label: "Partial", className: "bg-sky-500" },
  unsupported: { label: "Unsupported", className: "bg-amber-500" },
  contradicted: { label: "Contradicted", className: "bg-red-500" },
  unverifiable: { label: "Unverifiable", className: "bg-slate-500" },
};

const HEATMAP_LABELS = {
  claim_evidence: "Evidence",
  citation_coverage: "Citations",
  grounding: "Grounding",
  unsupported_claims: "Unsupported",
  contradictions: "Contradictions",
  attribution_integrity: "Attribution",
} as const;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function money(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function duration(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function candidateModel(experiment: TomeExperiment, candidate: ExperimentCandidate): string {
  return candidate === "a" ? experiment.config.model_a : experiment.config.model_b;
}

function CandidateMarker({ candidate }: { candidate: ExperimentCandidate }) {
  return (
    <span
      aria-hidden="true"
      className={candidate === "a"
        ? "inline-block h-2.5 w-2.5 rounded-full bg-primary"
        : "inline-block h-2.5 w-2.5 rotate-45 bg-amber-600 dark:bg-amber-400"}
    />
  );
}

function MetricBar({ value, className }: { value: number; className: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${clamp(value) * 100}%` }} />
    </div>
  );
}

function heatmapCellClass(cell: DecisionHeatmapCell): string {
  if (cell.leader === "a") return "border-primary/40 bg-primary/10 text-primary";
  if (cell.leader === "b") {
    return "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border bg-muted/50 text-muted-foreground";
}

function heatmapCellText(cell: DecisionHeatmapCell): string {
  if (cell.delta === null) return "—";
  if (cell.leader === "tie") return "≈";
  return `${cell.leader?.toUpperCase()} +${Math.abs(cell.delta * 100).toFixed(0)}`;
}

export function ExperimentDecisionDashboard({
  experiment,
  artifacts,
  evaluations,
  fileEvaluations,
  aggregates,
  selectedPath,
  onSelectPath,
}: ExperimentDecisionDashboardProps) {
  const view = useMemo(() => buildExperimentDecisionView({
    experiment,
    artifacts,
    evaluations,
    fileEvaluations,
  }), [artifacts, evaluations, experiment, fileEvaluations]);
  const recommendationBlocked = view.recommendation.title.includes("blocked");
  const maxCost = Math.max(0, ...aggregates.map((aggregate) =>
    aggregate.generation_cost_usd + aggregate.evaluation_cost_usd));
  const maxLatency = Math.max(0, ...aggregates.map((aggregate) =>
    (aggregate.median_generation_latency_ms ?? 0)
      + (aggregate.median_evaluation_latency_ms ?? 0)));
  const generatedPageCount = new Set(
    artifacts.flatMap((artifact) => artifact.pages.map((page) => page.path)),
  ).size;
  const selectedPageCount = experiment.config.evaluation_page_scope?.paths.length ?? 0;

  return (
    <div className="space-y-6" aria-label="Post-run decision dashboard">
      <section className="space-y-4 rounded-xl border bg-muted/20 p-4" aria-labelledby="decision-summary-title">
        {isSelectedPageEvaluation(experiment.config) && (
          <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs">
            <p className="font-medium text-sky-700 dark:text-sky-300">
              {isQuickEvaluation(experiment.config) ? "Quick evaluation" : "Selected-page evaluation"} · {selectedPageCount} of {generatedPageCount} generated pages
            </p>
            <p className="mt-1 text-muted-foreground">
              {isQuickEvaluation(experiment.config)
                ? `Scores use a bounded sample of up to ${QUICK_MAX_CLAIMS} material claims per page plus deterministic template, link, and stable-page checks. Run a deep or all-pages audit before promotion.`
                : "Page-level findings are comparable. Whole-project coverage and winner promotion are intentionally not assessed."}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {view.recommendation.candidate ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className={recommendationBlocked
                  ? "h-5 w-5 text-destructive"
                  : "h-5 w-5 text-amber-600"} />
              )}
              <h3 id="decision-summary-title" className="font-medium">Decision summary</h3>
            </div>
            <p className="mt-2 break-all text-lg font-semibold">{view.recommendation.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{view.recommendation.reason}</p>
          </div>
          <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium">
            {view.recommendation.evidenceLabel}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Artifact evaluations</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {view.completion.completeEvaluations}/{view.completion.expectedEvaluations}
            </p>
            <p className="text-[11px] text-muted-foreground">complete candidate results</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">File checkpoints</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {view.completion.totalFiles > 0
                ? `${view.completion.successfulFiles}/${view.completion.totalFiles}`
                : "Legacy run"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {view.completion.failedFiles} failed · {view.completion.runningFiles} running
            </p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Paired evidence</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {view.pairedTrials.length}/{experiment.config.repeat_count}
            </p>
            <p className="text-[11px] text-muted-foreground">comparable trials</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="text-xs text-muted-foreground">Evaluator</p>
            <p className="mt-1 text-sm font-semibold">
              {[experiment.config.model_a, experiment.config.model_b]
                .includes(experiment.config.evaluator_model)
                ? "Candidate overlap"
                : "Independent upper bound"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground" title={experiment.config.evaluator_model}>
              {experiment.config.evaluator_model}
            </p>
          </div>
        </div>
        {view.recommendation.blockers.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {view.recommendation.blockers.map((blocker) => (
              <li key={blocker} className="flex gap-2">
                <span aria-hidden="true">•</span><span>{blocker}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4 rounded-xl border p-4" aria-labelledby="paired-trials-title">
          <div>
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <h3 id="paired-trials-title" className="font-medium">Paired-trial quality</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Each row compares the same trial seed. Quality excludes cost and latency telemetry.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-2"><CandidateMarker candidate="a" /> Model A</span>
            <span className="flex items-center gap-2"><CandidateMarker candidate="b" /> Model B</span>
          </div>
          {view.pairedTrials.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
              No complete paired trials are available yet.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="ml-14 flex justify-between text-[10px] text-muted-foreground">
                <span>0</span><span>Quality score</span><span>100</span>
              </div>
              {view.pairedTrials.map((pair) => {
                const left = Math.min(clamp(pair.a), clamp(pair.b));
                const width = Math.max(Math.abs(clamp(pair.a) - clamp(pair.b)), 0.005);
                return (
                  <div key={pair.trial} className="grid grid-cols-[3rem_1fr] items-center gap-2 text-xs">
                    <span className="font-medium">Trial {pair.trial}</span>
                    <div>
                      <div className="relative h-6 rounded bg-muted/60">
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-muted-foreground/40"
                          style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                        />
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
                          style={{ left: `${clamp(pair.a) * 100}%` }}
                        />
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-amber-600 ring-2 ring-background dark:bg-amber-400"
                          style={{ left: `${clamp(pair.b) * 100}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        A {percent(pair.a)} · B {percent(pair.b)} · {pair.winner === "tie"
                          ? "tie"
                          : `${pair.winner.toUpperCase()} +${Math.abs(pair.delta * 100).toFixed(1)} points`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-xl border p-4" aria-labelledby="claim-outcomes-title">
          <div>
            <h3 id="claim-outcomes-title" className="font-medium">Claim outcomes</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Distribution across successful file results. Partial runs show preserved checkpoints.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {CLAIM_OUTCOME_KEYS.map((key) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-sm ${CLAIM_OUTCOME_META[key].className}`} />
                {CLAIM_OUTCOME_META[key].label}
              </span>
            ))}
          </div>
          <div className="space-y-5">
            {view.claimOutcomes.map((outcome) => (
              <div key={outcome.candidate} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <CandidateMarker candidate={outcome.candidate} />
                    <span className="truncate" title={outcome.model}>{outcome.model}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {outcome.total} claims
                  </span>
                </div>
                {outcome.total === 0 ? (
                  <div className="h-5 rounded bg-muted" />
                ) : (
                  <div
                    className="flex h-5 overflow-hidden rounded"
                    role="img"
                    aria-label={`${outcome.model}: ${CLAIM_OUTCOME_KEYS.map((key) =>
                      `${outcome.counts[key]} ${CLAIM_OUTCOME_META[key].label.toLowerCase()}`).join(", ")}`}
                  >
                    {CLAIM_OUTCOME_KEYS.map((key) => outcome.counts[key] > 0 && (
                      <span
                        key={key}
                        className={CLAIM_OUTCOME_META[key].className}
                        style={{ width: `${(outcome.counts[key] / outcome.total) * 100}%` }}
                        title={`${CLAIM_OUTCOME_META[key].label}: ${outcome.counts[key]}`}
                      />
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground sm:grid-cols-3">
                  {CLAIM_OUTCOME_KEYS.map((key) => (
                    <span key={key}>{CLAIM_OUTCOME_META[key].label} {outcome.counts[key]}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="space-y-4 rounded-xl border p-4" aria-labelledby="file-heatmap-title">
        <div>
          <h3 id="file-heatmap-title" className="font-medium">File quality differences</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Average normalized score lead across trials. Select a cell to inspect that file&apos;s
            diff, claims, citations, and rubric profile below.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-primary/40 bg-primary/10" /> A leads</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-amber-500/50 bg-amber-500/10" /> B leads</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border bg-muted/50" /> within 2.5 points</span>
        </div>
        {view.heatmap.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            File-level rubric comparisons are unavailable until claim evaluation checkpoints complete.
          </p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full min-w-[760px] border-collapse text-xs">
              <caption className="sr-only">Average model quality lead by file and rubric</caption>
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b">
                  <th className="sticky left-0 z-20 min-w-52 bg-background px-3 py-2 text-left font-medium">File</th>
                  {view.heatmap[0].cells.map((cell) => (
                    <th key={cell.rubricId} className="min-w-24 px-2 py-2 text-center font-medium">
                      <span className="inline-flex items-center gap-1">
                        {HEATMAP_LABELS[cell.rubricId as keyof typeof HEATMAP_LABELS]}
                        <RubricInfo rubricId={cell.rubricId} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.heatmap.map((row) => (
                  <tr key={row.path} className={row.path === selectedPath ? "bg-primary/5" : ""}>
                    <th className="sticky left-0 max-w-64 truncate border-b bg-background px-3 py-2 text-left font-mono text-[11px] font-medium" title={row.path}>
                      {row.path}
                    </th>
                    {row.cells.map((cell) => (
                      <td key={cell.rubricId} className="border-b p-1 text-center">
                        <button
                          type="button"
                          onClick={() => onSelectPath(row.path)}
                          className={`w-full rounded border px-2 py-1.5 text-[10px] font-medium tabular-nums hover:ring-2 hover:ring-ring ${heatmapCellClass(cell)}`}
                          aria-label={`${row.path}, ${RUBRIC_DEFINITIONS[cell.rubricId].label}: ${cell.a === null ? "Model A unavailable" : `Model A ${percent(cell.a)}`}, ${cell.b === null ? "Model B unavailable" : `Model B ${percent(cell.b)}`}`}
                          title={`A ${percent(cell.a)} · B ${percent(cell.b)}`}
                        >
                          {heatmapCellText(cell)}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border p-4" aria-labelledby="tradeoffs-title">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <h3 id="tradeoffs-title" className="font-medium">Quality, cost, and latency</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Bars compare this run only; exact values remain visible for operational decisions.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {aggregates.map((aggregate) => {
            const model = candidateModel(experiment, aggregate.candidate);
            const totalCost = aggregate.generation_cost_usd + aggregate.evaluation_cost_usd;
            const totalMedianLatency = (aggregate.median_generation_latency_ms ?? 0)
              + (aggregate.median_evaluation_latency_ms ?? 0);
            return (
              <div key={aggregate.candidate} className="space-y-4 rounded-lg border bg-background p-4">
                <h4 className="flex min-w-0 items-center gap-2 font-mono text-xs font-medium">
                  <CandidateMarker candidate={aggregate.candidate} />
                  <span className="truncate" title={model}>{model}</span>
                </h4>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs"><span>Mean quality</span><span className="tabular-nums">{percent(aggregate.mean_score)}</span></div>
                  <MetricBar value={aggregate.mean_score ?? 0} className={aggregate.candidate === "a" ? "bg-primary" : "bg-amber-500"} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs"><span className="flex items-center gap-1"><CircleDollarSign className="h-3.5 w-3.5" /> Total cost</span><span className="tabular-nums">{money(totalCost)}</span></div>
                  <MetricBar value={maxCost > 0 ? totalCost / maxCost : 0} className="bg-sky-500" />
                  <p className="text-[10px] text-muted-foreground">Generation {money(aggregate.generation_cost_usd)} · evaluation {money(aggregate.evaluation_cost_usd)} · {aggregate.cost_per_supported_claim === null ? "—" : money(aggregate.cost_per_supported_claim)}/supported claim</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs"><span>Median combined latency</span><span className="tabular-nums">{duration(totalMedianLatency || null)}</span></div>
                  <MetricBar value={maxLatency > 0 ? totalMedianLatency / maxLatency : 0} className="bg-violet-500" />
                  <p className="text-[10px] text-muted-foreground">Generation {duration(aggregate.median_generation_latency_ms)} · evaluation {duration(aggregate.median_evaluation_latency_ms)}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  W/T/L {aggregate.wins}/{aggregate.ties}/{aggregate.losses} · pass {percent(aggregate.pass_rate)} · variance {aggregate.variance?.toFixed(4) ?? "—"}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
