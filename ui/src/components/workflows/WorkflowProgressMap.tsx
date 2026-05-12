"use client";

import React from "react";
import {
  Loader2,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { WfStepRun, WfStepStatus } from "@/store/workflow-exec-store";

// ---------------------------------------------------------------------------
// Max visible steps before truncating
// ---------------------------------------------------------------------------

const MAX_VISIBLE_STEPS = 8;

// ---------------------------------------------------------------------------
// Node status styling
// ---------------------------------------------------------------------------

const STEP_NODE_CONFIG: Record<
  WfStepStatus,
  { ring: string; bg: string; text: string }
> = {
  pending: {
    ring: "ring-muted-foreground/30",
    bg: "bg-muted/50",
    text: "text-muted-foreground",
  },
  running: {
    ring: "ring-blue-500",
    bg: "bg-blue-500/15",
    text: "text-blue-500",
  },
  waiting_for_input: {
    ring: "ring-amber-500",
    bg: "bg-amber-500/15",
    text: "text-amber-500",
  },
  completed: {
    ring: "ring-green-500",
    bg: "bg-green-500/15",
    text: "text-green-500",
  },
  failed: {
    ring: "ring-red-500",
    bg: "bg-red-500/15",
    text: "text-red-500",
  },
  skipped: {
    ring: "ring-muted-foreground/20",
    bg: "bg-muted/30",
    text: "text-muted-foreground/60",
  },
};

// ---------------------------------------------------------------------------
// Edge connector
// ---------------------------------------------------------------------------

function Edge({ status }: { status: "done" | "active" | "pending" }) {
  return (
    <div
      className={cn(
        "h-0.5 w-6 sm:w-8 shrink-0 rounded-full transition-colors duration-300",
        status === "done" && "bg-green-500",
        status === "active" && "bg-blue-500 animate-pulse-gentle",
        status === "pending" && "bg-muted-foreground/20"
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Step node (circle with step number + tooltip)
// ---------------------------------------------------------------------------

interface StepNodeProps {
  step: WfStepRun;
  onClick?: () => void;
}

function StepNode({ step, onClick }: StepNodeProps) {
  const config = STEP_NODE_CONFIG[step.status] || STEP_NODE_CONFIG.pending;
  const label = step.display_text || `Step ${step.index + 1}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
            "ring-1 ring-inset transition-all duration-200",
            "hover:scale-110 hover:shadow-sm cursor-pointer",
            "text-[11px] font-semibold",
            config.ring,
            config.bg,
            config.text
          )}
        >
          {step.status === "running" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            step.index + 1
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Edge status helper
// ---------------------------------------------------------------------------

function edgeStatus(
  prevStep: WfStepRun,
  nextStep: WfStepRun
): "done" | "active" | "pending" {
  if (
    prevStep.status === "completed" ||
    prevStep.status === "skipped"
  ) {
    if (
      nextStep.status === "running" ||
      nextStep.status === "waiting_for_input"
    ) {
      return "active";
    }
    if (
      nextStep.status === "completed" ||
      nextStep.status === "skipped"
    ) {
      return "done";
    }
  }
  return "pending";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface WorkflowProgressMapProps {
  steps: WfStepRun[];
  /** Whether the run is active (running or waiting) — shows Stop button */
  isRunning?: boolean;
  /** Callback when a step node is clicked (e.g. scroll to step) */
  onStepClick?: (stepIndex: number) => void;
  /** Callback for the Stop button */
  onCancel?: () => void;
}

export function WorkflowProgressMap({
  steps,
  isRunning,
  onStepClick,
  onCancel,
}: WorkflowProgressMapProps) {
  if (!steps || steps.length === 0) return null;

  const truncated = steps.length > MAX_VISIBLE_STEPS;
  const hiddenCount = truncated ? steps.length - MAX_VISIBLE_STEPS : 0;
  const visibleSteps = truncated ? steps.slice(hiddenCount) : steps;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-3 w-full">
        {/* Label */}
        <span className="text-[11px] text-muted-foreground font-medium shrink-0 select-none -ml-1">
          Steps
        </span>

        {/* Node tree */}
        <div className="flex items-center overflow-x-auto scrollbar-none py-2 px-1">
          {truncated && (
            <>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 mr-1">
                {hiddenCount} previous steps
              </span>
              <Edge status="done" />
            </>
          )}
          {visibleSteps.map((step, i) => (
            <React.Fragment key={step.index}>
              <StepNode
                step={step}
                onClick={() => onStepClick?.(step.index)}
              />
              {i < visibleSteps.length - 1 && (
                <Edge status={edgeStatus(step, visibleSteps[i + 1])} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: Stop button */}
        {isRunning && onCancel && (
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}
