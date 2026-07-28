"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  HeartPulse,
  Layers,
  Loader2,
  RefreshCw,
  ThumbsUp,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration, formatTimeAgo, formatTokens } from "@/lib/tome/format";

// Palette kept local (not shared with PrometheusCharts.tsx, which is tightly
// coupled to usePrometheusQuery) — these charts render our own Mongo/Prom
// aggregates fetched via /api/tome/admin/analytics instead.
const TREND_COLORS = {
  adoption: "hsl(210, 90%, 55%)", // blue
  positive: "hsl(145, 65%, 45%)", // green
  negative: "hsl(0, 75%, 60%)", // red
  ingest: "hsl(270, 75%, 60%)", // purple
  performance: "hsl(35, 95%, 55%)", // orange
  uptime: "hsl(173, 80%, 40%)", // teal
};

/**
 * Org-wide TOME consumption: which projects are actively ingesting, and how
 * big each project's wiki is. Chat engagement is deliberately NOT shown here
 * — it stays per-project (see EngagementPanel), so this view never becomes a
 * cross-project "who's chatting" roster.
 */

interface Adoption {
  dau: number;
  mau: number;
  ratio: number | null;
  windowDays: number;
}

interface Freshness {
  positive: number;
  negative: number;
  total: number;
  satisfactionRate: number | null;
  windowDays: number;
}

interface Performance {
  p95Seconds: number | null;
  configured: boolean;
  status?: "measured" | "not_configured" | "no_data" | "query_failed";
  targetSeconds: number;
}

interface Uptime {
  uptimePct: number | null;
  processUptimeSeconds: number | null;
  coveragePct?: number | null;
  configured: boolean;
  status?: "measured" | "collecting" | "not_configured" | "no_data" | "query_failed";
  windowHours: number;
  targetPct: number;
}

interface LeadershipKpis {
  windowDays: number;
  coverage: { eligibleProjects: number; stewardedProjects: number; sourcedProjects: number };
  activity: { activeProjects: number; dormantProjects: number };
  engagement: { sessions: number; messages: number; repeatUsers: number };
  sourceHealth: { fresh: number; aging: number; stale: number; never: number };
  bhag: { count: number; childProjects: number; fresh: number; aging: number; stale: number; never: number };
  hierarchy: {
    bhags: number;
    areas: number;
    projects: number;
    bhagAreaRelations: number;
    bhagProjectRelations: number;
    areaProjectRelations: number;
  };
  onboarding: { totalProjects: number; addedInWindow: number };
  wikiMaturity: { realWikis: number; greenfieldOnly: number; emptyShells: number };
  ingestReliability: { succeeded: number; failed: number; successRate: number | null };
  cost: { totalUsd: number; perActiveProjectUsd: number | null; measuredRuns: number; terminalRuns: number };
  projectEngagement: Array<{ projectId: string; slug: string; name: string; sessions: number; messages: number; repeatUsers: number }>;
  bhagBreakdown: Array<{ projectId: string; slug: string; name: string; directProjects: number; areas: number; areaProjects: number }>;
}

interface ConsumptionRow {
  projectId: string;
  slug: string;
  title: string;
  teamName?: string;
  pageCount: number;
  wikiSizeBytes: number;
  lastIngestedAt: string | null;
  activeIngest: { status: "queued" | "running"; mode: "ingest" | "bhag_rollup" } | null;
  ingestRunsSucceeded: number;
  tokenUsage: { input: number; output: number };
}

interface Totals {
  projectCount: number;
  activeIngestCount: number;
  totalPages: number;
  totalWikiSizeBytes: number;
  totalTokens: number;
}

interface DailyPoint {
  date: string;
  value: number;
}

interface FreshnessDailyPoint {
  date: string;
  positive: number;
  negative: number;
  satisfactionRate: number | null;
}

interface IngestActivityDailyPoint {
  date: string;
  runs: number;
  tokens: number;
}

