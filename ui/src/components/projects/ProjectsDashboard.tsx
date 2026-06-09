"use client";

// assisted-by claude code claude-opus-4-8
//
// Executive dashboard (FR-010/011/012): rolls the project portfolio up by each
// label dimension — Domain, BHAG/Initiative, Swim Lane — with counts + status
// breakdown + drill-down to the filtered hub. Budget health is a placeholder
// until the manual provider lands (FR-019).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Globe, Layers, RefreshCw, Target, Waves } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { normLabel } from "@/lib/projects/labels";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  onboarding: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  draft: "bg-slate-500/15 text-slate-300 border-slate-400/30",
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
            <Boxes className="h-6 w-6 text-violet-400" />
            Executive Dashboard
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
        <SummaryCard label="Projects" value={projects.length} Icon={Boxes} />
        <SummaryCard label="Domains" value={dims.domain.length} Icon={Globe} />
        <SummaryCard label="Initiatives" value={dims.initiative.length} Icon={Target} />
        <SummaryCard label="Swim Lanes" value={dims.swimlane.length} Icon={Waves} />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading portfolio…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No projects yet. Onboard a project to populate the dashboard.
        </div>
      ) : (
        <div className="space-y-8">
          <DimensionSection title="By Domain" param="domain" Icon={Globe} buckets={dims.domain} />
          <DimensionSection title="By BHAG / Initiative" param="initiative" Icon={Target} buckets={dims.initiative} />
          <DimensionSection title="By Swim Lane" param="swimlane" Icon={Waves} buckets={dims.swimlane} />
          <p className="text-xs text-muted-foreground">
            Budget health: {unbudgeted} unbudgeted (budget provider not yet connected).
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
}: {
  label: string;
  value: number;
  Icon: typeof Boxes;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function DimensionSection({
  title,
  param,
  Icon,
  buckets,
}: {
  title: string;
  param: Dimension;
  Icon: typeof Globe;
  buckets: Bucket[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon className="h-5 w-5 text-muted-foreground" />
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
              className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card/30 px-4 py-3 hover:border-primary/40 hover:bg-accent/40"
            >
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{b.value}</span>
                <span className="text-sm text-muted-foreground">· {b.count}</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {Object.entries(b.statuses).map(([s, n]) => (
                  <Badge key={s} variant="outline" className={cn("text-[10px]", STATUS_STYLE[s])}>
                    {s} {n}
                  </Badge>
                ))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
