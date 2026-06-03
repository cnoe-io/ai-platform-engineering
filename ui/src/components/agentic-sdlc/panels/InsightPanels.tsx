"use client";

/**
 * Bundle of the Wave 2–4 insight panels.
 *
 * Each component is a thin renderer over the `/insights/{panel}` API,
 * wrapped in a CollapsiblePanel. Panels here are intentionally
 * compact; they all share the `useInsightsFetch` hook and the same
 * loading/error semantics.
 *
 * Co-locating them in one file makes the registry → component wiring
 * trivial in SectionRenderer without scattering 16 tiny files.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  AlertTriangle,
  Beaker,
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gauge,
  GitBranch,
  Lock,
  Loader2,
  Network,
  PieChart,
  Radar,
  Radio,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Workflow,
  Wrench,
} from "lucide-react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { useInsightsFetch } from "@/hooks/use-insights-fetch";
import type {
  AgentBudgetSummary,
  AgentRosterSummary,
  BlackboxAuditSummary,
  BlastRadiusSummary,
  FailureModesSummary,
  FanoutSummary,
  HarnessSummary,
  IntentDriftSummary,
  MistakeEncodedSummary,
  PrProdMetricSummary,
  ProdSignalSummary,
  ProvenanceSummary,
  QualityGate,
  QualityGauntletSummary,
  RollbackRehearsalSummary,
  VerifierConfidenceSummary,
} from "@/types/agentic-sdlc";

interface PanelProps {
  owner: string;
  repo: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function PanelShell({
  title,
  subtitle,
  icon,
  demo,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  demo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <CollapsiblePanel
      title={title}
      leading={icon}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{subtitle}</span>
          {demo && (
            <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-200">
              demo data
            </span>
          )}
        </span>
      }
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
    >
      {children}
    </CollapsiblePanel>
  );
}

function PanelStatus({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) {
    return (
      <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        Could not load data ({error}).
      </p>
    );
  }
  if (loading) {
    return (
      <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading…
      </p>
    );
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Intent drift                                                               */
/* -------------------------------------------------------------------------- */

