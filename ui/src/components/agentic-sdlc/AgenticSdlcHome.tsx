"use client";

/**
 * Agentic SDLC home -- the empty / preview state.
 *
 * Shipped early as a visible demo target for the toggle wiring; the
 * real onboarded-repo grid lands in T039. When that lands, this file
 * either (a) gets replaced by the real grid for users with at least
 * one onboarded repo, or (b) stays as the empty-state illustration
 * for users with zero repos onboarded -- both paths keep
 * AgenticSdlcAnimation as the visual anchor.
 *
 * Design intent (from user feedback "AI-native, sexy, swim lanes,
 * loops, nice graphics"):
 *   - Atmospheric gradient backdrop in the product palette.
 *   - Eyebrow chip + gradient-text title -> the feature has a
 *     personality, not just a header.
 *   - AgenticSdlcAnimation as the hero: the ten-stage loop shown
 *     literally as an animated orbit so users see "what they are
 *     about to onboard into" before they have any data.
 *   - Stage vocabulary now lives in the animation and per-Epic views
 *     rather than a separate glossary row, keeping the home page lean.
 *   - Repos-first dashboard -> projects are intentionally hidden for
 *     now; portfolio/project hierarchy will come back as a later slice.
 *   - Settings -> the first admin surface for repo onboarding and RBAC.
 *
 * Everything heavier than CSS animations is gated behind motion-safe
 * via the underlying components.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */

import {
  BarChart3,
  GitBranch,
  Heart,
  Layers,
  RadioTower,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LiveStatusIndicator } from "@/components/agentic-sdlc/LiveStatusIndicator";
import {
  RepoOnboardingSettingsCard,
  RepoOnboardingWizard,
} from "@/components/agentic-sdlc/RepoOnboardingWizard";
import { RepoGrid } from "@/components/agentic-sdlc/RepoGrid";
import { AgenticSdlcAnimation } from "@/components/agentic-sdlc/visualizations/AgenticSdlcAnimation";
import { useAgenticSdlcPortfolioLiveRefresh } from "@/hooks/use-agentic-sdlc-portfolio-live-refresh";
import {
  readFavoriteRepos,
  toggleFavoriteRepo,
  writeFavoriteRepos,
} from "@/lib/agentic-sdlc/repo-favorites";

type AgenticSdlcTab = "ship-loop" | "repos" | "metrics" | "settings";

interface HomeRepoItem {
  repo_id: string;
  owner: string;
  name: string;
  full_name: string;
  webhook_status: "healthy" | "degraded" | "missing" | "unknown";
  last_activity_at: string | null;
  counts: {
    open_epics: number;
    in_flight_subtasks: number;
    prs_awaiting_review: number;
    deploys_24h: number;
  };
}

interface HomeRepoListResponse {
  items: HomeRepoItem[];
}

interface MetricsStagePressureCell {
  repo_id: string;
  repo_name: string;
  stage: string;
  count: number;
}

interface MetricsVelocityPoint {
  date: string;
  count: number;
}

interface MetricsDashboardResponse {
  generated_at: string;
  summary: {
    repos_in_scope: number;
    hitl_queue_count: number;
    velocity_30d: number;
    token_spend_total: number;
  };
  stage_pressure: MetricsStagePressureCell[];
  velocity_series: MetricsVelocityPoint[];
}

const AGENTIC_SDLC_TABS: AgenticSdlcTab[] = [
  "ship-loop",
  "repos",
  "metrics",
  "settings",
];

function parseAgenticSdlcTab(raw: string | null): AgenticSdlcTab {
  return AGENTIC_SDLC_TABS.includes(raw as AgenticSdlcTab)
    ? (raw as AgenticSdlcTab)
    : "ship-loop";
}

