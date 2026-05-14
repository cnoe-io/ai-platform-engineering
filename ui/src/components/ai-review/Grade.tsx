"use client";

/**
 * Tiny presentational badge that shows the letter grade for a review run.
 * Color follows the bucket: A green, B blue, C amber, D orange, F red.
 *
 * The score is shown alongside in the panel header; this component handles
 * just the letter pill so it can be reused next to inline buttons too.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { ReviewGrade } from "@/types/ai-review";

export interface GradeProps {
  grade: ReviewGrade;
  /** Pass ratio in [0, 1]. Currently rendered as a tooltip / aria label. */
  score: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const GRADE_CLASSES: Record<ReviewGrade, string> = {
  A: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  B: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  C: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  D: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  F: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

const SIZE_CLASSES: Record<NonNullable<GradeProps["size"]>, string> = {
  sm: "h-6 w-6 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-12 w-12 text-xl",
};

export function Grade({ grade, score, size = "md", className }: GradeProps) {
  const pct = Math.round((score ?? 0) * 100);
  return (
    <div
      role="img"
      aria-label={`Grade ${grade} (${pct}%)`}
      title={`${pct}%`}
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-bold tabular-nums",
        GRADE_CLASSES[grade],
        SIZE_CLASSES[size],
        className,
      )}
    >
      {grade}
    </div>
  );
}
