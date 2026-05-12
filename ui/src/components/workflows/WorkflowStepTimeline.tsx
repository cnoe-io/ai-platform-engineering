"use client";

/**
 * WorkflowStepTimeline — Renders a single workflow step using the same
 * AgentTimeline component as DA chat.
 *
 * Feeds StreamEvent[] into useAgentTimeline() → TimelineData → <AgentTimeline />.
 */

import { useMemo } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentTimeline } from "@/hooks/useDynamicAgentTimeline";
import { AgentTimeline } from "@/components/chat/DynamicAgentTimeline";
import { getGradientStyle, getAccentColor } from "@/lib/gradient-themes";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { StreamEvent } from "@/lib/streaming/types";
import type { WfStepRun } from "@/store/workflow-exec-store";
import type { StatusType } from "@/types/dynamic-agent-timeline";

// ═══════════════════════════════════════════════════════════════
// Agent info lookup type
// ═══════════════════════════════════════════════════════════════

export interface AgentInfo {
  name: string;
  gradient_theme?: string | null;
  custom_theme_config?: { gradient_from: string; gradient_to: string; accent_color: string } | null;
}

// ═══════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════

interface WorkflowStepTimelineProps {
  /** Step run metadata */
  step: WfStepRun;
  /** Stream events for this step */
  events: StreamEvent[];
  /** Whether this step is currently streaming */
  isActive: boolean;
  /** Resolved agent info (name + theme) for this step's agent_id */
  agentInfo?: AgentInfo | null;
  /** Callback when user submits resume data for an interrupted step */
  onResume?: (resumeData: string) => void;
}

// ═══════════════════════════════════════════════════════════════
// Status icon mapping
// ═══════════════════════════════════════════════════════════════

function stepStatusIcon(status: WfStepRun["status"]): string {
  switch (status) {
    case "completed": return "✓";
    case "running": return "⟳";
    case "failed": return "✗";
    case "skipped": return "⤳";
    case "waiting_for_input": return "⏸";
    case "pending": return "○";
    default: return "○";
  }
}

function stepStatusColor(status: WfStepRun["status"]): string {
  switch (status) {
    case "completed": return "text-green-600 dark:text-green-400";
    case "running": return "text-blue-600 dark:text-blue-400";
    case "failed": return "text-red-600 dark:text-red-400";
    case "skipped": return "text-yellow-600 dark:text-yellow-400";
    case "waiting_for_input": return "text-amber-600 dark:text-amber-400";
    case "pending": return "text-zinc-400 dark:text-zinc-500";
    default: return "text-zinc-400";
  }
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

export function WorkflowStepTimeline({
  step,
  events,
  isActive,
  agentInfo,
  onResume,
}: WorkflowStepTimelineProps) {
  // Map step status to timeline turnStatus
  const turnStatus: StatusType | undefined = useMemo(() => {
    if (step.status === "completed") return "done";
    if (step.status === "waiting_for_input") return "waiting_for_input";
    if (step.status === "failed") return "interrupted";
    return undefined;
  }, [step.status]);

  const isStreaming = step.status === "running" && isActive;
  const { data } = useAgentTimeline(events, isStreaming, turnStatus);

  // Duration calculation
  const durationSec = useMemo(() => {
    if (!step.started_at) return undefined;
    const start = new Date(step.started_at).getTime();
    const end = step.completed_at
      ? new Date(step.completed_at).getTime()
      : Date.now();
    return Math.round((end - start) / 1000);
  }, [step.started_at, step.completed_at]);

  return (
    <div id={`workflow-step-${step.index}`}>
      {/* Step header with divider */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-sm font-medium ${stepStatusColor(step.status)}`}>
          {stepStatusIcon(step.status)}
        </span>
        <span className="text-sm font-semibold text-foreground">
          Step {step.index + 1}
        </span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          - {step.display_text}
        </span>
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700 ml-2" />
      </div>

      {/* Chat-bubble layout: avatar | content (only when step has started) */}
      {step.status !== "pending" ? (
      <div className="flex gap-3">
        {/* Agent avatar */}
        <Tooltip>
          <TooltipTrigger asChild>
            {(() => {
              const gradientStyle = agentInfo?.gradient_theme
                ? getGradientStyle(agentInfo.gradient_theme, agentInfo.custom_theme_config)
                : null;
              const iconColor = getAccentColor(agentInfo?.gradient_theme, agentInfo?.custom_theme_config) || "white";
              return (
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm cursor-default",
                    !gradientStyle && "bg-gradient-to-br from-purple-500 to-pink-600",
                    isStreaming && "animate-pulse"
                  )}
                  style={gradientStyle || undefined}
                >
                  <Bot className="h-4 w-4" style={{ color: iconColor }} />
                </div>
              );
            })()}
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={4}>
            {step.agent_id}
          </TooltipContent>
        </Tooltip>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Agent name + timestamp */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {agentInfo?.name || step.agent_id}
            </span>
            {step.started_at && (
              <span className="text-[10px] text-muted-foreground/60">
                {new Date(step.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {/* Error banner */}
          {step.status === "failed" && step.error && (
            <div className="px-3 py-2 mb-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              {step.error}
            </div>
          )}

          {/* Timeline content */}
          {(events.length > 0 || isStreaming) && (
            <div>
              <AgentTimeline
                data={data}
                durationSec={durationSec}
                files={[]}
                tasks={[]}
                isLatestMessage={isActive}
              />
            </div>
          )}

          {/* Interrupt form */}
          {step.status === "waiting_for_input" && onResume && (
            <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
              <InterruptForm
                interrupt={step.interrupt}
                onSubmit={onResume}
              />
            </div>
          )}
        </div>
      </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Interrupt Form (minimal — can be enhanced later)
// ═══════════════════════════════════════════════════════════════

function InterruptForm({
  interrupt,
  onSubmit,
}: {
  interrupt: WfStepRun["interrupt"];
  onSubmit: (data: string) => void;
}) {
  const prompt = interrupt?.prompt || "This step requires input to continue.";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const input = form.elements.namedItem("resumeInput") as HTMLInputElement;
        if (input.value.trim()) {
          onSubmit(input.value.trim());
          input.value = "";
        }
      }}
      className="flex flex-col gap-2"
    >
      <p className="text-sm text-amber-700 dark:text-amber-300">{prompt}</p>
      <div className="flex gap-2">
        <input
          name="resumeInput"
          type="text"
          className="flex-1 px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          placeholder="Type your response..."
        />
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Resume
        </button>
      </div>
    </form>
  );
}