export function AgenticSdlcHome() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = parseAgenticSdlcTab(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState<AgenticSdlcTab>(currentTab);
  const portfolioLive = useAgenticSdlcPortfolioLiveRefresh({ enabled: true });

  useEffect(() => {
    setActiveTab(currentTab);
  }, [currentTab]);

  function selectTab(tab: AgenticSdlcTab) {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", tab);
    router.push(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  return (
    <div className="relative flex-1 overflow-y-auto">
      {/* Atmospheric gradient mesh -- two soft radials in the product
          palette, very low opacity so the rest of the app's chrome
          still wins for contrast. Pointer-events disabled so it
          never intercepts clicks. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(var(--gradient-start) / 0.45), transparent)",
          }}
        />
        <div
          className="absolute -top-20 right-0 h-[480px] w-[480px] rounded-full opacity-25 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(var(--gradient-mid) / 0.45), transparent)",
          }}
        />
        <div
          className="absolute top-[260px] left-1/3 h-[420px] w-[420px] rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(var(--gradient-end) / 0.4), transparent)",
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-full max-w-[1600px] flex-col gap-6 p-6 md:p-8 lg:px-12">
        <section className="glass-panel rounded-2xl border border-border/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex flex-wrap gap-2"
              role="tablist"
              aria-label="Agentic SDLC views"
            >
              <TabButton
                active={activeTab === "ship-loop"}
                icon={Sparkles}
                label="Overview"
                onClick={() => selectTab("ship-loop")}
              />
              <TabButton
                active={activeTab === "repos"}
                icon={GitBranch}
                label="Repos"
                onClick={() => selectTab("repos")}
              />
              <TabButton
                active={activeTab === "metrics"}
                icon={BarChart3}
                label="Metrics"
                onClick={() => selectTab("metrics")}
              />
              <TabButton
                active={activeTab === "settings"}
                icon={Settings}
                label="Settings"
                onClick={() => selectTab("settings")}
              />
            </div>
            <LiveStatusIndicator
              status={portfolioLive.status}
              label="Portfolio live"
            />
          </div>
        </section>

        {activeTab === "ship-loop" ? (
          <HomeDashboard setActiveTab={selectTab} />
        ) : null}
        {activeTab === "repos" ? <ReposDashboard /> : null}
        {activeTab === "metrics" ? <MetricsDashboard /> : null}
        {activeTab === "settings" ? <AgenticSdlcSettings /> : null}
        <footer className="mt-auto border-t border-border/30 pt-3 text-center text-[11px] text-muted-foreground/70">
          Agentic SDLC is an experimental feature. UI will evolve based on user feedback.
        </footer>
      </div>
    </div>
  );
}

function HomeDashboard({
  setActiveTab,
}: {
  setActiveTab: (tab: AgenticSdlcTab) => void;
}) {
  return (
    <>
      {/* Hero -- two-column on md+. Copy + an inline stage-icon
          row on the left, the animation on the right with NO
          glass panel so it floats freely against the page's
          ambient gradient mesh. */}
      <section className="grid gap-6 md:grid-cols-12 md:items-center">
        <div className="space-y-5 md:col-span-6">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              <span className="gradient-text">Engineers write the rules.</span>
              <br />
              <span className="text-foreground">Agents run the SDLC.</span>
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              Onboard a GitHub repo and watch agents move Epics from spec to
              sandbox deploy — live, label-driven, and webhook-fed.
            </p>
          </div>
        </div>

        <div className="md:col-span-6">
          <div className="mx-auto max-w-[820px] md:ml-auto md:mr-0">
            <AgenticSdlcAnimation />
          </div>
        </div>
      </section>

      <section
        className="grid gap-3 md:grid-cols-3"
        aria-label="Agentic SDLC home actions"
      >
        <HomeActionCard
          icon={GitBranch}
          title="Onboard a new repo"
          detail="Connect GitHub, register the webhook, and start projecting real Epics."
          tone="cyan"
        >
          <RepoOnboardingWizard />
        </HomeActionCard>
        <HomeActionCard
          icon={BarChart3}
          title="See metrics"
          detail="Open the portfolio view for repo health, review pressure, and velocity."
          tone="violet"
        >
          <button
            type="button"
            onClick={() => setActiveTab("metrics")}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/15 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
          >
            Open metrics
          </button>
        </HomeActionCard>
        <HomeActionCard
          icon={ShieldCheck}
          title="Manage repo permissions"
          detail="Configure team RBAC, repo access, webhook setup, and label mappings."
          tone="emerald"
        >
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/15"
          >
            Open settings
          </button>
        </HomeActionCard>
      </section>

      <HomeActiveReposRow setActiveTab={setActiveTab} />
    </>
  );
}

function HomeActiveReposRow({
  setActiveTab,
}: {
  setActiveTab: (tab: AgenticSdlcTab) => void;
}) {
  const [repos, setRepos] = useState<HomeRepoItem[] | null>(null);
  const [starredRepos, setStarredRepos] = useState<string[]>([]);

  useEffect(() => {
    setStarredRepos(readFavoriteRepos());

    let cancelled = false;
    async function loadRepos() {
      try {
        const res = await fetch("/api/agentic-sdlc/repos", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setRepos([]);
          return;
        }
        const body = (await res.json()) as HomeRepoListResponse;
        if (!cancelled) setRepos(body.items ?? []);
      } catch {
        if (!cancelled) setRepos([]);
      }
    }

    void loadRepos();
    window.addEventListener("ship-loop:repo-onboarded", loadRepos);
    window.addEventListener("agentic-sdlc:portfolio-synced", loadRepos);
    return () => {
      cancelled = true;
      window.removeEventListener("ship-loop:repo-onboarded", loadRepos);
      window.removeEventListener("agentic-sdlc:portfolio-synced", loadRepos);
    };
  }, []);

  function toggleStar(fullName: string) {
    setStarredRepos((current) => {
      const next = toggleFavoriteRepo(current, fullName);
      writeFavoriteRepos(next);
      return next;
    });
  }

  const sortedRepos = sortHomeRepos(repos ?? [], starredRepos).slice(0, 4);

  return (
    <section className="space-y-3" aria-label="Your active repos">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Your active repos
          </h2>
          <p className="mt-1 text-xs text-muted-foreground/75">
            Starred first, then recently updated from live webhook activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab("repos")}
          className="text-xs font-medium text-primary transition hover:text-primary/80"
        >
          View all repos
        </button>
      </div>

      {repos === null ? (
        <div className="rounded-xl border border-border/40 bg-card/25 px-4 py-6 text-sm text-muted-foreground">
          Loading active repos...
        </div>
      ) : sortedRepos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 bg-card/20 px-4 py-6 text-sm text-muted-foreground">
          No active repos yet. Onboard a repository to populate this row.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" role="list">
          {sortedRepos.map((repo) => (
            <HomeRepoCard
              key={repo.repo_id}
              repo={repo}
              starred={starredRepos.includes(repo.full_name)}
              onToggleStar={() => toggleStar(repo.full_name)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HomeRepoCard({
  repo,
  starred,
  onToggleStar,
}: {
  repo: HomeRepoItem;
  starred: boolean;
  onToggleStar: () => void;
}) {
  const detailHref = repoDetailHref(repo.owner, repo.name);

  return (
    <article
      role="listitem"
      onClick={(event) => {
        if (isInteractiveClick(event.target)) return;
        event.currentTarget
          .querySelector<HTMLAnchorElement>("[data-repo-detail-link]")
          ?.click();
      }}
      className="glass-panel hover-glow group cursor-pointer rounded-xl border border-border/40 p-4 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          data-repo-detail-link
          href={detailHref}
          className="min-w-0 flex-1"
          aria-label={`${repo.full_name} active repo`}
        >
          <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
            {repo.owner}
          </p>
          <h3 className="truncate text-sm font-semibold text-foreground">
            {repo.name}
          </h3>
        </Link>
        <button
          type="button"
          onClick={onToggleStar}
          aria-pressed={starred}
          aria-label={`${starred ? "Unstar" : "Star"} ${repo.full_name}`}
          className="rounded-md border border-border/40 bg-background/40 p-1.5 text-muted-foreground transition hover:text-amber-300"
        >
          <Heart
            className={[
              "h-3.5 w-3.5",
              starred ? "fill-rose-300 text-rose-300" : "",
            ].join(" ")}
            aria-hidden
          />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <HomeRepoStat label="Epics" value={repo.counts.open_epics} />
        <HomeRepoStat label="Tasks" value={repo.counts.in_flight_subtasks} />
        <HomeRepoStat label="PR review" value={repo.counts.prs_awaiting_review} />
        <HomeRepoStat label="Deploys" value={repo.counts.deploys_24h} />
      </div>

      <footer className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              repo.webhook_status === "healthy"
                ? "bg-emerald-400"
                : repo.webhook_status === "degraded"
                  ? "bg-amber-400"
                  : repo.webhook_status === "missing"
                    ? "bg-red-400"
                    : "bg-muted-foreground",
            ].join(" ")}
            aria-hidden
          />
          {repo.webhook_status}
        </span>
        <span>{formatActivity(repo.last_activity_at)}</span>
        {starred ? (
          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
            Starred
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function repoDetailHref(owner: string, repo: string): string {
  return `/apps/agentic-sdlc/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function isInteractiveClick(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a,button"));
}

function HomeRepoStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
      <Layers className="h-3 w-3 text-primary/80" aria-hidden />
      <span className="font-semibold text-foreground">{value}</span>
      <span className="truncate text-muted-foreground">{label}</span>
    </div>
  );
}

function sortHomeRepos(
  repos: HomeRepoItem[],
  starredRepos: string[],
): HomeRepoItem[] {
  return [...repos].sort((a, b) => {
    const aStarred = starredRepos.includes(a.full_name);
    const bStarred = starredRepos.includes(b.full_name);
    if (aStarred !== bStarred) return aStarred ? -1 : 1;
    return Date.parse(b.last_activity_at ?? "") - Date.parse(a.last_activity_at ?? "");
  });
}

function formatActivity(value: string | null): string {
  if (!value) return "No activity yet";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "No activity yet";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60 * 1000) return "Updated now";
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function HomeActionCard({
  icon: Icon,
  title,
  detail,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  detail: string;
  tone: "cyan" | "violet" | "emerald";
  children: React.ReactNode;
}) {
  const toneClasses = {
    cyan: "border-cyan-400/25 bg-cyan-500/5 text-cyan-200",
    violet: "border-violet-400/25 bg-violet-500/5 text-violet-200",
    emerald: "border-emerald-400/25 bg-emerald-500/5 text-emerald-200",
  }[tone];

  return (
    <div className={`glass-panel rounded-xl border p-4 ${toneClasses}`}>
      <Icon className="h-4 w-4" aria-hidden />
      <h2 className="mt-3 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 min-h-10 text-xs text-muted-foreground">{detail}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ReposDashboard() {
  return (
    <>
      <section id="repos" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Repo tiles
            </h2>
            <p className="mt-1 text-xs text-muted-foreground/75">
              Visibility based on Team RBAC; repo drilldown still requires repo
              access RBAC.
            </p>
          </div>
        </div>
        <RepoGrid />
      </section>

    </>
  );
}

function MetricsDashboard() {
  const [metrics, setMetrics] = useState<MetricsDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function onPortfolioSynced() {
      setRefreshKey((value) => value + 1);
    }

    window.addEventListener("agentic-sdlc:portfolio-synced", onPortfolioSynced);
    return () =>
      window.removeEventListener(
        "agentic-sdlc:portfolio-synced",
        onPortfolioSynced,
      );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      try {
        const res = await fetch("/api/agentic-sdlc/metrics");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as MetricsDashboardResponse;
        if (!cancelled) {
          setMetrics(body);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load metrics",
          );
        }
      }
    }

    void loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const velocityMax = Math.max(
    1,
    ...(metrics?.velocity_series.map((point) => point.count) ?? []),
  );
  const heatmapCells = metrics?.stage_pressure ?? [];

  return (
    <section id="metrics" className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card/35 p-5">
        <div
          aria-hidden
          className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -left-20 bottom-0 h-60 w-60 rounded-full bg-violet-500/15 blur-3xl"
        />
        <div className="relative grid gap-5 xl:grid-cols-[0.9fr_1.3fr] xl:items-center">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
              Metrics dashboard
            </h2>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              Portfolio signal across repo delivery loops.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Aggregate repo health, velocity, HITL load, deploy throughput,
              and token burn across repos the viewer can access.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricsCard
              icon={GitBranch}
              title="Repos in scope"
              value={formatCompactMetric(metrics?.summary.repos_in_scope)}
              detail="Team-visible repos"
              tone="cyan"
            />
            <MetricsCard
              icon={ShieldCheck}
              title="HITL queue"
              value={formatCompactMetric(metrics?.summary.hitl_queue_count)}
              detail="Items needing humans"
              tone="amber"
            />
            <MetricsCard
              icon={TrendingUp}
              title="Velocity"
              value={formatCompactMetric(metrics?.summary.velocity_30d)}
              detail="Merged epics in 30d"
              tone="emerald"
            />
            <MetricsCard
              icon={Zap}
              title="Token spend"
              value={formatCompactMetric(metrics?.summary.token_spend_total)}
              detail="Observed tokens in 30d"
              tone="violet"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Metrics data is unavailable: {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="glass-panel rounded-2xl border border-border/40 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Stage pressure heatmap
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Repo x stage load, highlighting bottlenecks before humans feel
                them.
              </p>
            </div>
            <RadioTower className="h-5 w-5 text-cyan-300" aria-hidden />
          </div>
          <div
            className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            aria-label="Stage pressure heatmap"
          >
            {heatmapCells.length > 0
              ? heatmapCells.map((cell, idx) => (
                  <div
                    key={`${cell.repo_id}:${cell.stage}`}
                    className={`min-h-14 rounded-md border border-white/5 p-2 ${heatmapTone(idx, cell.count)}`}
                    title={`${cell.repo_name} • ${stageLabel(cell.stage)} • ${cell.count}`}
                  >
                    <div className="truncate text-[11px] font-medium text-foreground/90">
                      {cell.repo_name}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span className="truncate">{stageLabel(cell.stage)}</span>
                      <span className="font-semibold text-foreground">
                        {cell.count}
                      </span>
                    </div>
                  </div>
                ))
              : Array.from({ length: 10 }, (_, idx) => (
                  <div
                    key={idx}
                    className={`h-14 rounded-md border border-white/5 ${heatmapTone(idx, 0)} opacity-50`}
                    aria-hidden
                  />
                ))}
          </div>
        </div>

        <div className="glass-panel rounded-2xl border border-border/40 p-5">
          <h3 className="text-sm font-semibold text-foreground">
            Velocity ribbon
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Epics merged, deploy success, and HITL queue age over time.
          </p>
          <div className="mt-5 flex h-36 items-end gap-2">
            {(metrics?.velocity_series.length
              ? metrics.velocity_series
              : Array.from({ length: 10 }, (_, idx) => ({
                  date: `loading-${idx}`,
                  count: 0,
                }))
            ).map((point) => {
              const height = metrics
                ? Math.max(8, Math.round((point.count / velocityMax) * 100))
                : 34;
              return (
                <div
                  key={point.date}
                  className="flex flex-1 flex-col items-center justify-end gap-1"
                >
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-violet-500/25 via-cyan-400/50 to-emerald-300/85 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
                    style={{ height: `${height}%` }}
                    aria-label={`${point.date}: ${point.count} delivery events`}
                    title={`${point.date}: ${point.count} delivery events`}
                  />
                  {metrics && (
                    <span className="text-[10px] text-muted-foreground">
                      {point.count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatCompactMetric(value: number | undefined): string {
  if (value === undefined) return "...";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}

function heatmapTone(idx: number, count: number): string {
  if (count >= 4) return "bg-amber-400/45";
  if (count >= 2) return "bg-violet-400/40";
  const palette = [
    "bg-cyan-500/20",
    "bg-sky-400/30",
    "bg-emerald-400/35",
    "bg-cyan-500/20",
  ];
  return palette[idx % palette.length];
}

function AgenticSdlcSettings() {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Settings
        </h2>
        <p className="mt-1 text-xs text-muted-foreground/75">
          Admin surface for repo onboarding, RBAC setup, webhook guidance, and
          label mappings. Project onboarding is intentionally hidden for now.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="glass-panel rounded-xl border border-border/40 p-4">
          <RepoOnboardingSettingsCard />
        </div>
        <div className="glass-panel rounded-xl border border-border/40 p-4">
          <h3 className="text-sm font-semibold text-foreground">RBAC setup</h3>
          <p className="mt-1 text-xs text-muted-foreground/75">
            Configure which teams can see repo tiles and who can open repo
            drilldowns or administer Agentic SDLC settings.
          </p>
          <div className="mt-3 grid gap-2 text-xs">
            <div className="rounded-md border border-border/40 bg-background/40 p-2">
              <code>team:read</code> shows repo tiles for the team.
            </div>
            <div className="rounded-md border border-border/40 bg-background/40 p-2">
              <code>repo:read</code> opens repo detail and Epic views.
            </div>
            <div className="rounded-md border border-border/40 bg-background/40 p-2">
              <code>repo:admin</code> reconnects webhooks and edits label mappings.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
      {badge ? (
        <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary/80">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function MetricsCard({
  icon: Icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  value: string;
  detail: string;
  tone: "cyan" | "amber" | "emerald" | "violet";
}) {
  const toneClass = {
    cyan: "text-cyan-200",
    amber: "text-amber-200",
    emerald: "text-emerald-200",
    violet: "text-violet-200",
  }[tone];

  return (
    <div className="rounded-xl border border-white/10 bg-background/35 p-4 shadow-[0_0_24px_rgba(34,211,238,0.08)]">
      <Icon className={`h-4 w-4 ${toneClass}`} aria-hidden />
      <p className="mt-3 text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground/75">{detail}</p>
    </div>
  );
}
