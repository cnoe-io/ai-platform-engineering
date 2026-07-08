"use client";

// assisted-by claude code claude-opus-4-8
//
// Executive dashboard (FR-010/011/012): rolls the project portfolio up by each
// label dimension — Domain, BHAG/Initiative, Swim Lane — with counts + status
// breakdown, and cross-filters the three facets against each other. Budget
// health is a placeholder until the manual provider lands (FR-019).
//
// Deliberately does not surface metrics we don't have (GitHub stars, KPI
// percentages, market-fit scores, pending-decision queues, artifact feeds) —
// those came from a UX mock that assumed data this app doesn't collect.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Boxes, Globe, RefreshCw, Target, Waves, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { normLabel } from "@/lib/projects/labels";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

// Dot color per status, theme-safe (no hardcoded light-mode backgrounds).
const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  onboarding: "bg-sky-500",
  draft: "bg-muted-foreground/50",
  archived: "bg-muted-foreground/30",
};

type Dimension = "domain" | "initiative" | "swimlane";

interface Bucket {
  value: string;
  count: number;
  statuses: Record<string, number>;
}

// Each dimension keeps its own accent (kept distinct on purpose — a 4-color
// categorical set, not folded into `primary`; see project history for why).
const DIMENSION_META: Record<
  Dimension,
  { title: string; Icon: typeof Globe; dot: string; gradient: string }
> = {
  domain: { title: "By Domain", Icon: Globe, dot: "bg-sky-500", gradient: "from-sky-500 to-blue-600" },
  initiative: {
    title: "By BHAG / Initiative",
    Icon: Target,
    dot: "bg-amber-500",
    gradient: "from-amber-500 to-orange-600",
  },
  swimlane: { title: "By Swim Lane", Icon: Waves, dot: "bg-emerald-500", gradient: "from-emerald-500 to-teal-600" },
};

const PICKERS: Record<Dimension, (p: ProjectDocument) => string[]> = {
  domain: (p) => [p.labels?.domain ?? p.domain ?? ""],
  initiative: (p) => p.labels?.initiatives ?? [],
  swimlane: (p) => p.labels?.swimlanes ?? [],
};

function matchesFilter(values: string[], filterValue: string | null): boolean {
  if (!filterValue) return true;
  return values.some((v) => v && normLabel(v) === normLabel(filterValue));
}

