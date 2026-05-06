"use client";

/**
 * Reusable stage badge for Ship Loop UIs. Pulls icon + colour
 * tokens from `stage-visuals.ts` so every view (Pipeline, Kanban,
 * Timeline, repo grid, hero) renders the same stage with the same
 * affordances. If you tweak STAGE_VISUALS, every site below
 * benefits without a touch.
 */

import { cn } from "@/lib/utils";
import { STAGE_VISUALS } from "@/components/ship-loop/visualizations/stage-visuals";
import type { ShipLoopStage } from "@/types/ship-loop";

export interface StageBadgeProps {
  stage: ShipLoopStage;
  /** When true, hide the label text and render an icon-only chip. */
  compact?: boolean;
  /** Visual emphasis for "this is the active stage" surfaces. */
  emphasised?: boolean;
  className?: string;
}

export function StageBadge({
  stage,
  compact,
  emphasised,
  className,
}: StageBadgeProps) {
  const visual = STAGE_VISUALS[stage] ?? STAGE_VISUALS.unknown;
  const Icon = visual.icon;
  return (
    <span
      role="status"
      aria-label={`Stage: ${visual.label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        visual.bgClass,
        visual.fgClass,
        visual.borderClass,
        emphasised && "ring-1 ring-offset-1 ring-offset-background motion-safe:animate-pulse-glow",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {!compact && <span>{visual.label}</span>}
    </span>
  );
}
