"use client";

/**
 * LastReviewBadge — compact grade pill rendered in list views (the dynamic
 * agents table column, the skills card row) from a persisted `LastReview`.
 *
 * Renders nothing when no review has been recorded yet so the badge area
 * collapses naturally for legacy rows.
 */

import * as React from "react";
import { Grade } from "./Grade";
import { cn } from "@/lib/utils";
import type { LastReview } from "@/types/ai-review";

export interface LastReviewBadgeProps {
  review?: LastReview | null;
  size?: "sm" | "md";
  className?: string;
}

export function LastReviewBadge({
  review,
  size = "sm",
  className,
}: LastReviewBadgeProps) {
  if (!review) return null;
  const pct = Math.round((review.score ?? 0) * 100);
  const when = (() => {
    try {
      return new Date(review.reviewed_at).toLocaleString();
    } catch {
      return review.reviewed_at;
    }
  })();
  return (
    <span
      title={`AI Review ${review.grade} · ${pct}% · ${when}`}
      className={cn("inline-flex", className)}
    >
      <Grade grade={review.grade} score={review.score} size={size} />
    </span>
  );
}