function bucketize(
  projects: ProjectDocument[],
  pick: (p: ProjectDocument) => string[],
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of projects) {
    for (const raw of pick(p)) {
      if (!raw || !raw.trim()) continue;
      const key = normLabel(raw);
      const b = map.get(key) ?? { value: raw.trim(), count: 0, statuses: {} };
      b.count += 1;
      b.statuses[p.status] = (b.statuses[p.status] ?? 0) + 1;
      map.set(key, b);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function ProjectsDashboard() {
  const [projects, setProjects] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<Dimension, string | null>>({
    domain: null,
    initiative: null,
    swimlane: null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load projects");
      setProjects((body.data?.projects ?? []) as ProjectDocument[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A dimension's own bucket list ignores its own active filter (so you can
  // still switch selection within it) but respects filters from the other two
  // — standard cross-filtering facet behavior.
  const bucketsIgnoring = useCallback(
    (except: Dimension) => {
      const others = (Object.keys(PICKERS) as Dimension[]).filter((d) => d !== except);
      const scoped = projects.filter((p) => others.every((d) => matchesFilter(PICKERS[d](p), filters[d])));
      return bucketize(scoped, PICKERS[except]);
    },
    [projects, filters],
  );

  const dims = useMemo(
    () => ({
      domain: bucketsIgnoring("domain"),
      initiative: bucketsIgnoring("initiative"),
      swimlane: bucketsIgnoring("swimlane"),
    }),
    [bucketsIgnoring],
  );

  const filteredProjects = useMemo(
    () =>
      projects.filter((p) =>
        (Object.keys(PICKERS) as Dimension[]).every((d) => matchesFilter(PICKERS[d](p), filters[d])),
      ),
    [projects, filters],
  );

  const activeFilters = (Object.keys(filters) as Dimension[]).filter((d) => filters[d]);
  const unbudgeted = projects.length; // placeholder until budget provider lands

  const toggleFilter = (dim: Dimension, value: string) => {
    setFilters((f) => ({
      ...f,
      [dim]: f[dim] && normLabel(f[dim]!) === normLabel(value) ? null : value,
    }));
  };
  const clearFilters = () => setFilters({ domain: null, initiative: null, swimlane: null });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary-br text-white shadow-sm">
              <Boxes className="h-5 w-5" />
            </span>
            <span className="text-gradient-primary">Executive Dashboard</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Portfolio rolled up by Domain, BHAG / Initiative, and Swim Lane.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Link
            href="/projects"
            className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm hover:bg-accent"
          >
            All projects
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Portfolio scale, as tags rather than four large stat cards. */}
      <div className="flex flex-wrap items-center gap-2">
        <StatTag dot="bg-violet-600" value={projects.length} label={projects.length === 1 ? "project" : "projects"} />
        <StatTag dot={DIMENSION_META.domain.dot} value={dims.domain.length} label={dims.domain.length === 1 ? "domain" : "domains"} />
        <StatTag
          dot={DIMENSION_META.initiative.dot}
          value={dims.initiative.length}
          label={dims.initiative.length === 1 ? "initiative" : "initiatives"}
        />
        <StatTag
          dot={DIMENSION_META.swimlane.dot}
          value={dims.swimlane.length}
          label={dims.swimlane.length === 1 ? "swim lane" : "swim lanes"}
        />
      </div>

      {/* Filter bar: pick one value per dimension, cross-filtered against the others. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/30 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">Filter</span>
        {(Object.keys(DIMENSION_META) as Dimension[]).map((dim) => (
          <select
            key={dim}
            value={filters[dim] ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, [dim]: e.target.value || null }))}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">{DIMENSION_META[dim].title.replace("By ", "")}: All</option>
            {dims[dim].map((b) => (
              <option key={b.value} value={b.value}>
                {b.value} ({b.count})
              </option>
            ))}
          </select>
        ))}
        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        {activeFilters.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {filteredProjects.length} of {projects.length} projects
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading portfolio…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No projects yet. Onboard a project to populate the dashboard.
        </div>
      ) : (
        <div className="space-y-8">
          <DimensionSection dim="domain" buckets={dims.domain} active={filters.domain} onToggle={toggleFilter} />
          <DimensionSection dim="initiative" buckets={dims.initiative} active={filters.initiative} onToggle={toggleFilter} />
          <DimensionSection dim="swimlane" buckets={dims.swimlane} active={filters.swimlane} onToggle={toggleFilter} />
          <p className="rounded-xl border border-border/50 bg-card/30 px-4 py-3 text-xs text-muted-foreground">
            💰 Budget health: {unbudgeted} unbudgeted (budget provider not yet connected).
          </p>
        </div>
      )}
    </div>
  );
}

function StatTag({ dot, value, label }: { dot: string; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1 text-sm">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function DimensionSection({
  dim,
  buckets,
  active,
  onToggle,
}: {
  dim: Dimension;
  buckets: Bucket[];
  active: string | null;
  onToggle: (dim: Dimension, value: string) => void;
}) {
  const { title, Icon, gradient } = DIMENSION_META[dim];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
            gradient,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {title}
        <span className="text-sm font-normal text-muted-foreground">({buckets.length})</span>
      </h2>
      {buckets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {title.replace("By ", "").toLowerCase()} labels yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {buckets.map((b) => {
            const selected = active != null && normLabel(active) === normLabel(b.value);
            return (
              <div
                key={b.value}
                className={cn(
                  "group relative overflow-hidden rounded-xl border px-4 py-3 transition",
                  selected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/60 bg-card/30 hover:border-primary/40 hover:bg-accent/40",
                )}
              >
                {/* count bar */}
                <div
                  className={cn(
                    "pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r opacity-10",
                    gradient,
                  )}
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
                <button
                  type="button"
                  onClick={() => onToggle(dim, b.value)}
                  className="relative flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br", gradient)} />
                    <span className="truncate font-medium">{b.value}</span>
                    <span className="shrink-0 text-sm font-semibold text-muted-foreground">· {b.count}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                    {Object.entries(b.statuses).map(([s, n]) => (
                      <span key={s} className="inline-flex items-center gap-1">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[s] ?? "bg-muted-foreground/30")} />
                        {n} {s}
                      </span>
                    ))}
                  </span>
                </button>
                <Link
                  href={`/projects?${dim}=${encodeURIComponent(b.value)}`}
                  className="pointer-events-auto absolute right-2 top-2 hidden rounded p-1 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100 sm:block"
                  title={`Open ${b.value} in Projects`}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
