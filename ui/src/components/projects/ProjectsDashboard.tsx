"use client";

// assisted-by claude code claude-opus-4-8
//
// Executive dashboard (FR-010/011/012): rolls the project portfolio up by each
// label dimension — Domain, BHAG/Initiative, Swim Lane — with counts + status
// breakdown + drill-down to the filtered hub. Budget health is a placeholder
// until the manual provider lands (FR-019).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Globe, RefreshCw, Target, Waves } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { normLabel } from "@/lib/projects/labels";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  onboarding: "bg-slate-100 text-slate-600 border-slate-200",
  draft: "bg-slate-50 text-slate-500 border-slate-200",
  archived: "bg-muted text-muted-foreground border-border",
};

type Dimension = "domain" | "initiative" | "swimlane";

interface Bucket {
  value: string;
  count: number;
  statuses: Record<string, number>;
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

  const dims = useMemo(
    () => ({
      domain: bucketize(projects, (p) => [p.labels?.domain ?? p.domain]),
      initiative: bucketize(projects, (p) => p.labels?.initiatives ?? []),
      swimlane: bucketize(projects, (p) => p.labels?.swimlanes ?? []),
    }),
    [projects],
  );

  const unbudgeted = projects.length; // placeholder until budget provider lands

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-sm">
              <Boxes className="h-5 w-5" />
            </span>
            <span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 bg-clip-text text-transparent">
              Executive Dashboard
            </span>
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

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryCard label="Projects" value={projects.length} Icon={Boxes} gradient="from-violet-600 to-indigo-600" />
        <SummaryCard label="Domains" value={dims.domain.length} Icon={Globe} gradient="from-sky-500 to-blue-600" />
        <SummaryCard label="Initiatives" value={dims.initiative.length} Icon={Target} gradient="from-amber-500 to-orange-600" />
        <SummaryCard label="Swim Lanes" value={dims.swimlane.length} Icon={Waves} gradient="from-emerald-500 to-teal-600" />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading portfolio…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No projects yet. Onboard a project to populate the dashboard.
        </div>
      ) : (
        <div className="space-y-8">
          <DimensionSection title="By Domain" param="domain" Icon={Globe} buckets={dims.domain} gradient="from-sky-500 to-blue-600" />
          <DimensionSection title="By BHAG / Initiative" param="initiative" Icon={Target} buckets={dims.initiative} gradient="from-amber-500 to-orange-600" />
          <DimensionSection title="By Swim Lane" param="swimlane" Icon={Waves} buckets={dims.swimlane} gradient="from-emerald-500 to-teal-600" />
          <p className="rounded-xl border border-border/50 bg-card/30 px-4 py-3 text-xs text-muted-foreground">
            💰 Budget health: {unbudgeted} unbudgeted (budget provider not yet connected).
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  Icon,
  gradient,
}: {
  label: string;
  value: number;
  Icon: typeof Boxes;
  gradient: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-4">
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-20 blur-2xl",
          gradient,
        )}
      />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
            gradient,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function DimensionSection({
  title,
  param,
  Icon,
  buckets,
  gradient,
}: {
  title: string;
  param: Dimension;
  Icon: typeof Globe;
  buckets: Bucket[];
  gradient: string;
}) {
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
          {buckets.map((b) => (
            <Link
              key={b.value}
              href={`/projects?${param}=${encodeURIComponent(b.value)}`}
              className="group relative overflow-hidden rounded-xl border border-border/60 bg-card/30 px-4 py-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/40 hover:shadow-md"
            >
              {/* count bar */}
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r opacity-10",
                  gradient,
                )}
                style={{ width: `${(b.count / max) * 100}%` }}
              />
              <div className="relative flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br", gradient)} />
                  <span className="truncate font-medium">{b.value}</span>
                  <span className="shrink-0 text-sm font-semibold text-muted-foreground">· {b.count}</span>
                </span>
                <span className="flex flex-wrap justify-end gap-1">
                  {Object.entries(b.statuses).map(([s, n]) => (
                    <Badge key={s} variant="outline" className={cn("text-[10px]", STATUS_STYLE[s])}>
                      {s} {n}
                    </Badge>
                  ))}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
