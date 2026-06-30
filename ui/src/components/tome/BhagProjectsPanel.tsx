"use client";

// The projects tagged to a BHAG (via `labels.initiatives`). Rendered inside the
// BHAG's Settings, in place of the Sources editor: a BHAG has no connectors —
// its "sources" are the wikis of the projects beneath it, which the ingest
// agent reads to synthesize the strategic view. Content-only (the caller
// supplies the section header).

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, FolderKanban } from "lucide-react";

import type { ProjectDocument } from "@/types/projects";

type ChildProject = ProjectDocument & {
  page_count?: number | null;
};

export function BhagProjectsPanel({ bhagName }: { bhagName: string }) {
  const [projects, setProjects] = useState<ChildProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Children are tagged with the BHAG's name as an initiative label; the list
    // API filters by initiative (OR within the dimension) and excludes BHAGs.
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects?initiative=${encodeURIComponent(bhagName)}`);
        const b = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(b?.error ?? "Failed to load projects");
        setProjects((b.data?.projects ?? []) as ChildProject[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [bhagName]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Projects tagged to this BHAG. The agent reads their wikis to synthesize this BHAG&apos;s
        wiki. Tag a project from its own Settings, under BHAG / Initiatives.
      </p>

      {loading && <p className="text-sm text-muted-foreground">Loading projects…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && projects.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm font-medium">No projects tagged yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add <span className="font-medium text-foreground">{bhagName}</span> under BHAG /
            Initiatives on a project to ladder it up to this goal.
          </p>
        </div>
      )}

      {projects.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {projects.map((p) => (
            <Link
              key={String(p._id)}
              href={`/projects/${p.slug}/tome`}
              className="group flex flex-col rounded-lg border border-border/60 bg-card/50 p-3 transition hover:border-violet-500/40"
            >
              <span className="font-medium leading-snug group-hover:text-violet-300">
                {p.title}
              </span>
              <span className="text-[11px] text-muted-foreground/50">{p.team_name}</span>
              <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                {p.page_count ?? 0} {(p.page_count ?? 0) === 1 ? "page" : "pages"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
