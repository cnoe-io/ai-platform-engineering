"use client";

/**
 * Page-level shell for `/ship-loop/{owner}/{repo}/epics/{epicId}`.
 *
 * Owns the data hook (`useEpicShipState`), exposes a tab switcher
 * for Pipeline / Kanban / Timeline, and renders a header strip with
 * the Epic title, current stage, "needs you" callouts, and live
 * stream status.
 *
 * Splits cleanly: visualisations are render-only consumers of the
 * state object so swapping in a new mode is a one-line addition
 * here.
 */

import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useEpicShipState } from "@/hooks/use-epic-ship-state";
import { cn } from "@/lib/utils";
import { KanbanView } from "@/components/ship-loop/visualizations/KanbanView";
import { PipelineView } from "@/components/ship-loop/visualizations/PipelineView";
import { TimelineView } from "@/components/ship-loop/visualizations/TimelineView";
import { StageBadge } from "@/components/ship-loop/visualizations/StageBadge";

interface EpicViewProps {
  owner: string;
  repo: string;
  epicId: string;
}

type ViewMode = "pipeline" | "kanban" | "timeline";

const VIEW_MODES: Array<{ id: ViewMode; label: string }> = [
  { id: "pipeline", label: "Pipeline" },
  { id: "kanban", label: "Kanban" },
  { id: "timeline", label: "Timeline" },
];

export function EpicView({ owner, repo, epicId }: EpicViewProps) {
  const [mode, setMode] = useState<ViewMode>("pipeline");
  const { state, loading, error, status, terminal, refetch, reconnect } =
    useEpicShipState({ owner, repo, epicId, enabled: true });

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-col gap-2 rounded-lg border border-border/40 bg-card/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {owner} / {repo}
            </p>
            <h1 className="truncate text-xl font-semibold text-foreground">
              {state.epic?.title ?? (loading ? "Loading…" : `Epic ${epicId}`)}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {state.epic && <StageBadge stage={state.epic.current_stage} emphasised />}
              {state.epic?.github_url && (
                <Link
                  href={state.epic.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Open on GitHub
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right text-xs">
            <StreamStatusBadge status={status} terminal={terminal} />
            {state.needs_me.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {state.needs_me.length} needs you
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="View mode" className="flex gap-1">
            {VIEW_MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition",
                  mode === m.id
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            {error && (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {error}
              </span>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-border/50 px-2 py-0.5 hover:bg-muted/40"
              onClick={refetch}
              aria-label="Refetch"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden />
              Refetch
            </button>
            {terminal && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-amber-400/40 px-2 py-0.5 text-amber-300 hover:bg-amber-500/10"
                onClick={reconnect}
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      </header>

      <main role="region" aria-label="Epic visualisation">
        {mode === "pipeline" && (
          <PipelineView
            epic={state.epic}
            subtasks={state.subtasks}
            pull_requests={state.pull_requests}
            deploys={state.deploys}
            needsMe={state.needs_me}
          />
        )}
        {mode === "kanban" && (
          <KanbanView
            subtasks={state.subtasks}
            pull_requests={state.pull_requests}
            deploys={state.deploys}
            needsMe={state.needs_me}
          />
        )}
        {mode === "timeline" && <TimelineView events={state.recent_events} />}
      </main>
    </div>
  );
}

function StreamStatusBadge({
  status,
  terminal,
}: {
  status: ReturnType<typeof useEpicShipState>["status"];
  terminal: string | null;
}) {
  if (terminal) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-red-300">
        <WifiOff className="h-3 w-3" aria-hidden />
        {terminal}
      </span>
    );
  }
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
        <span
          className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
          aria-hidden
        />
        Live
      </span>
    );
  }
  if (status === "reconnecting" || status === "connecting") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
        <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-muted-foreground">
      {status}
    </span>
  );
}