interface PerformanceDailyPoint {
  date: string;
  p95Seconds: number | null;
}

interface UptimeDailyPoint {
  date: string;
  uptimePct: number | null;
}

interface Trends {
  adoption: DailyPoint[];
  freshness: FreshnessDailyPoint[];
  ingestActivity: IngestActivityDailyPoint[];
  performance: { points: PerformanceDailyPoint[]; configured: boolean };
  uptime: { points: UptimeDailyPoint[]; configured: boolean };
  onboarding: DailyPoint[];
}

function formatUsd(value: number | null | undefined): string {
  return value === null || value === undefined ? "not measured" : `$${value.toFixed(4)}`;
}

/** "2026-07-15" -> "Jul 15". Also accepts full ISO timestamps (performance trend). */
function formatDayLabel(dateStr: string | number): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  /** Already display-formatted (e.g. via `formatDayLabel` or a full locale string). */
  label?: string;
  rows: Array<{ name: string; value: string; color: string }>;
}) {
  if (!active) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label ?? ""}</p>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
            {r.name}
          </span>
          <span className="font-medium tabular-nums text-popover-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function TrendCard({
  title,
  icon,
  description,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  description?: string;
  /** When set, renders this instead of `children` (e.g. "Prometheus not configured"). */
  empty?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </div>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">
        {empty ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
        {title}
        {icon}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

type KpiPassState = "pass" | "fail" | "unknown";

const KPI_STATE_STYLES: Record<KpiPassState, { icon: typeof CheckCircle2; color: string }> = {
  pass: { icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400" },
  fail: { icon: XCircle, color: "text-red-600 dark:text-red-400" },
  unknown: { icon: AlertCircle, color: "text-muted-foreground" },
};

function KpiCard({
  title,
  icon,
  value,
  target,
  state,
  detail,
  tooltip,
}: {
  title: string;
  icon: React.ReactNode;
  /** Big number, e.g. "62%" or "7.8s" or "not measured". */
  value: string;
  /** e.g. "Target: >80% MAU" */
  target: string;
  state: KpiPassState;
  /** Small line under the value, e.g. "41 DAU / 66 MAU". */
  detail?: string;
  /** Explains data source / caveats — rendered as a hover tooltip. */
  tooltip?: string;
}) {
  const cfg = KPI_STATE_STYLES[state];
  const Icon = cfg.icon;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        {tooltip ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground/60" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        <Icon className={cn("h-4 w-4 shrink-0", cfg.color)} />
      </div>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      <p className="mt-1 text-[11px] text-muted-foreground/75">{target}</p>
    </div>
  );
}

function IngestBadge({ activeIngest }: { activeIngest: ConsumptionRow["activeIngest"] }) {
  if (!activeIngest) return <span className="text-muted-foreground">Idle</span>;
  const label = activeIngest.mode === "bhag_rollup" ? "Synthesizing" : "Ingesting";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
        activeIngest.status === "running"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      {label}
    </span>
  );
}

export function TomeAnalyticsTab() {
  const [rows, setRows] = useState<ConsumptionRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [adoption, setAdoption] = useState<Adoption | null>(null);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [uptime, setUptime] = useState<Uptime | null>(null);
  const [leadership, setLeadership] = useState<LeadershipKpis | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tome/admin/analytics");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Failed to load (${res.status})`);
      setRows(body?.data?.projects ?? []);
      setTotals(body?.data?.totals ?? null);
      setAdoption(body?.data?.adoption ?? null);
      setFreshness(body?.data?.freshness ?? null);
      setPerformance(body?.data?.performance ?? null);
      setUptime(body?.data?.uptime ?? null);
      setLeadership(body?.data?.leadership ?? null);
      setTrends(body?.data?.trends ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const adoptionPct = adoption?.ratio !== null && adoption?.ratio !== undefined ? adoption.ratio * 100 : null;
  const adoptionState: KpiPassState = adoptionPct === null ? "unknown" : adoptionPct >= 80 ? "pass" : "fail";

  const freshnessPct =
    freshness?.satisfactionRate !== null && freshness?.satisfactionRate !== undefined
      ? freshness.satisfactionRate * 100
      : null;
  // No hard pass/fail bar — the deck marks the exact rubric "(ask team)", so
  // this is directional only: "unknown" once there's no feedback yet.
  const freshnessState: KpiPassState = "unknown";

  const performanceState: KpiPassState =
    !performance?.configured || performance?.p95Seconds === null
      ? "unknown"
      : performance.p95Seconds <= performance.targetSeconds
        ? "pass"
        : "fail";

  const uptimeState: KpiPassState =
    !uptime?.configured || uptime?.status === "collecting" || uptime?.uptimePct === null
      ? "unknown"
      : uptime.uptimePct >= uptime.targetPct
        ? "pass"
        : "fail";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Gauge className="h-5 w-5" />
            TOME KPIs
          </h3>
          <p className="text-sm text-muted-foreground">
            Real aggregates for adoption, coverage, engagement, source health, performance, and uptime.
          </p>
        </div>
        <Link
          href="/admin?cat=insights&tab=feedback&dateRange=30d"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          View feedback
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Adoption"
          icon={<Users className="h-4 w-4" />}
          value={adoptionPct !== null ? `${adoptionPct.toFixed(0)}%` : "no data"}
          detail={adoption ? `${adoption.dau} DAU / ${adoption.mau} MAU (${adoption.windowDays}d)` : undefined}
          target="Target: >80% DAU/MAU"
          state={adoptionState}
          tooltip="DAU = distinct users with a chat message in the trailing 24h. MAU = trailing 30 days. Both are rolling windows ending now, not calendar-day buckets."
        />
        <KpiCard
          title="Feedback satisfaction"
          icon={<ThumbsUp className="h-4 w-4" />}
          value={freshnessPct !== null ? `${freshnessPct.toFixed(0)}%` : "no data"}
          detail={freshness ? `${freshness.positive} 👍 / ${freshness.negative} 👎 (${freshness.windowDays}d)` : undefined}
          target="Directional proxy — no pass/fail target"
          state={freshnessState}
          tooltip="Thumbs-up rate on TOME chat responses. This is user satisfaction, not content freshness. The 12-Midnight freshness rubric is not implemented yet."
        />
        <KpiCard
          title="Performance"
          icon={<Activity className="h-4 w-4" />}
          value={performance?.p95Seconds !== null && performance?.p95Seconds !== undefined ? `${performance.p95Seconds.toFixed(1)}s` : "not measured"}
          detail={
            performance?.status === "no_data"
              ? "Prometheus connected; no TOME latency samples"
              : performance?.status === "query_failed"
                ? "Prometheus query failed"
                : performance
                  ? "p95 chat query latency"
                  : undefined
          }
          target={`Target: p95 <${performance?.targetSeconds ?? 10}s`}
          state={performanceState}
          tooltip={
            performance?.configured
              ? "p95 of tome-agent's end-to-end chat run duration (tome_agent_run_duration_seconds{kind=\"chat\"}), queried from Prometheus over the trailing 1h."
              : "Prometheus is not configured for this UI service (set PROMETHEUS_URL) — performance can't be measured yet."
          }
        />
        <KpiCard
          title="Uptime"
          icon={<HeartPulse className="h-4 w-4" />}
          value={uptime?.uptimePct !== null && uptime?.uptimePct !== undefined ? `${uptime.uptimePct.toFixed(1)}%` : "not measured"}
          detail={
            uptime?.status === "no_data"
              ? "Prometheus connected; TOME target not scraped"
              : uptime?.status === "collecting"
                ? `Collecting ${uptime.windowHours}h baseline (${Math.min(uptime.coveragePct ?? 0, 100).toFixed(0)}% covered)`
              : uptime?.status === "query_failed"
                ? "Prometheus query failed"
                : uptime?.configured
              ? `Process up ${formatDuration(uptime.processUptimeSeconds)} (${uptime.windowHours}h window)`
                : undefined
          }
          target={`Target: >${uptime?.targetPct ?? 99.9}% availability`}
          state={uptimeState}
          tooltip={
            uptime?.configured
              ? "Service availability from Prometheus: the percentage of the trailing window where at least one tome-agent replica was reachable. \"Process up\" is the youngest replica uptime, so a low value without an availability drop usually means a deploy, not an outage."
              : "Prometheus is not configured for this UI service (set PROMETHEUS_URL) — uptime can't be measured yet."
          }
        />
      </div>

      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Database className="h-5 w-5" />
          Platform coverage and health
        </h3>
        <p className="text-sm text-muted-foreground">
          Aggregate-only metrics across active direct-source projects; BHAGs are tracked separately as synthesized rollups.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Project coverage"
          icon={<FileText className="h-4 w-4" />}
          value={leadership ? `${leadership.coverage.stewardedProjects}/${leadership.coverage.eligibleProjects}` : "no data"}
          detail={leadership ? `${leadership.coverage.sourcedProjects}/${leadership.coverage.eligibleProjects} with connected sources` : undefined}
          target="Data steward coverage / source coverage"
          state="unknown"
          tooltip="Active direct-source projects only. Synthesized BHAGs and Areas have no direct connectors and are excluded."
        />
        <KpiCard
          title="Active projects"
          icon={<Activity className="h-4 w-4" />}
          value={leadership ? String(leadership.activity.activeProjects) : "no data"}
          detail={leadership ? `${leadership.activity.dormantProjects} dormant (${leadership.windowDays}d)` : undefined}
          target="Chat session or successful ingest in trailing 30 days"
          state="unknown"
          tooltip="Project activity is a real session or successful ingest signal, not an inferred usage score."
        />
        <KpiCard
          title="Engagement depth"
          icon={<Users className="h-4 w-4" />}
          value={leadership ? String(leadership.engagement.sessions) : "no data"}
          detail={leadership ? `${leadership.engagement.messages} messages · ${leadership.engagement.repeatUsers} repeat users` : undefined}
          target="Aggregate chat sessions in trailing 30 days"
          state="unknown"
          tooltip="Only aggregate session, message, and repeat-user counts are shown; no user identities are returned."
        />
        <KpiCard
          title="Source health"
          icon={<RefreshCw className="h-4 w-4" />}
          value={leadership ? `${leadership.sourceHealth.fresh} fresh` : "no data"}
          detail={leadership ? `${leadership.sourceHealth.aging} aging · ${leadership.sourceHealth.stale} stale · ${leadership.sourceHealth.never} never` : undefined}
          target="Fresh ≤7d · aging ≤30d · stale >30d"
          state={leadership?.sourceHealth.stale ? "fail" : leadership ? "pass" : "unknown"}
          tooltip="Uses the most recent source-activity event or successful ingest for each active direct-source project."
        />
        <KpiCard
          title="Projects onboarded"
          icon={<TrendingUp className="h-4 w-4" />}
          value={leadership ? String(leadership.onboarding.totalProjects) : "no data"}
          detail={leadership ? `${leadership.onboarding.addedInWindow} added in ${leadership.windowDays}d` : undefined}
          target="Active direct projects"
          state="unknown"
          tooltip="A project is counted when it is active, not a BHAG or Area, and has a creation timestamp in the configured project record."
        />
        <KpiCard
          title="Wiki maturity"
          icon={<FileText className="h-4 w-4" />}
          value={leadership ? `${leadership.wikiMaturity.realWikis} real` : "no data"}
          detail={leadership ? `${leadership.wikiMaturity.greenfieldOnly} greenfield-only · ${leadership.wikiMaturity.emptyShells} empty shell` : undefined}
          target="Successful non-greenfield source ingest"
          state={leadership?.wikiMaturity.emptyShells ? "unknown" : leadership ? "pass" : "unknown"}
          tooltip="Real means the project completed at least one successful non-greenfield source ingest. Greenfield-only projects have only their initial ingest; empty shells have no successful source ingest."
        />
        <KpiCard
          title="Ingest success rate"
          icon={<CheckCircle2 className="h-4 w-4" />}
          value={leadership?.ingestReliability.successRate !== null && leadership?.ingestReliability.successRate !== undefined ? `${(leadership.ingestReliability.successRate * 100).toFixed(0)}%` : "no data"}
          detail={leadership ? `${leadership.ingestReliability.succeeded} succeeded · ${leadership.ingestReliability.failed} failed (${leadership.windowDays}d)` : undefined}
          target="Terminal source ingests; synthesis excluded"
          state={leadership?.ingestReliability.successRate === null || leadership?.ingestReliability.successRate === undefined ? "unknown" : leadership.ingestReliability.successRate >= 0.95 ? "pass" : "fail"}
          tooltip="Uses only terminal source-ingest runs in the trailing window. Queued, running, awaiting-review, and /synthesize runs are excluded."
        />
        <KpiCard
          title="Cost per active project"
          icon={<Gauge className="h-4 w-4" />}
          value={formatUsd(leadership?.cost.perActiveProjectUsd)}
          detail={leadership ? `${formatUsd(leadership.cost.totalUsd)} across ${leadership.cost.measuredRuns}/${leadership.cost.terminalRuns} cost-measured terminal runs` : undefined}
          target="Agent-reported USD / active projects"
          state={leadership?.cost.measuredRuns ? "unknown" : "unknown"}
          tooltip="Only runs with an agent-reported final USD cost are included. Historical or provider runs without a cost remain unmeasured and are never treated as $0."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard
          title="Tome hierarchy"
          icon={<Layers className="h-4 w-4" />}
          value={leadership ? `${leadership.hierarchy.bhags} / ${leadership.hierarchy.areas} / ${leadership.hierarchy.projects}` : "no data"}
          detail={
            leadership
              ? `${leadership.hierarchy.bhagAreaRelations} BHAG→Area · ${leadership.hierarchy.bhagProjectRelations} BHAG→Project · ${leadership.hierarchy.areaProjectRelations} Area→Project`
              : undefined
          }
          target="BHAGs / Areas / direct projects and their label relationships"
          state="unknown"
          tooltip="Counts active entities and their hierarchy labels. Both stable slugs and legacy display-name labels are recognized."
        />
        <KpiCard
          title="BHAG rollups"
          icon={<TrendingUp className="h-4 w-4" />}
          value={leadership ? String(leadership.bhag.count) : "no data"}
          detail={leadership ? `${leadership.bhag.childProjects} child projects` : undefined}
          target="Strategic goals with labelled child projects"
          state="unknown"
          tooltip="A child project is counted when its initiative label matches the BHAG slug."
        />
        <KpiCard
          title="BHAG synthesis freshness"
          icon={<RefreshCw className="h-4 w-4" />}
          value={leadership ? `${leadership.bhag.fresh} fresh` : "no data"}
          detail={leadership ? `${leadership.bhag.aging} aging · ${leadership.bhag.stale} stale · ${leadership.bhag.never} never` : undefined}
          target="Latest successful BHAG synthesis"
          state={leadership?.bhag.stale || leadership?.bhag.never ? "fail" : leadership ? "pass" : "unknown"}
          tooltip="A BHAG's health is based on successful /synthesize runs only; a goal without one is shown as never synthesized."
        />
      </div>

      {leadership && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4" />
              Per-project engagement
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">Sessions, messages, and repeat users in the trailing {leadership.windowDays} days.</p>
            <div className="mt-3 space-y-2">
              {leadership.projectEngagement.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active direct projects.</p>
              ) : leadership.projectEngagement.map((project) => (
                <div key={project.projectId} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{project.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{project.sessions} sessions · {project.messages} messages · {project.repeatUsers} repeat</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4" />
              BHAG child-project breakdown
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">Direct children and projects reached through child Areas.</p>
            <div className="mt-3 space-y-2">
              {leadership.bhagBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active BHAGs.</p>
              ) : leadership.bhagBreakdown.map((bhag) => (
                <div key={bhag.projectId} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{bhag.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{bhag.directProjects} direct · {bhag.areas} Areas · {bhag.areaProjects} via Areas</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <TrendingUp className="h-5 w-5" />
          Trends
        </h3>
        <p className="text-sm text-muted-foreground">Last 30 days (7 days for query latency).</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TrendCard
          title="Daily active users"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          description="Distinct users with a TOME chat message, per day."
          empty={!trends || trends.adoption.every((p) => p.value === 0) ? "No chat activity in this window yet." : undefined}
        >
          {trends && (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends.adoption} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <RechartsTooltip
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      active={active}
                      label={label ? formatDayLabel(label) : undefined}
                      rows={[{ name: "Active users", value: String(payload?.[0]?.value ?? 0), color: TREND_COLORS.adoption }]}
                    />
                  )}
                />
                <Area type="monotone" dataKey="value" stroke={TREND_COLORS.adoption} fill={TREND_COLORS.adoption} fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </TrendCard>

        <TrendCard
          title="Project growth"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          description="Active direct projects created per day."
          empty={!trends || trends.onboarding.every((p) => p.value === 0) ? "No projects onboarded in this window yet." : undefined}
        >
          {trends && (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends.onboarding} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <RechartsTooltip
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      active={active}
                      label={label ? formatDayLabel(label) : undefined}
                      rows={[{ name: "Projects onboarded", value: String(payload?.[0]?.value ?? 0), color: TREND_COLORS.adoption }]}
                    />
                  )}
                />
                <Area type="monotone" dataKey="value" stroke={TREND_COLORS.adoption} fill={TREND_COLORS.adoption} fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </TrendCard>

        <TrendCard
          title="Chat feedback satisfaction"
          icon={<ThumbsUp className="h-4 w-4 text-muted-foreground" />}
          description="👍/👎 satisfaction feedback on TOME chat responses, per day."
          empty={!trends || trends.freshness.every((p) => p.positive + p.negative === 0) ? "No feedback recorded in this window yet." : undefined}
        >
          {trends && (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={trends.freshness} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <RechartsTooltip
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      active={active}
                      label={label ? formatDayLabel(label) : undefined}
                      rows={[
                        { name: "👍 Positive", value: String(payload?.find((p) => p.dataKey === "positive")?.value ?? 0), color: TREND_COLORS.positive },
                        { name: "👎 Negative", value: String(payload?.find((p) => p.dataKey === "negative")?.value ?? 0), color: TREND_COLORS.negative },
                      ]}
                    />
                  )}
                />
                <Bar dataKey="positive" stackId="feedback" fill={TREND_COLORS.positive} radius={[2, 2, 0, 0]} />
                <Bar dataKey="negative" stackId="feedback" fill={TREND_COLORS.negative} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </TrendCard>

        <TrendCard
          title="Ingest activity"
          icon={<Database className="h-4 w-4 text-muted-foreground" />}
          description="Succeeded ingest runs per day, across all projects."
          empty={!trends || trends.ingestActivity.every((p) => p.runs === 0) ? "No ingest runs completed in this window yet." : undefined}
        >
          {trends && (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends.ingestActivity} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <RechartsTooltip
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      active={active}
                      label={label ? formatDayLabel(label) : undefined}
                      rows={[
                        { name: "Runs", value: String(payload?.[0]?.payload?.runs ?? 0), color: TREND_COLORS.ingest },
                        { name: "Tokens", value: formatTokens(payload?.[0]?.payload?.tokens ?? 0), color: TREND_COLORS.ingest },
                      ]}
                    />
                  )}
                />
                <Area type="monotone" dataKey="runs" stroke={TREND_COLORS.ingest} fill={TREND_COLORS.ingest} fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </TrendCard>

        <TrendCard
          title="Query latency (p95)"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          description="p95 end-to-end TOME chat response time, from Prometheus."
          empty={
            !trends
              ? undefined
              : !trends.performance.configured
                ? "Prometheus not configured (set PROMETHEUS_URL)."
                : trends.performance.points.length === 0
                  ? "No latency samples in this window yet."
                  : undefined
          }
        >
          {trends && trends.performance.configured && trends.performance.points.length > 0 && (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends.performance.points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })}
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11 }} width={28} tickFormatter={(v: number) => `${v}s`} />
                <RechartsTooltip
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      active={active}
                      label={label ? new Date(label).toLocaleString() : undefined}
                      rows={[{ name: "p95", value: payload?.[0]?.value != null ? `${Number(payload[0].value).toFixed(1)}s` : "—", color: TREND_COLORS.performance }]}
                    />
                  )}
                />
                <Area type="monotone" dataKey="p95Seconds" stroke={TREND_COLORS.performance} fill={TREND_COLORS.performance} fillOpacity={0.15} strokeWidth={2} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </TrendCard>

        <TrendCard
          title="Uptime"
          icon={<HeartPulse className="h-4 w-4 text-muted-foreground" />}
          description="TOME service availability, from Prometheus."
          empty={
            !trends
              ? undefined
              : !trends.uptime.configured
                ? "Prometheus not configured (set PROMETHEUS_URL)."
                : trends.uptime.points.length === 0
                  ? "No uptime samples in this window yet."
                  : undefined
          }
        >
          {trends && trends.uptime.configured && trends.uptime.points.length > 0 && (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends.uptime.points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })}
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11 }} width={32} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                <RechartsTooltip
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      active={active}
                      label={label ? new Date(label).toLocaleString() : undefined}
                      rows={[{ name: "Uptime", value: payload?.[0]?.value != null ? `${Number(payload[0].value).toFixed(1)}%` : "—", color: TREND_COLORS.uptime }]}
                    />
                  )}
                />
                <Area type="monotone" dataKey="uptimePct" stroke={TREND_COLORS.uptime} fill={TREND_COLORS.uptime} fillOpacity={0.15} strokeWidth={2} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </TrendCard>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-5 w-5" />
            Consumption
          </h3>
          <p className="text-sm text-muted-foreground">
            Which projects are actively ingesting, and how big each wiki is. Chat engagement
            lives on each project&apos;s own Insights page.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard title="Projects" value={String(totals?.projectCount ?? 0)} icon={<FileText className="h-4 w-4" />} />
        <StatCard
          title="Ingesting now"
          value={String(totals?.activeIngestCount ?? 0)}
          icon={<Loader2 className="h-4 w-4" />}
        />
        <StatCard title="Total pages" value={String(totals?.totalPages ?? 0)} icon={<FileText className="h-4 w-4" />} />
        <StatCard
          title="Total wiki size"
          value={formatBytes(totals?.totalWikiSizeBytes ?? 0)}
          icon={<Database className="h-4 w-4" />}
        />
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pages</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Cumulative ingest tokens</th>
                <th className="px-4 py-3">Last ingested</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span>Loading…</span>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    No projects have any TOME activity yet.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr
                    key={r.projectId}
                    className={cn(
                      "border-b border-border/60 transition-colors hover:bg-muted/50",
                      idx % 2 === 1 && "bg-muted/20",
                    )}
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/projects/${r.slug}/tome`} className="hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.teamName || "—"}</td>
                    <td className="px-4 py-3">
                      <IngestBadge activeIngest={r.activeIngest} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{r.pageCount}</td>
                    <td className="px-4 py-3 tabular-nums">{formatBytes(r.wikiSizeBytes)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatTokens(r.tokenUsage.input + r.tokenUsage.output)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatTimeAgo(r.lastIngestedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
