"use client";

/**
 * AiAssistButton — sparkles trigger + popover for the generic AI Assist
 * flow. Drop one next to any text input:
 *
 *   <AiAssistButton
 *     task="describe-skill"
 *     getContext={() => ({ name: form.name, current_value: form.description })}
 *     onApply={(text) => setFormField(text)}
 *   />
 *
 * UX:
 *   1. Click sparkles → popover anchored to the button.
 *   2. User types an instruction (or hits "Suggest" with empty input to
 *      use the field's current state alone).
 *   3. Result streams into a preview pane.
 *   4. If the field was non-empty when the run started, show a side-by-side
 *      diff (current vs. proposal). If empty, show the proposal alone.
 *   5. "Apply" calls onApply with the new text; "Discard" closes without
 *      changes; "Try again" re-runs with the same instruction.
 *
 * The trigger and popover content live inside one `<Popover>` so the
 * existing positioning/click-outside logic just works.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  X,
  Check,
  RotateCw,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAiAssist, type AiAssistContext } from "./use-ai-assist";
import { diffLines, type DiffLine } from "./diff-lines";
import type { AiAssistTaskId } from "@/lib/server/ai-assist-tasks";

export interface AiAssistButtonProps {
  /**
   * Default task to run. Used when `resolveTask` is not provided, or when
   * `resolveTask` returns `undefined`.
   */
  task: AiAssistTaskId;
  /**
   * Optional dynamic task selector. Called immediately before each run with
   * the freshly-built context, so the popover can pick a different task
   * based on the current field value (e.g. switch generate ↔ enhance when
   * the field is empty / non-empty). Return `undefined` to fall back to
   * `task`.
   */
  resolveTask?: (ctx: AiAssistContext) => AiAssistTaskId | undefined;
  /**
   * Build the context bag at click time. Pulled at start of every run so
   * the popover always sees the current field value (no stale closures).
   */
  getContext: () => AiAssistContext;
  /** Called when the user accepts the proposal. */
  onApply: (text: string) => void;
  /**
   * Suggestions to seed the instruction input — e.g. ["Make concise",
   * "Add an example"]. Clicking a chip submits immediately.
   */
  presets?: string[];
  /** Compact label next to the sparkles icon. Default: "AI". */
  label?: string;
  /** Hide the label, render icon-only. Default: false. */
  iconOnly?: boolean;
  /** Disable everything (e.g. while the parent is saving). */
  disabled?: boolean;
  /** Forwarded to the trigger button for layout integration. */
  className?: string;
  /** Override popover side. Default: "bottom" / "end". */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** test id for the trigger. */
  triggerTestId?: string;
}

export function AiAssistButton({
  task,
  resolveTask,
  getContext,
  onApply,
  presets,
  label = "AI",
  iconOnly = false,
  disabled,
  className,
  side = "bottom",
  align = "end",
  triggerTestId,
}: AiAssistButtonProps) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [hasResult, setHasResult] = useState(false);
  const [activeTask, setActiveTask] = useState<AiAssistTaskId>(task);

  const assist = useAiAssist({ task });

  const handleSubmit = useCallback(
    async (override?: string) => {
      const ask = (override ?? instruction).trim();
      const ctx = getContext();
      const ctxWithAsk: AiAssistContext = {
        ...ctx,
        instruction: ask || ctx.instruction,
      };
      const chosen = resolveTask?.(ctxWithAsk) ?? task;
      setActiveTask(chosen);
      await assist.run(ctxWithAsk, chosen);
      setHasResult(true);
    },
    [assist, getContext, instruction, resolveTask, task],
  );

  const handlePreset = useCallback(
    (preset: string) => {
      setInstruction(preset);
      void handleSubmit(preset);
    },
    [handleSubmit],
  );

  const handleApply = useCallback(() => {
    if (!assist.result) return;
    onApply(assist.result);
    setOpen(false);
    // Defer the reset so the close animation doesn't see a flicker.
    setTimeout(() => {
      assist.reset();
      setInstruction("");
      setHasResult(false);
    }, 150);
  }, [assist, onApply]);

  const handleDiscard = useCallback(() => {
    assist.cancel();
    setOpen(false);
    setTimeout(() => {
      assist.reset();
      setInstruction("");
      setHasResult(false);
    }, 150);
  }, [assist]);

  const handleRetry = useCallback(() => {
    setHasResult(false);
    void handleSubmit();
  }, [handleSubmit]);

  const showDiff = useMemo(
    () =>
      hasResult &&
      assist.result.length > 0 &&
      assist.snapshot.length > 0 &&
      assist.snapshot.trim() !== assist.result.trim(),
    [hasResult, assist.result, assist.snapshot],
  );

  const diff = useMemo(
    () => (showDiff ? diffLines(assist.snapshot, assist.result) : []),
    [showDiff, assist.snapshot, assist.result],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid={triggerTestId ?? "ai-assist-trigger"}
          aria-label={`AI Assist: ${task}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs font-medium",
            "hover:bg-muted hover:border-border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {!iconOnly && <span>{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-[420px] max-w-[95vw] p-0"
      >
        <div
          className="flex flex-col"
          data-testid="ai-assist-popover"
          role="dialog"
          aria-label="AI Assist"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Wand2 className="h-3.5 w-3.5 text-primary" />
              AI Assist · {activeTask}
            </div>
            <button
              type="button"
              onClick={handleDiscard}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Instruction input + presets */}
          <div className="p-3 space-y-2">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Tell AI what you want… (⌘/Ctrl+Enter to submit)"
              rows={2}
              disabled={assist.isBusy}
              className={cn(
                "w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                "disabled:opacity-60",
              )}
              aria-label="AI Assist instruction"
            />
            {presets && presets.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePreset(preset)}
                    disabled={assist.isBusy}
                    className={cn(
                      "rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]",
                      "hover:bg-muted transition-colors disabled:opacity-50",
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] text-muted-foreground">
                {assist.rateLimit
                  ? `${assist.rateLimit.remaining}/${assist.rateLimit.limit} this window`
                  : ""}
              </div>
              <div className="flex items-center gap-1">
                {assist.isBusy ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => assist.cancel()}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleSubmit()}
                  >
                    {hasResult ? (
                      <>
                        <RotateCw className="h-3 w-3 mr-1" />
                        Rerun
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3 mr-1" />
                        Suggest
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Status / result */}
          {assist.isBusy && !assist.result && (
            <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generating…
            </div>
          )}

          {assist.error && (
            <div className="flex items-start gap-2 border-t px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-all">{assist.error.message}</span>
            </div>
          )}

          {(assist.result || (assist.isBusy && hasResult)) && (
            <div className="border-t">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {showDiff ? "Diff" : "Proposal"}
                </div>
                {assist.isBusy && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </div>
              {showDiff ? (
                <DiffPane diff={diff} />
              ) : (
                <pre
                  data-testid="ai-assist-proposal"
                  className="px-3 pb-2 text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
                >
                  {assist.result}
                </pre>
              )}
              <div className="flex items-center justify-end gap-1.5 border-t px-3 py-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleDiscard}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleRetry}
                  disabled={assist.isBusy}
                >
                  <RotateCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleApply}
                  disabled={assist.isBusy || !assist.result}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Apply
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DiffPane({ diff }: { diff: DiffLine[] }) {
  return (
    <div
      className="px-3 pb-2 text-xs font-mono max-h-64 overflow-y-auto"
      data-testid="ai-assist-diff"
    >
      {diff.map((line, idx) => (
        <div
          key={idx}
          className={cn(
            "whitespace-pre-wrap break-words",
            line.op === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
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
  );
}
