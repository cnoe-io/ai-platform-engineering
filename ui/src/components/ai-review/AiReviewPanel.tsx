"use client";

/**
 * AiReviewPanel — GitHub-style right-rail panel that renders the latest
 * `ReviewResult`. The component is purely presentational: all state and
 * actions come from a `useAiReview` result object passed in by the parent.
 *
 * Layout:
 *   - Header: grade badge + score + "N/M passed" caption + run/apply-all
 *     buttons.
 *   - Body: scrollable list of CommentCards. Failing criteria first
 *     (sorted error → warning → info), then collapsed passing rows.
 *   - Empty / loading / error states swap into the body region.
 *   - When the consumer's config is disabled, the component renders null.
 *   - Collapsible by default — when collapsed, the panel is a thin rail.
 */

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type {
CriterionVerdict,
ReviewAnchor,
ReviewSeverity,
} from "@/types/ai-review";
import {
AlertTriangle,
ChevronLeft,
ChevronRight,
Loader2,
RotateCw,
ShieldCheck,
Wand2,
} from "lucide-react";
import * as React from "react";
import { CommentCard } from "./CommentCard";
import { Grade } from "./Grade";
import type { UseAiReviewResult } from "./use-ai-review";

export interface AiReviewPanelProps {
  review: UseAiReviewResult;
  /** When false, the panel cannot be collapsed by the user. Default: true. */
  collapsible?: boolean;
  /** Forwarded to each `CommentCard` so anchor clicks can scroll the editor. */
  onClickAnchor?: (anchor: ReviewAnchor) => void;
  className?: string;
  /** Inline style — used by consumers to pin the panel to the editor's height
   *  so the comment list scrolls internally instead of stretching the row. */
  style?: React.CSSProperties;
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function sortVerdicts(criteria: CriterionVerdict[] | undefined): CriterionVerdict[] {
  if (!criteria) return [];
  // Failing first (by severity), then passing collapse rows.
  return [...criteria].sort((a, b) => {
    if (a.pass !== b.pass) return a.pass ? 1 : -1;
    if (!a.pass) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return a.name.localeCompare(b.name);
  });
}

export function AiReviewPanel({
  review,
  collapsible = true,
  onClickAnchor,
  className,
  style,
}: AiReviewPanelProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const { toast } = useToast();

  // Surface the "no changes since last review" signal as an info toast rather
  // than an inline banner, then clear it so it fires once per cached run.
  const { notice, clearNotice } = review;
  React.useEffect(() => {
    if (notice === "cached") {
      toast("Content is unchanged since the last review.", "info");
      clearNotice();
    }
  }, [notice, clearNotice, toast]);

  // Hide entirely when the target isn't configured / is disabled.
  if (!review.enabled) return null;

  if (collapsible && collapsed) {
    return (
      <div
        className={cn(
          "flex w-10 shrink-0 flex-col items-center border-l bg-muted/20 py-2",
          className,
        )}
        style={style}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand AI Review panel"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <ShieldCheck className="mt-3 h-4 w-4 text-primary" />
      </div>
    );
  }

  const sorted = review.result ? sortVerdicts(review.result.criteria) : [];
  const totalCriteria = review.result?.total ?? 0;
  const passedCount = review.result?.passed_count ?? 0;
  // Sum of all criterion weights — the denominator each card uses to show what
  // share of the grade a failing check is worth (e.g. "15% of grade").
  const totalWeight = (review.result?.criteria ?? []).reduce(
    (sum, v) => sum + (Number.isFinite(v.weight) && v.weight > 0 ? v.weight : 0),
    0,
  );
  const fixableUnapplied = sorted.filter(
    (v) => v.suggested_fix && !review.appliedFixIds.has(v.id) && !v.pass,
  ).length;

  return (
    <aside
      className={cn(
        "flex w-96 shrink-0 flex-col border-l bg-background min-h-0",
        className,
      )}
      style={style}
      aria-label="AI Review panel"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-3 min-w-0">
          {review.result ? (
            <Grade grade={review.result.grade} score={review.result.score} size="lg" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border/50 text-muted-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold flex items-center gap-1.5">
              AI Review
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {review.result
                ? `${passedCount}/${totalCriteria} criteria passed`
                : `Reviews ${review.config?.criteria.length ?? 0} criteria`}
            </div>
          </div>
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse AI Review panel"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void review.run()}
          disabled={review.status === "running"}
        >
          {review.status === "running" ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <RotateCw className="h-3 w-3 mr-1" />
          )}
          {review.result ? "Run again" : "Run review"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => review.applyAllFixes()}
          disabled={fixableUnapplied === 0 || review.status === "running"}
        >
          <Wand2 className="h-3 w-3 mr-1" />
          Apply all fixes
          {fixableUnapplied > 0 ? ` (${fixableUnapplied})` : ""}
        </Button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {review.status === "idle" && !review.result && (
            <div className="rounded-md border border-dashed border-border/50 p-4 text-center text-xs text-muted-foreground">
              Click <span className="font-medium">AI Review</span> to grade this content.
            </div>
          )}

          {review.status === "running" && (
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 p-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {review.config
                ? `Reviewing ${review.config.criteria.length} criteria…`
                : "Reviewing…"}
            </div>
          )}

          {review.status === "error" && review.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{review.error}</span>
            </div>
          )}

          {sorted.map((verdict) => (
            <CommentCard
              key={verdict.id}
              verdict={verdict}
              totalWeight={totalWeight}
              applied={review.appliedFixIds.has(verdict.id)}
              dismissed={review.dismissedIds.has(verdict.id)}
              onApplyFix={() => review.applyFix(verdict.id)}
              onDismiss={() => review.dismiss(verdict.id)}
              onClickAnchor={onClickAnchor}
              getPreview={() => review.previewFix(verdict.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
