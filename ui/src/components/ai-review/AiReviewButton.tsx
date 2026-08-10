"use client";

/**
 * AiReviewButton — sibling to the existing AI Suggest button, but kicks off
 * an AI Review run instead. Visual treatment matches the AI Suggest pill in
 * `DynamicAgentEditor.tsx` (small, outlined, primary tint) so the two
 * controls feel like a coherent toolbar.
 *
 * Label states:
 *   - `running`  → spinner + "Reviewing…"
 *   - `isPassed` → checkmark + grade pill ("Reviewed: B")
 *   - default    → shield + "AI Review"
 *
 * The parent owns panel visibility — clicking the button only triggers
 * `review.run()`. If the parent renders `AiReviewPanel`, the new result
 * lands there automatically because both subscribe to the same hook.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check,Loader2,ShieldCheck } from "lucide-react";
import type { UseAiReviewResult } from "./use-ai-review";

export interface AiReviewButtonProps {
  review: UseAiReviewResult;
  size?: "sm" | "md";
  className?: string;
}

export function AiReviewButton({ review, size = "sm", className }: AiReviewButtonProps) {
  const running = review.status === "running";
  const disabled = !review.enabled || running;

  const heightClass = size === "md" ? "h-8" : "h-7";

  const label = running ? (
    <>
      <Loader2 className="h-3 w-3 animate-spin" />
      Reviewing…
    </>
  ) : review.isPassed && review.result ? (
    <>
      <Check className="h-3 w-3" />
      Reviewed: {review.result.grade}
    </>
  ) : (
    <>
      <ShieldCheck className="h-3 w-3" />
      AI Review
    </>
  );

  const title = !review.enabled
    ? "AI Review is not configured for this target"
    : running
      ? "Review in progress…"
      : review.isPassed && review.result
        ? `Last review: grade ${review.result.grade}`
        : "Run AI Review";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => void review.run()}
      title={title}
      className={cn(
        heightClass,
        "text-xs gap-1 px-2 border-primary/30 text-primary hover:bg-primary/10",
        className,
      )}
    >
      {label}
    </Button>
  );
}