export function IntentDriftPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<IntentDriftSummary>({
    owner,
    repo,
    panel: "intent-drift",
  });
  return (
    <PanelShell
      title="Intent drift"
      subtitle="Per-epic alignment between acceptance criteria and actual PR contents."
      icon={<Radar className="h-4 w-4 text-indigo-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="mt-1 space-y-1.5">
        {(data?.epics ?? []).slice(0, 8).map((epic) => {
          const align = Math.round((epic.alignment ?? 0) * 100);
          const beads = epic.beads ?? [];
          const tone =
            align >= 75 ? "text-emerald-300" : align >= 50 ? "text-amber-300" : "text-red-300";
          return (
            <li
              key={epic.epic_id}
              className="rounded-md border border-border/30 bg-background/30 px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <a
                  href={epic.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs font-medium text-foreground hover:text-primary"
                >
                  {epic.title}
                </a>
                <span className={`text-[11px] font-semibold ${tone}`}>
                  {align}%
                </span>
              </div>
              <div className="mt-1 flex items-end gap-0.5">
                {beads.length === 0 && (
                  <span className="text-[10px] text-muted-foreground/60">
                    no PRs yet
                  </span>
                )}
                {beads.map((b, i) => (
                  <span
                    key={i}
                    className={`inline-block w-1.5 rounded-sm ${
                      b >= 0.6
                        ? "bg-emerald-400/70"
                        : b >= 0.4
                          ? "bg-amber-400/70"
                          : "bg-red-400/70"
                    }`}
                    style={{ height: `${4 + b * 14}px` }}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Spec-Kit replay (mock, time-scrub)                                         */
/* -------------------------------------------------------------------------- */

export function SpecKitReplayPanel({ owner, repo }: PanelProps) {
  const fullName = `${owner}/${repo}`;
  return (
    <PanelShell
      title="Spec-Kit replay"
      subtitle={`Specify → Plan → Tasks → Implement timeline for ${fullName}.`}
      icon={<ScrollText className="h-4 w-4 text-indigo-300" aria-hidden />}
      demo
    >
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {["specify", "plan", "tasks", "implement"].map((phase, i) => (
            <div
              key={phase}
              className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
            >
              <p className="font-semibold text-foreground">{phase}</p>
              <p>3{i + 2} min</p>
              <p className="text-[9px] text-muted-foreground/70">
                {6 - i * 1} commits
              </p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2 py-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden />
          <span>Scrub</span>
          <input
            type="range"
            min={0}
            max={100}
            defaultValue={64}
            className="flex-1 accent-indigo-400"
            aria-label="Replay position"
          />
          <span>1×</span>
          <button
            type="button"
            className="rounded-sm border border-border/40 bg-background/40 px-1 text-[10px] hover:text-foreground"
          >
            2×
          </button>
          <button
            type="button"
            className="rounded-sm border border-border/40 bg-background/40 px-1 text-[10px] hover:text-foreground"
          >
            5×
          </button>
        </div>
      </div>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

export function HarnessPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<HarnessSummary>({
    owner,
    repo,
    panel: "harness",
  });
  return (
    <PanelShell
      title="Harness"
      subtitle="Linters · structural tests · ADRs · skills · policies · security scans."
      icon={<Wrench className="h-4 w-4 text-cyan-300" aria-hidden />}
    >
      <PanelStatus loading={loading && !data} error={error} />
      {data && (
        <>
          <div className="flex items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
            <Gauge className="h-4 w-4" aria-hidden />
            <span className="font-semibold">
              {Math.round((data.pass_rate ?? 0) * 100)}% harness pass rate
            </span>
            <span className="text-cyan-200/70">
              · {(data.rules ?? []).length} rules active
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {(data.rules ?? []).map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-background/30 px-2 py-1"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="rounded-sm border border-border/40 bg-background/40 px-1 text-[9px] uppercase text-muted-foreground">
                    {rule.kind}
                  </span>
                  <span className="truncate text-xs text-foreground">
                    {rule.name}
                  </span>
                </span>
                <span className="text-[11px] font-semibold text-cyan-200">
                  {Math.round(rule.pass_rate * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Mistake encoded                                                            */
/* -------------------------------------------------------------------------- */

export function MistakeEncodedPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<MistakeEncodedSummary>({
    owner,
    repo,
    panel: "mistake-encoded",
  });
  return (
    <PanelShell
      title="Mistake encoded"
      subtitle="Each pulse is an agent failure that produced a new rule, ADR, or test gate."
      icon={<Sparkles className="h-4 w-4 text-cyan-300" aria-hidden />}
    >
      <PanelStatus loading={loading && !data} error={error} />
      {data && (
        <>
          <p className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
            <span className="font-semibold">{data.learnings_24h ?? 0}</span> new
            rules encoded in the last 24h ·{" "}
            <span className="font-semibold">{data.total_learnings ?? 0}</span>{" "}
            lifetime.
          </p>
          <ul className="mt-2 space-y-1">
            {(data.events ?? []).slice(0, 8).map((ev) => (
              <li
                key={ev.id}
                className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 truncate text-xs text-foreground">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                    {ev.rule_added}
                  </span>
                  <span className="rounded-sm border border-border/40 bg-background/40 px-1 text-[9px] uppercase text-muted-foreground">
                    {ev.kind}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {ev.description}
                </p>
              </li>
            ))}
            {(data.events ?? []).length === 0 && (
              <li className="rounded-md border border-dashed border-border/40 bg-background/20 px-2 py-1.5 text-[11px] text-muted-foreground">
                No encoded mistakes yet.
              </li>
            )}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Agent roster                                                               */
/* -------------------------------------------------------------------------- */

export function AgentRosterPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<AgentRosterSummary>({
    owner,
    repo,
    panel: "agent-roster",
  });
  return (
    <PanelShell
      title="Agent roster"
      subtitle="Who is working on what, right now."
      icon={<Bot className="h-4 w-4 text-emerald-300" aria-hidden />}
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="space-y-1">
        {(data?.agents ?? []).length === 0 && (
          <li className="rounded-md border border-dashed border-border/40 bg-background/20 px-2 py-2 text-[11px] text-muted-foreground">
            No agents currently active.
          </li>
        )}
        {(data?.agents ?? []).map((agent) => (
          <li
            key={agent.agent_id}
            className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  agent.status === "active"
                    ? "animate-pulse bg-emerald-400"
                    : agent.status === "blocked"
                      ? "bg-red-400"
                      : "bg-muted-foreground/40"
                }`}
              />
              <span className="text-xs font-medium text-foreground">
                {agent.display_name}
              </span>
              <span className="rounded-sm border border-border/40 bg-background/40 px-1 text-[9px] uppercase text-muted-foreground">
                {agent.role}
              </span>
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {agent.current_artifact_title ?? "—"}
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Agent budget                                                               */
/* -------------------------------------------------------------------------- */

export function AgentBudgetPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<AgentBudgetSummary>({
    owner,
    repo,
    panel: "agent-budget",
  });
  return (
    <PanelShell
      title="Agent budget"
      subtitle="LLM tokens (M) per epic — builder compute vs reviewer/verifier, against estimate."
      icon={<Gauge className="h-4 w-4 text-emerald-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Compute tokens
              </p>
              <p className="text-foreground">
                {(data.totals?.actual_compute_tokens_m ?? 0).toFixed(1)} /{" "}
                {(data.totals?.estimated_compute_tokens_m ?? 0).toFixed(1)}{" "}
                <span className="text-muted-foreground">M</span>
              </p>
            </div>
            <div className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Review tokens
              </p>
              <p className="text-foreground">
                {(data.totals?.actual_review_tokens_m ?? 0).toFixed(1)} /{" "}
                {(data.totals?.estimated_review_tokens_m ?? 0).toFixed(1)}{" "}
                <span className="text-muted-foreground">M</span>
              </p>
            </div>
          </div>
          <ul className="mt-2 space-y-1">
            {(data.epics ?? []).slice(0, 6).map((e) => {
              const ratio = e.estimated_compute_tokens_m
                ? e.actual_compute_tokens_m / e.estimated_compute_tokens_m
                : 0;
              const pct = Math.min(140, Math.round(ratio * 100));
              const tone =
                e.status === "over"
                  ? "bg-red-400/70"
                  : e.status === "warning"
                    ? "bg-amber-400/70"
                    : "bg-emerald-400/70";
              return (
                <li
                  key={e.epic_id}
                  className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-foreground">{e.title}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {e.actual_compute_tokens_m.toFixed(1)}M /{" "}
                      {e.estimated_compute_tokens_m.toFixed(1)}M tokens
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background/60">
                    <div
                      className={`h-1.5 ${tone}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parallel fan-out                                                           */
/* -------------------------------------------------------------------------- */

export function ParallelFanoutPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<FanoutSummary>({
    owner,
    repo,
    panel: "fanout",
  });
  return (
    <PanelShell
      title="Parallel fan-out"
      subtitle="Parallel branches per epic and where they converge."
      icon={<Workflow className="h-4 w-4 text-emerald-300" aria-hidden />}
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="space-y-2">
        {(data?.epics ?? []).length === 0 && (
          <li className="rounded-md border border-dashed border-border/40 bg-background/20 px-2 py-2 text-[11px] text-muted-foreground">
            No multi-branch epics in flight.
          </li>
        )}
        {(data?.epics ?? []).slice(0, 6).map((epic) => (
          <li
            key={epic.epic_id}
            className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <a
                href={epic.github_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs font-medium text-foreground hover:text-primary"
              >
                {epic.title}
              </a>
              <span className="text-[10px] text-muted-foreground">
                {(epic.branches ?? []).length} branches
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
              {(epic.branches ?? []).map((b) => (
                <span
                  key={b.branch_id}
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${
                    b.status === "merged"
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                      : b.status === "abandoned"
                        ? "border-red-400/30 bg-red-500/10 text-red-200"
                        : "border-amber-400/30 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  <GitBranch className="h-2.5 w-2.5" aria-hidden /> {b.agent.replace("agent:", "")}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Verifier confidence                                                        */
/* -------------------------------------------------------------------------- */

export function VerifierConfidencePanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<VerifierConfidenceSummary>({
    owner,
    repo,
    panel: "verifier-confidence",
  });
  return (
    <PanelShell
      title="Verifier confidence"
      subtitle="Per-PR acceptance criteria coverage."
      icon={<ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      {data && (
        <p className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
          Median AC coverage:{" "}
          <span className="font-semibold">
            {Math.round((data.median_coverage ?? 0) * 100)}%
          </span>
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {(data?.entries ?? []).slice(0, 6).map((e) => {
          const pct = Math.round(e.coverage * 100);
          const tone =
            e.band === "strong"
              ? "bg-emerald-400/70"
              : e.band === "good"
                ? "bg-cyan-400/70"
                : e.band === "fair"
                  ? "bg-amber-400/70"
                  : "bg-red-400/70";
          return (
            <li
              key={e.artifact_id}
              className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <a
                  href={e.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-foreground hover:text-primary"
                >
                  {e.title}
                </a>
                <span className="text-[10px] text-muted-foreground">
                  {e.acceptance_criteria_covered}/{e.acceptance_criteria_total} AC
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background/60">
                <div
                  className={`h-1.5 ${tone}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Quality-gate gauntlet                                                      */
/* -------------------------------------------------------------------------- */

const GAUNTLET_LABEL: Record<QualityGate, string> = {
  lint: "Lint",
  unit: "Unit",
  integration: "Integration",
  sca: "SCA",
  security: "Security",
  policy: "Policy",
  architecture: "Architecture",
  human_review: "Human review",
};

export function QualityGauntletPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<QualityGauntletSummary>({
    owner,
    repo,
    panel: "quality-gauntlet",
  });
  return (
    <PanelShell
      title="Quality-gate gauntlet"
      subtitle="Each PR running through lint → unit → SCA → security → policy → review."
      icon={<Network className="h-4 w-4 text-cyan-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="space-y-2">
        {(data?.runs ?? []).map((run) => (
          <li
            key={run.artifact_id}
            className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <a
                href={run.github_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-foreground hover:text-primary"
              >
                {run.title}
              </a>
              <span
                className={`rounded-sm border px-1 text-[10px] ${
                  run.conclusion === "passed"
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                    : run.conclusion === "failed"
                      ? "border-red-400/30 bg-red-500/10 text-red-200"
                      : "border-amber-400/30 bg-amber-500/10 text-amber-200"
                }`}
              >
                {run.conclusion}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {(run.gates ?? []).map((g, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center rounded-sm border px-1 text-[9px] uppercase tracking-wide ${
                    g.state === "passed"
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                      : g.state === "failed"
                        ? "border-red-400/40 bg-red-500/15 text-red-200 animate-pulse"
                        : g.state === "skipped"
                          ? "border-border/40 bg-background/20 text-muted-foreground/60"
                          : "border-amber-400/30 bg-amber-500/10 text-amber-200"
                  }`}
                  title={`${GAUNTLET_LABEL[g.gate]} · ${g.state}`}
                >
                  {GAUNTLET_LABEL[g.gate]}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Failure modes donut                                                        */
/* -------------------------------------------------------------------------- */

export function FailureModesPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<FailureModesSummary>({
    owner,
    repo,
    panel: "failure-modes",
  });
  return (
    <PanelShell
      title="Failure modes (30d)"
      subtitle="Where agents fail most often."
      icon={<PieChart className="h-4 w-4 text-cyan-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      {data && (
        <div className="flex items-start gap-3">
          <Donut buckets={data.buckets ?? []} />
          <ul className="min-w-0 flex-1 space-y-1 text-[11px]">
            {(data.buckets ?? []).slice(0, 6).map((b) => (
              <li
                key={b.kind}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate text-foreground">{b.label}</span>
                <span className="text-muted-foreground">
                  {Math.round(b.share * 100)}%{" "}
                  <span className="text-muted-foreground/60">({b.count})</span>
                </span>
              </li>
            ))}
            {(data.buckets ?? []).length === 0 && (
              <li className="text-muted-foreground">No failures recorded.</li>
            )}
          </ul>
        </div>
      )}
    </PanelShell>
  );
}

function Donut({
  buckets,
}: {
  buckets: FailureModesSummary["buckets"];
}) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-border/40 text-[10px] text-muted-foreground">
        clean
      </div>
    );
  }
  const colours = [
    "#f87171", "#fbbf24", "#34d399", "#22d3ee", "#a78bfa", "#f472b6", "#94a3b8",
  ];
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden>
      <circle
        cx={40}
        cy={40}
        r={radius}
        strokeWidth={12}
        className="stroke-border/40"
        fill="none"
      />
      {buckets.map((b, i) => {
        const fraction = b.count / total;
        const length = fraction * circumference;
        const segment = (
          <circle
            key={b.kind}
            cx={40}
            cy={40}
            r={radius}
            strokeWidth={12}
            stroke={colours[i % colours.length]}
            fill="none"
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        );
        offset += length;
        return segment;
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Provenance / SBOM                                                          */
/* -------------------------------------------------------------------------- */

export function ProvenancePanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<ProvenanceSummary>({
    owner,
    repo,
    panel: "provenance",
  });
  return (
    <PanelShell
      title="Provenance / SBOM"
      subtitle="Signature, SLSA level, harness version, SBOM, re-audit window per agent artifact."
      icon={<Lock className="h-4 w-4 text-violet-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      {data && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
            {data.signed_count ?? 0} signed
          </span>
          <span className="rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-red-200">
            {data.unsigned_count ?? 0} unsigned
          </span>
          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
            {data.reaudit_due_count ?? 0} re-audit due
          </span>
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {(data?.records ?? []).slice(0, 8).map((r) => (
          <li
            key={r.artifact_id}
            className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <a
                href={r.github_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-foreground hover:text-primary"
              >
                {r.title}
              </a>
              <span className="rounded-sm border border-border/40 bg-background/40 px-1 text-[10px] text-muted-foreground">
                SLSA L{r.slsa_level}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {r.model.replace("agent:", "")} · {r.harness_version} · {r.sbom_hash} ·{" "}
              {r.signed ? (
                <span className="text-emerald-300">signed</span>
              ) : (
                <span className="text-red-300">unsigned</span>
              )}
              {r.reaudit_due_in_days !== null && (
                <span className="ml-1 text-amber-200">
                  · {r.reaudit_due_in_days <= 0
                    ? "re-audit due"
                    : `re-audit in ${r.reaudit_due_in_days}d`}
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Blast radius                                                               */
/* -------------------------------------------------------------------------- */

export function BlastRadiusPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<BlastRadiusSummary>({
    owner,
    repo,
    panel: "blast-radius",
  });
  return (
    <PanelShell
      title="Blast radius"
      subtitle="Pre-merge preview of services, DBs, and endpoints each PR touches."
      icon={<AlertTriangle className="h-4 w-4 text-violet-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="space-y-1.5">
        {(data?.reports ?? []).length === 0 && (
          <li className="rounded-md border border-dashed border-border/40 bg-background/20 px-2 py-2 text-[11px] text-muted-foreground">
            No open PRs.
          </li>
        )}
        {(data?.reports ?? []).slice(0, 6).map((r) => (
          <li
            key={r.artifact_id}
            className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <a
                href={r.github_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-foreground hover:text-primary"
              >
                {r.title}
              </a>
              <span
                className={`rounded-sm border px-1 text-[10px] ${
                  r.blast_percent >= 50
                    ? "border-red-400/30 bg-red-500/10 text-red-200"
                    : r.blast_percent >= 20
                      ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                      : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                {r.blast_percent}%
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {r.service_count} services · {r.database_count} DBs ·{" "}
              {r.endpoint_count} endpoints
            </p>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Rollback rehearsal                                                         */
/* -------------------------------------------------------------------------- */

export function RollbackRehearsalPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<RollbackRehearsalSummary>({
    owner,
    repo,
    panel: "rollback-rehearsal",
  });
  return (
    <PanelShell
      title="Rollback rehearsal"
      subtitle="When each environment last exercised its rollback path."
      icon={<Beaker className="h-4 w-4 text-violet-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="space-y-1">
        {(data?.entries ?? []).map((e) => (
          <li
            key={e.environment}
            className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-background/30 px-2 py-1.5 text-xs"
          >
            <span className="font-medium text-foreground">{e.environment}</span>
            <span
              className={`rounded-sm border px-1 text-[10px] ${
                e.status === "fresh"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                  : e.status === "stale"
                    ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                    : "border-red-400/30 bg-red-500/10 text-red-200"
              }`}
            >
              {e.status}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {e.last_exercised_at
                ? new Date(e.last_exercised_at).toLocaleDateString()
                : "never"}
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Prod signal → spec                                                         */
/* -------------------------------------------------------------------------- */

export function ProdSignalPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<ProdSignalSummary>({
    owner,
    repo,
    panel: "prod-signals",
  });
  return (
    <PanelShell
      title="Prod signal → spec"
      subtitle="Production signals flow back to create the next epic."
      icon={<Radio className="h-4 w-4 text-amber-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="space-y-1.5">
        {(data?.events ?? []).map((ev) => (
          <li
            key={ev.id}
            className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
            draggable
            data-signal-id={ev.id}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-2 truncate">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    ev.severity === "critical"
                      ? "animate-pulse bg-red-400"
                      : ev.severity === "warning"
                        ? "bg-amber-400"
                        : "bg-muted-foreground/50"
                  }`}
                />
                <span className="truncate text-foreground">{ev.title}</span>
              </span>
              <span className="rounded-sm border border-border/40 bg-background/40 px-1 text-[9px] uppercase text-muted-foreground">
                {ev.source}
              </span>
            </div>
            {ev.body && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {ev.body}
              </p>
            )}
            {ev.proposed_epic_title && (
              <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary/90">
                <ExternalLink className="h-2.5 w-2.5" aria-hidden /> Create epic:{" "}
                <span className="text-foreground">{ev.proposed_epic_title}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* PR prod sparkline                                                          */
/* -------------------------------------------------------------------------- */

export function PrProdSparklinePanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<PrProdMetricSummary>({
    owner,
    repo,
    panel: "pr-prod-metrics",
  });
  return (
    <PanelShell
      title="Prod metric per PR"
      subtitle="24h latency / error / cost per merged PR."
      icon={<CheckCircle2 className="h-4 w-4 text-amber-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      <ul className="space-y-1.5">
        {(data?.prs ?? []).slice(0, 6).map((p) => (
          <li
            key={p.artifact_id}
            className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <a
                href={p.github_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-foreground hover:text-primary"
              >
                {p.title}
              </a>
              <span
                className={`text-[10px] ${
                  p.delta_percent < 0
                    ? "text-emerald-300"
                    : p.delta_percent > 0
                      ? "text-red-300"
                      : "text-muted-foreground"
                }`}
              >
                {p.delta_percent > 0 ? "+" : ""}
                {(p.delta_percent * 100).toFixed(1)}% Δ
              </span>
            </div>
            <Sparkline values={p.values ?? []} metric={p.metric} />
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

function Sparkline({
  values,
  metric,
}: {
  values: number[];
  metric: string;
}) {
  if (!values.length) {
    return (
      <p className="mt-1 text-[10px] text-muted-foreground/60">no samples yet</p>
    );
  }
  const max = Math.max(...values, 1);
  return (
    <svg viewBox={`0 0 ${values.length} 30`} className="mt-1 h-6 w-full" aria-label={metric}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="text-amber-300"
        points={values
          .map((v, i) => `${i},${30 - (v / max) * 28}`)
          .join(" ")}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Blackbox audit                                                             */
/* -------------------------------------------------------------------------- */

export function BlackboxAuditPanel({ owner, repo }: PanelProps) {
  const { data, loading, error } = useInsightsFetch<BlackboxAuditSummary>({
    owner,
    repo,
    panel: "blackbox-audit",
  });
  return (
    <PanelShell
      title="Blackbox audit"
      subtitle="Human vs agent authorship per merged PR, with re-audit reminders."
      icon={<Bot className="h-4 w-4 text-cyan-300" aria-hidden />}
      demo
    >
      <PanelStatus loading={loading && !data} error={error} />
      {data && (
        <p className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
          {(data.total_agent_lines ?? 0).toLocaleString()} agent lines ·{" "}
          {(data.total_human_lines ?? 0).toLocaleString()} human lines ·{" "}
          <span className="font-semibold">{data.overdue_count ?? 0}</span> overdue
          re-audits
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {(data?.entries ?? []).slice(0, 8).map((e) => (
          <li
            key={e.artifact_id}
            className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <a
                href={e.github_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-foreground hover:text-primary"
              >
                {e.title}
              </a>
              <span className="text-[10px] text-muted-foreground">
                agent {Math.round(e.agent_share * 100)}%
              </span>
            </div>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-background/60">
              <div
                className="bg-cyan-400/80"
                style={{ width: `${e.agent_share * 100}%` }}
              />
              <div
                className="bg-emerald-400/80"
                style={{ width: `${(1 - e.agent_share) * 100}%` }}
              />
            </div>
            {e.reaudit_overdue && (
              <p className="mt-0.5 text-[10px] text-amber-200">re-audit overdue</p>
            )}
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
