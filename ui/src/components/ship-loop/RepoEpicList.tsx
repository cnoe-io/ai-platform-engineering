"use client";

/**
 * Per-repo Epic list. Fetches
 * `/api/ship-loop/repos/{owner}/{repo}/epics` and renders a row per
 * Epic with stage badge, child counts, "needs human" indicator, and
 * a deep link into the Epic page.
 *
 * Filters surfaced inline (stage / needs_human / stalled) so the
 * pilot operator can drive directly to "what is in review right
 * now" without having to learn a query DSL.
 */

import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { StageBadge } from "@/components/ship-loop/visualizations/StageBadge";
import {
  ORBIT_STAGES,
  STAGE_VISUALS,
} from "@/components/ship-loop/visualizations/stage-visuals";
import type { ShipLoopStage } from "@/types/ship-loop";

interface EpicRow {
  artifact_id: string;
  title: string;
  current_stage: ShipLoopStage;
  needs_human: boolean;
  stalled_since: string | null;
  child_counts: { subtasks: number; prs: number; deploys: number };
  github_url: string;
  last_event_at: string;
}

interface EpicListResponse {
  items: EpicRow[];
  next_cursor: string | null;
}

interface RepoEpicListProps {
  owner: string;
  repo: string;
}

export function RepoEpicList({ owner, repo }: RepoEpicListProps) {
  const [items, setItems] = useState<EpicRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<ShipLoopStage | "">("");
  const [needsHuman, setNeedsHuman] = useState(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    const params = new URLSearchParams();
    if (stage) params.set("stage", stage);
    if (needsHuman) params.set("needs_human", "true");
    if (stalled) params.set("stalled", "true");
    const qs = params.toString();
    const url = `/api/ship-loop/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/epics${qs ? `?${qs}` : ""}`;

    (async () => {
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setError(`http_${res.status}`);
          return;
        }
        const body = (await res.json()) as EpicListResponse;
        if (!cancelled) setItems(body.items ?? []);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "fetch_failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, stage, needsHuman, stalled]);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-card/30 p-2 text-xs">
        <Search className="h-3 w-3 text-muted-foreground" aria-hidden />
        <label className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Stage</span>
          <select
            className="rounded border border-border/40 bg-background px-1.5 py-0.5"
            value={stage}
            onChange={(e) => setStage(e.target.value as ShipLoopStage | "")}
          >
            <option value="">any</option>
            {ORBIT_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_VISUALS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={needsHuman}
            onChange={(e) => setNeedsHuman(e.target.checked)}
          />
          <span className="text-muted-foreground">Needs human</span>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={stalled}
            onChange={(e) => setStalled(e.target.checked)}
          />
          <span className="text-muted-foreground">Stalled</span>
        </label>
      </header>

      {error && (
        <div
          className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300"
          role="alert"
        >
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
          Could not load Epics ({error}).
        </div>
      )}

      {items === null && !error && (
        <div className="flex items-center justify-center rounded-md border border-border/40 bg-card/30 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />
          Loading Epics…
        </div>
      )}

      {items !== null && items.length === 0 && (
        <div className="rounded-md border border-dashed border-border/40 bg-card/20 px-3 py-6 text-center text-xs text-muted-foreground">
          No Epics match the current filters.
        </div>
      )}

      {items !== null && items.length > 0 && (
        <ol
          role="list"
          aria-label="Epics"
          className="flex flex-col gap-2"
        >
          {items.map((e) => (
            <li key={e.artifact_id}>
              <Link
                href={`/ship-loop/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/epics/${encodeURIComponent(e.artifact_id)}`}
                className={cn(
                  "group flex items-center gap-3 rounded-md border border-border/40 bg-card/40 px-3 py-2.5 transition hover:bg-card/70",
                )}
              >
                <StageBadge stage={e.current_stage} compact />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {e.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.child_counts.subtasks} sub-tasks ·{" "}
                    {e.child_counts.prs} PRs · {e.child_counts.deploys} deploys
                    {e.stalled_since ? " · stalled" : ""}
                  </p>
                </div>
                {e.needs_human && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                    Needs human
                  </span>
                )}
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground/60 transition group-hover:text-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
