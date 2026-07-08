"use client";

// assisted-by Cursor Composer

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  HelpCircle,
  History,
  Plus,
  RefreshCw,
  Rocket,
  Sparkles,
  Target,
} from "lucide-react";

import { BackstageSyncDialog } from "@/components/projects/BackstageSyncDialog";
import { ProjectOnboardingWizard } from "@/components/projects/ProjectOnboardingWizard";
import { McpConnectDialog } from "@/components/tome/McpConnectDialog";
import { OnboardingModal } from "@/components/tome/OnboardingModal";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normLabel } from "@/lib/projects/labels";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";
import type { ActiveIngestRun } from "@/types/tome";

type GroupBy = "none" | "initiative" | "swimlane";

// Shared with TomeWiki so the first-run walkthrough shows once per browser
// across the hub and any project's wiki.
const ONBOARDING_SEEN_KEY = "tome.onboarding.seen";

// Silent background refresh so the active-ingest indicator clears/updates
// without a "Loading projects…" flicker on every tick.
const ACTIVE_INGEST_POLL_MS = 15_000;

type EnrichedProject = ProjectDocument & {
  page_count?: number | null;
  last_ingested_at?: string | Date | null;
  active_ingests?: ActiveIngestRun[];
};

function elapsedLabel(since: string | Date | null | undefined): string {
  if (!since) return "just started";
  const ms = Date.now() - new Date(since).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just started";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** "just started" already reads as a full phrase; only durations need the
 * "running for" prefix, else it reads as "running for just started". */
function runningForLabel(since: string | Date | null | undefined): string {
  const elapsed = elapsedLabel(since);
  return elapsed === "just started" ? elapsed : `running for ${elapsed}`;
}

function modeLabel(mode: ActiveIngestRun["mode"]): string {
  return mode === "bhag_rollup" ? "BHAG roll-up" : "Ingest";
}

/** Small pulsing dot used both on the hub header pill and per-card badge. */
function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2 shrink-0", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}

/** Hub-level indicator: lights up when any visible project has an in-flight
 * ingest/roll-up run, with a hovercard listing them. Data comes from the
 * `active_ingests` aggregate already on the projects payload — no extra
 * per-project polling. */
function ActiveIngestsIndicator({ runs }: { runs: ActiveIngestRun[] }) {
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
        <PulseDot />
        {runs.length} {runs.length === 1 ? "run" : "runs"} in progress
      </span>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active runs
          </p>
          <ul className="space-y-2">
            {runs.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.project_title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {modeLabel(r.mode)} ·{" "}
                    {r.status === "running" ? elapsedLabel(r.started_at) : "waiting to start"}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                    r.status === "running"
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface OnboardingHeroConfig {
  title: string;
  description: string;
}

function freshnessLabel(lastIngestedAt: string | Date | null | undefined): {
  text: string;
  tooltip: string;
  className: string;
} {
  if (!lastIngestedAt) {
    return { text: "—", tooltip: "Never ingested", className: "text-muted-foreground/30" };
  }
  const date = lastIngestedAt instanceof Date ? lastIngestedAt : new Date(lastIngestedAt);
  const diffMs = Date.now() - date.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  const diffD = diffMs / (1000 * 60 * 60 * 24);

  if (diffH < 24) {
    const h = Math.max(0, Math.floor(diffH));
    return { text: `${h}h ago`, tooltip: `Last ingested ${h}h ago`, className: "text-muted-foreground" };
  }
  if (diffD < 7) {
    const d = Math.floor(diffD);
    return { text: `${d}d ago`, tooltip: `Last ingested ${d}d ago`, className: "text-muted-foreground" };
  }
  if (diffD < 30) {
    const w = Math.floor(diffD / 7);
    return { text: `${w}w ago`, tooltip: `Last ingested ${w} week${w === 1 ? "" : "s"} ago. Consider re-ingesting.`, className: "text-amber-500" };
  }
  const mo = Math.floor(diffD / 30);
  return { text: `${mo}mo ago`, tooltip: `Last ingested ${mo} month${mo === 1 ? "" : "s"} ago. Likely stale.`, className: "text-amber-500" };
}

function groupProjects(
  projects: EnrichedProject[],
  groupBy: GroupBy,
): { key: string; label: string; items: EnrichedProject[] }[] {
  if (groupBy === "none") return [{ key: "__all__", label: "", items: projects }];

  const map = new Map<string, EnrichedProject[]>();
  const ungrouped: EnrichedProject[] = [];

  for (const p of projects) {
    const values =
      groupBy === "initiative"
        ? (p.labels?.initiatives ?? [])
        : (p.labels?.swimlanes ?? []);

    if (values.length === 0) {
      ungrouped.push(p);
    } else {
      for (const v of values) {
        if (!map.has(v)) map.set(v, []);
        map.get(v)!.push(p);
      }
    }
  }

  const groups = [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, items]) => ({ key, label: key, items }));

  if (ungrouped.length > 0) {
    groups.push({ key: "__ungrouped__", label: "Ungrouped", items: ungrouped });
  }

  return groups;
}

function ProjectCard({ project }: { project: EnrichedProject }) {
  const freshness = freshnessLabel(project.last_ingested_at);
  const activeRun = project.active_ingests?.[0];
  const repoCount = project.sources?.repos?.length ?? 0;
  const webexCount = project.sources?.webex_rooms?.length ?? 0;
  const confluenceCount = (project.sources?.confluence_spaces?.length ?? 0) ||
    (project.sources?.confluence_url ? 1 : 0);
  const hasSources = repoCount > 0 || confluenceCount > 0 || webexCount > 0;
  const initiatives = (project.labels?.initiatives ?? []).filter(Boolean);
  const swimlanes = (project.labels?.swimlanes ?? []).filter(Boolean);

  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group flex flex-col rounded-2xl border border-border/60 bg-card/50 p-5 transition hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug group-hover:text-primary">{project.title}</h3>
        {activeRun ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                <PulseDot />
                {activeRun.status === "running" ? "Ingesting" : "Queued"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {modeLabel(activeRun.mode)}{" "}
              {activeRun.status === "running"
                ? runningForLabel(activeRun.started_at)
                : "queued, waiting to start"}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${freshness.className}`}>
                <History className="h-3 w-3" />
                {freshness.text}
              </span>
            </TooltipTrigger>
            <TooltipContent>{freshness.tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/40">{project.team_name}</p>

      <p className="mt-2 line-clamp-2 flex-grow text-sm text-muted-foreground">
        {project.description}
      </p>

      <div className="mt-4 space-y-2">
        {(hasSources || project.page_count != null) && (
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" />
                  {project.page_count ?? 0} {(project.page_count ?? 0) === 1 ? "page" : "pages"}
                </span>
              </TooltipTrigger>
              <TooltipContent>Wiki pages from the last ingest</TooltipContent>
            </Tooltip>
            {repoCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ProviderLogo provider="github" className="h-3.5 w-3.5 grayscale transition-all group-hover:grayscale-0" />
                    {repoCount} {repoCount === 1 ? "repo" : "repos"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {repoCount} GitHub {repoCount === 1 ? "repository" : "repositories"} connected
                </TooltipContent>
              </Tooltip>
            )}
            {confluenceCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ProviderLogo provider="atlassian" className="h-3.5 w-3.5 object-contain grayscale transition-all group-hover:grayscale-0" />
                    {confluenceCount} {confluenceCount === 1 ? "space" : "spaces"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{confluenceCount} Confluence {confluenceCount === 1 ? "space" : "spaces"} connected</TooltipContent>
              </Tooltip>
            )}
            {webexCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ProviderLogo provider="webex" className="h-3.5 w-3.5 object-contain grayscale transition-all group-hover:grayscale-0" />
                    {webexCount} {webexCount === 1 ? "room" : "rooms"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {webexCount} Webex {webexCount === 1 ? "room" : "rooms"} connected
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {(initiatives.length > 0 || swimlanes.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {initiatives.slice(0, 3).map((l) => (
              <Tooltip key={l}>
                <TooltipTrigger asChild>
                  <span className="rounded-full border border-violet-500/30 px-2 py-0.5 text-[10px] text-violet-500/80">
                    {l}
                  </span>
                </TooltipTrigger>
                <TooltipContent>BHAG / Initiative</TooltipContent>
              </Tooltip>
            ))}
            {swimlanes.slice(0, 3).map((l) => (
              <Tooltip key={l}>
                <TooltipTrigger asChild>
                  <span className="rounded-full border border-sky-500/30 px-2 py-0.5 text-[10px] text-sky-500/80">
                    {l}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Swim Lane</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function ProjectGroup({
  label,
  items,
  groupBy,
  bhag,
  onCreateBhag,
  creating,
}: {
  label: string;
  items: EnrichedProject[];
  groupBy: GroupBy;
  /** The BHAG entity matching this group's label, when one exists. */
  bhag?: EnrichedProject | null;
  /** Promote this initiative label into a first-class BHAG wiki. */
  onCreateBhag?: (label: string, items: EnrichedProject[]) => void;
  creating?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isUngrouped = label === "Ungrouped";
  const isBhagGroup = groupBy === "initiative" && !isUngrouped;
  const labelClass = isUngrouped
    ? "text-sm font-medium text-muted-foreground"
    : groupBy === "initiative"
      ? "text-sm font-semibold text-violet-500"
      : "text-sm font-semibold text-sky-500";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-grow items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {isBhagGroup && <Target className="h-4 w-4 shrink-0 text-violet-500" />}
          <span className={labelClass}>{label}</span>
          <span className="text-xs text-muted-foreground/50">{items.length}</span>
          <span className="ml-1 h-px flex-grow bg-border/40" />
        </button>

        {/* BHAG front door: open the strategic-goal wiki, or promote this
            initiative into one. Kept prominent so it's clear and apparent. */}
        {isBhagGroup &&
          (bhag ? (
            <Link
              href={`/projects/${bhag.slug}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-500 transition hover:border-violet-500 hover:bg-violet-500/20"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Open {bhag.name} BHAG wiki
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => onCreateBhag?.(label, items)}
              disabled={creating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-violet-500/40 px-3 py-1.5 text-xs font-medium text-violet-500/80 transition hover:border-violet-500 hover:bg-violet-500/10 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {creating ? "Creating…" : "Create BHAG wiki"}
            </button>
          ))}
      </div>

      {!collapsed && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <ProjectCard key={String(p._id)} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectsHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [bhags, setBhags] = useState<EnrichedProject[]>([]);
  const [creatingBhag, setCreatingBhag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hero, setHero] = useState<OnboardingHeroConfig>({
    title: "Projects for your teams",
    description:
      "Create projects aligned with your Backstage catalog. Onboarding steps are configured externally.",
  });
  const [syncOpen, setSyncOpen] = useState(false);
  const [canOpenSync, setCanOpenSync] = useState(false);
  const [, setSyncBlockedReason] = useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  // First-run walkthrough, once per browser (shared key with the wiki). The
  // Help button reopens it any time.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) setOnboardingOpen(true);
  }, []);

  const handleOnboardingChange = useCallback((open: boolean) => {
    setOnboardingOpen(open);
    if (!open && typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    }
  }, []);

  // Default to grouping by BHAG so strategic goals are the primary lens; the
  // user can still drop to a flat list or swimlanes.
  const groupBy = (searchParams.get("groupBy") ?? "initiative") as GroupBy;

  const setGroupBy = (value: GroupBy) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "initiative") params.delete("groupBy");
    else params.set("groupBy", value);
    router.replace(`/projects?${params.toString()}`);
  };

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      // Real projects (BHAGs are filtered out server-side) and BHAG entities are
      // fetched separately; BHAGs enrich the Group-by-BHAG headers rather than
      // appearing as project cards.
      const [projRes, bhagRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/projects?type=bhag"),
      ]);
      const projBody = await projRes.json();
      if (!projRes.ok) throw new Error(projBody.error ?? "Failed to load projects");
      setProjects((projBody.data?.projects ?? []) as EnrichedProject[]);
      if (bhagRes.ok) {
        const bhagBody = await bhagRes.json();
        setBhags((bhagBody.data?.projects ?? []) as EnrichedProject[]);
      }
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Index BHAG entities by normalized name so a Group-by-BHAG section can find
  // the entity matching its initiative label.
  const bhagByLabel = new Map<string, EnrichedProject>();
  for (const b of bhags) bhagByLabel.set(normLabel(b.name), b);

  // Promote an initiative label into a first-class BHAG wiki. The BHAG inherits
  // the team of the projects already tagged with it, then we route to its wiki.
  const handleCreateBhag = useCallback(
    async (label: string, items: EnrichedProject[]) => {
      const teamId = items[0]?.team_slug || items[0]?.team_id;
      if (!teamId) {
        setError("Cannot create a BHAG: no team found for this group.");
        return;
      }
      setCreatingBhag(normLabel(label));
      setError(null);
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: label, type: "bhag", team_id: teamId }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to create BHAG");
        const slug = body.data?.project?.slug;
        if (slug) router.push(`/projects/${slug}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setCreatingBhag(null);
      }
    },
    [router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the active-ingest indicator live without re-triggering the loading
  // state on every tick.
  useEffect(() => {
    const id = setInterval(() => void load({ silent: true }), ACTIVE_INGEST_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        const config = body.data?.config;
        if (config?.hero) setHero(config.hero);
      })
      .catch(() => undefined);

    fetch("/api/projects/backstage/status")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        const data = body.data ?? {};
        setCanOpenSync(Boolean(data.configured) && Boolean(data.can_manage));
        if (!data.configured) {
          setSyncBlockedReason("Backstage is not configured on the server.");
        } else if (!data.can_manage) {
          setSyncBlockedReason("Org admin access required to import from Backstage.");
        } else {
          setSyncBlockedReason(null);
        }
      })
      .catch(() => {
        setCanOpenSync(false);
        setSyncBlockedReason("Could not load Backstage sync status.");
      });
  }, []);

  const groups = groupProjects(projects, groupBy);
  const activeIngests = projects.flatMap((p) => p.active_ingests ?? []);

  return (
    <div className="mx-auto max-w-6xl space-y-10 p-6">
      <section className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-violet-950/40 via-background to-indigo-950/30 p-8 md:p-12">
        <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative grid gap-8 md:grid-cols-2 md:items-center">
          <div className="space-y-4">
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight md:text-4xl">
              <FolderKanban className="h-8 w-8 shrink-0 text-violet-400 md:h-9 md:w-9" />
              {hero.title}
            </h1>
            <p className="max-w-lg text-muted-foreground">{hero.description}</p>
          </div>
          <div className="flex flex-col items-stretch gap-3 md:items-end">
            <ProjectOnboardingWizard onComplete={() => void load()} />
            <Link
              href="/projects/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Sparkles className="h-4 w-4" />
              Executive Dashboard
            </Link>
            {canOpenSync ? (
              <button
                type="button"
                onClick={() => setSyncOpen(true)}
                title="Super admins can import kind: System entities from the Backstage developer portal, assign a team, and resolve conflicts before apply."
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
                Sync from Backstage
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">
              {loading
                ? "Your projects"
                : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
            </h2>
            <ActiveIngestsIndicator runs={activeIngests} />
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => setOnboardingOpen(true)}
                    aria-label="What is TOME?"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">What is TOME?</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <McpConnectDialog />
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="initiative">Group by BHAG</option>
              <option value="swimlane">Group by Swim Lane</option>
              <option value="none">No grouping</option>
            </select>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading projects…</p>}
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {!loading && projects.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Rocket className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 font-medium">No projects yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a project with the onboarding wizard or import Systems from the Backstage
              catalog section above.
            </p>
          </div>
        )}

        <TooltipProvider>
          {groupBy === "none" ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {groups[0]?.items.map((p) => (
                <ProjectCard key={String(p._id)} project={p} />
              ))}
            </div>
          ) : (
            <div className="space-y-8">
              {groups.map((g) => (
                <ProjectGroup
                  key={g.key}
                  label={g.label}
                  items={g.items}
                  groupBy={groupBy}
                  bhag={groupBy === "initiative" ? bhagByLabel.get(normLabel(g.label)) : null}
                  onCreateBhag={handleCreateBhag}
                  creating={creatingBhag === normLabel(g.label)}
                />
              ))}
            </div>
          )}
        </TooltipProvider>
      </section>

      <BackstageSyncDialog
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onComplete={() => void load()}
      />

      <OnboardingModal open={onboardingOpen} onOpenChange={handleOnboardingChange} />
    </div>
  );
}
