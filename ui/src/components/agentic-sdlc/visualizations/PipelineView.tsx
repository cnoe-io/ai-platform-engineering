"use client";

// assisted-by Codex Codex-sonnet-4-6

/**
 * Pipeline view -- the canonical "Agentic SDLC delivery loop" rendering.
 *
 * Eight stages from `ORBIT_STAGES` arranged left-to-right; under
 * each stage we render the children of the Epic that currently sit
 * there, plus the Epic itself in its own stage. The columns share a
 * subtle background colour pulled from `STAGE_VISUALS.bgClass` so
 * the eye can map cards back to stages without reading the header.
 *
 * Why pipeline ≠ kanban: pipeline is process-shaped (every stage is
 * a column even when empty), kanban is workload-shaped (only
 * Implement / Review / Deploy lanes shown, with depth indicating
 * pressure). Both views consume the same EpicShipState slice.
 */

import { Bot, GitPullRequest, Rocket, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { ArtifactCard } from "@/components/agentic-sdlc/visualizations/ArtifactCard";
import {
  ORBIT_STAGES,
  STAGE_VISUALS,
} from "@/components/agentic-sdlc/visualizations/stage-visuals";
import { StageBadge } from "@/components/agentic-sdlc/visualizations/StageBadge";
import type {
  AgenticSdlcArtifact,
  AgenticSdlcStage,
} from "@/types/agentic-sdlc";

interface PipelineViewProps {
  epic: AgenticSdlcArtifact | null;
  subtasks: AgenticSdlcArtifact[];
  pull_requests: AgenticSdlcArtifact[];
  deploys: AgenticSdlcArtifact[];
  /** ids the caller should review/approve. */
  needsMe: string[];
  className?: string;
}

export function PipelineView({
  epic,
  subtasks,
  pull_requests,
  deploys,
  needsMe,
  className,
}: PipelineViewProps) {
  const all: AgenticSdlcArtifact[] = [...subtasks, ...pull_requests, ...deploys];
  const grouped = groupByStage(all, epic);
  const needsMeSet = new Set(needsMe);

  return (
    <div
      className={cn(
        "grid w-full gap-3",
        "grid-cols-[repeat(auto-fit,minmax(min(10.5rem,100%),1fr))]",
        className,
      )}
      role="list"
      aria-label="Agentic SDLC pipeline"
    >
      {ORBIT_STAGES.map((stage) => {
        const visual = STAGE_VISUALS[stage];
        const cards = grouped.get(stage) ?? [];
        return (
          <section
            key={stage}
            role="listitem"
            aria-label={visual.label}
            className={cn(
              "flex min-h-[10rem] min-w-0 flex-col gap-2 rounded-lg border p-2.5",
              visual.bgClass,
              visual.borderClass,
            )}
          >
            <header className="flex items-center justify-between">
              <StageBadge stage={stage} />
              <span className="text-[10px] font-medium text-muted-foreground">
                {cards.length}
              </span>
            </header>
            <p className="text-[10px] leading-snug text-muted-foreground">
              {visual.blurb}
            </p>
            <div className="flex flex-col gap-1.5">
              {cards.length === 0 ? (
                <p className="rounded border border-dashed border-border/40 px-2 py-3 text-center text-[10px] text-muted-foreground/60">
                  empty
                </p>
              ) : (
                cards.map((a) => (
                  <ArtifactCard
                    key={`${a.kind}:${a.artifact_id}`}
                    artifact={a}
                    view="pipeline"
                    needsMe={needsMeSet.has(a.artifact_id)}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}

      {/* Footer counts for at-a-glance scanning, matching the density of
          the existing dashboards in this app. */}
      <div className="col-span-full flex flex-wrap items-center gap-3 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <User className="h-3 w-3" aria-hidden /> Humans drive
          <Bot className="h-3 w-3 text-primary" aria-hidden /> agents work
        </span>
        <Pill icon={GitPullRequest} label={`${pull_requests.length} PRs`} />
        <Pill icon={Rocket} label={`${deploys.length} deploys`} />
        <Pill icon={null} label={`${subtasks.length} sub-tasks`} />
      </div>
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> | null;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border/40 bg-background/40 px-1.5 py-0.5 text-muted-foreground">
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {label}
    </span>
  );
}

function groupByStage(
  artifacts: AgenticSdlcArtifact[],
  epic: AgenticSdlcArtifact | null,
): Map<AgenticSdlcStage, AgenticSdlcArtifact[]> {
  const out = new Map<AgenticSdlcStage, AgenticSdlcArtifact[]>();
  if (epic) {
    const list = out.get(epic.current_stage) ?? [];
    list.push(epic);
    out.set(epic.current_stage, list);
  }
  for (const a of artifacts) {
    const list = out.get(a.current_stage) ?? [];
    list.push(a);
    out.set(a.current_stage, list);
  }
  return out;
}
