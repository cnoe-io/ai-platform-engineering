"use client";

// assisted-by Codex Codex-sonnet-4-6

/**
 * Kanban view -- workload-shaped lanes the eye can scan for
 * pressure. Three lanes:
 *   Implement = stages: implement
 *   Review    = stages: review_hitl
 *   Deploy    = stages: deploy + observe
 *
 * Cards stack vertically in each lane; the lane header carries a
 * count + the StageBadge. We deliberately do NOT show the
 * specify/plan/tasks stages here -- those belong to the upstream
 * Pipeline view because they are too short-lived to occupy a lane.
 *
 * If no children are in a lane we render an empty-state placeholder
 * so the layout doesn't collapse mid-demo.
 */

import { cn } from "@/lib/utils";
import { ArtifactCard } from "@/components/agentic-sdlc/visualizations/ArtifactCard";
import { STAGE_VISUALS } from "@/components/agentic-sdlc/visualizations/stage-visuals";
import { StageBadge } from "@/components/agentic-sdlc/visualizations/StageBadge";
import type {
  AgenticSdlcArtifact,
  AgenticSdlcStage,
} from "@/types/agentic-sdlc";

interface KanbanLaneSpec {
  id: "implement" | "review" | "deploy";
  title: string;
  badgeStage: AgenticSdlcStage;
  acceptStages: AgenticSdlcStage[];
}

const LANES: KanbanLaneSpec[] = [
  {
    id: "implement",
    title: "Implement",
    badgeStage: "implement",
    acceptStages: ["implement"],
  },
  {
    id: "review",
    title: "Review",
    badgeStage: "review_hitl",
    acceptStages: ["review_hitl"],
  },
  {
    id: "deploy",
    title: "Deploy",
    badgeStage: "deploy",
    acceptStages: ["deploy", "observe"],
  },
];

interface KanbanViewProps {
  subtasks: AgenticSdlcArtifact[];
  pull_requests: AgenticSdlcArtifact[];
  deploys: AgenticSdlcArtifact[];
  needsMe: string[];
  className?: string;
}

export function KanbanView({
  subtasks,
  pull_requests,
  deploys,
  needsMe,
  className,
}: KanbanViewProps) {
  const all = [...subtasks, ...pull_requests, ...deploys];
  const needsMeSet = new Set(needsMe);

  return (
    <div
      className={cn(
        "grid w-full gap-4 grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))]",
        className,
      )}
      role="list"
      aria-label="Agentic SDLC kanban"
    >
      {LANES.map((lane) => {
        const cards = all.filter((a) => lane.acceptStages.includes(a.current_stage));
        const visual = STAGE_VISUALS[lane.badgeStage];
        return (
          <section
            key={lane.id}
            role="listitem"
            aria-label={lane.title}
            className={cn(
              "flex min-h-[14rem] min-w-0 flex-col gap-2 rounded-lg border p-3 sm:min-h-[18rem]",
              visual.bgClass,
              visual.borderClass,
            )}
          >
            <header className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <StageBadge stage={lane.badgeStage} compact />
                <span>{lane.title}</span>
              </h3>
              <span className="rounded bg-background/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {cards.length}
              </span>
            </header>
            <div className="flex flex-1 flex-col gap-2">
              {cards.length === 0 ? (
                <p className="my-auto rounded border border-dashed border-border/40 py-6 text-center text-[10px] text-muted-foreground/60">
                  No cards in {lane.title.toLowerCase()}
                </p>
              ) : (
                cards.map((a) => (
                  <ArtifactCard
                    key={`${a.kind}:${a.artifact_id}`}
                    artifact={a}
                    view="kanban"
                    needsMe={needsMeSet.has(a.artifact_id)}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
