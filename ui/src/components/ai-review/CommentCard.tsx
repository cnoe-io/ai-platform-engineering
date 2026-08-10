"use client";

/**
 * CommentCard — one criterion verdict in the AI Review panel.
 *
 * Failing criteria render expanded with severity icon, comment, and the
 * Apply fix / Dismiss action row. Passing criteria collapse to a small
 * green-checkmark + name row so the panel doesn't drown in noise on a
 * mostly-passing run.
 */

import { diffLines,type DiffLine } from "@/components/ai-assist/diff-lines";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
CriterionVerdict,
ReviewAnchor,
ReviewSeverity,
} from "@/types/ai-review";
import {
AlertCircle,
AlertTriangle,
Check,
CheckCircle2,
Info,
Wand2,
X,
} from "lucide-react";
import * as React from "react";

export interface CommentCardProps {
  verdict: CriterionVerdict;
  /** Sum of all criterion weights — denominator for this check's grade share. */
  totalWeight: number;
  applied: boolean;
  dismissed: boolean;
  onApplyFix: () => void;
  onDismiss: () => void;
  onClickAnchor?: (anchor: ReviewAnchor) => void;
  /** Returns the before/after pair the suggested fix would produce. Used to
   *  show a diff preview before the user commits to applying. */
  getPreview?: () => { before: string; after: string } | null;
}

const SEVERITY_ICON: Record<ReviewSeverity, React.ComponentType<{ className?: string }>> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_BADGE_VARIANT: Record<
  ReviewSeverity,
  "destructive" | "secondary" | "outline"
> = {
  error: "destructive",
  warning: "secondary",
  info: "outline",
};

const SEVERITY_ICON_CLASS: Record<ReviewSeverity, string> = {
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-sky-500",
};

export function CommentCard({
  verdict,
  totalWeight,
  applied,
  dismissed,
  onApplyFix,
  onDismiss,
  onClickAnchor,
  getPreview,
}: CommentCardProps) {
  const [showDiff, setShowDiff] = React.useState(false);
  const preview = React.useMemo(
    () => (showDiff && getPreview ? getPreview() : null),
    [showDiff, getPreview],
  );
  const diff = React.useMemo<DiffLine[]>(
    () => (preview ? diffLines(preview.before, preview.after) : []),
    [preview],
  );

  if (dismissed) return null;

  // Passing criteria render compact — they're not actionable.
  if (verdict.pass) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span className="truncate">{verdict.name}</span>
      </div>
    );
  }

  const Icon = SEVERITY_ICON[verdict.severity];
  const hasFix = verdict.suggested_fix !== null;
  const hasAnchor = verdict.anchor !== null;
  // Share of the overall grade this failing check costs. Shown as a percentage
  // so the number is meaningful on its own ("worth 15% of the grade") rather
  // than a bare weight whose denominator the user can't see.
  const gradeShare =
    totalWeight > 0 ? Math.round((verdict.weight / totalWeight) * 100) : 0;

  const handleAnchorClick = () => {
    if (verdict.anchor && onClickAnchor) onClickAnchor(verdict.anchor);
  };

  return (
    <div
      className={cn(
        "rounded-md border bg-card p-3 text-sm",
        applied ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/50",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn("h-4 w-4 mt-0.5 shrink-0", SEVERITY_ICON_CLASS[verdict.severity])}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium leading-tight">{verdict.name}</span>
            <Badge
              variant={SEVERITY_BADGE_VARIANT[verdict.severity]}
              className="text-[10px] uppercase tracking-wide"
            >
              {verdict.severity}
            </Badge>
            {gradeShare > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] tracking-wide"
                title={`This check is weight ${verdict.weight} of ${totalWeight} total — failing it costs ${gradeShare}% of the grade`}
              >
                {gradeShare}% of grade
              </Badge>
            )}
            {hasAnchor && (
              <button
                type="button"
                onClick={handleAnchorClick}
                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                title="Jump to line in the editor"
              >
                line {verdict.anchor!.line_start + 1}
                {verdict.anchor!.line_end !== verdict.anchor!.line_start
                  ? `–${verdict.anchor!.line_end + 1}`
                  : ""}
              </button>
            )}
          </div>
          {verdict.comment && (
            <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-words">
              {verdict.comment}
            </p>
          )}
          {verdict.error && (
            <p className="mt-1 text-xs text-destructive break-all">
              Review error: {verdict.error}
            </p>
          )}

          {showDiff && preview && (
            <div className="mt-2 rounded-md border border-border/50 bg-muted/20">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
                {verdict.suggested_fix?.summary || "Proposed change"}
              </div>
              <div className="px-2 py-1 text-xs font-mono max-h-48 overflow-y-auto">
                {diff.map((line, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "whitespace-pre-wrap break-words leading-snug",
                      line.op === "add" &&
                        "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      line.op === "remove" &&
                        "bg-rose-500/10 text-rose-700 dark:text-rose-300 line-through",
                    )}
                  >
                    <span className="select-none mr-1 text-muted-foreground">
                      {line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}
                    </span>
                    {line.text || " "}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5">
            {hasFix && !showDiff && !applied && (
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => setShowDiff(true)}
                title={verdict.suggested_fix?.summary}
                className="h-7 text-xs"
              >
                <Wand2 className="h-3 w-3 mr-1" />
                Preview fix
              </Button>
            )}
            {hasFix && showDiff && !applied && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => {
                    onApplyFix();
                    setShowDiff(false);
                  }}
                  className="h-7 text-xs"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Apply
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowDiff(false)}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </>
            )}
            {hasFix && applied && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled
                className="h-7 text-xs"
              >
                <Check className="h-3 w-3 mr-1" />
                Applied
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="h-7 text-xs text-muted-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
