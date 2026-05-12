"use client";

/**
 * WorkflowStepTimeline — Renders a single workflow step using the same
 * AgentTimeline component as DA chat.
 *
 * Feeds StreamEvent[] into useAgentTimeline() → TimelineData → <AgentTimeline />.
 */

import { useMemo, useCallback, useState } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentTimeline } from "@/hooks/useDynamicAgentTimeline";
import { AgentTimeline } from "@/components/chat/DynamicAgentTimeline";
import { MetadataInputForm, type InputField } from "@/components/chat/MetadataInputForm";
import { ToolApprovalCard } from "@/components/chat/ToolApprovalCard";
import { AgentAvatar } from "@/components/dynamic-agents/AgentAvatar";
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
            <div>
              <AgentAvatar
                agent={agentInfo}
                isLoading={!agentInfo}
                isStreaming={isStreaming}
                rounded="rounded-xl"
                size="w-9 h-9"
                iconSize="h-4 w-4"
                className="cursor-default"
              />
            </div>
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

          {/* Interrupt: input form or tool approval */}
          {step.status === "waiting_for_input" && onResume && step.interrupt && (
            <WorkflowInterrupt interrupt={step.interrupt} onResume={onResume} stepIndex={step.index} />
          )}
        </div>
      </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Interrupt handler — renders MetadataInputForm or ToolApprovalCard
// ═══════════════════════════════════════════════════════════════

function WorkflowInterrupt({
  interrupt,
  onResume,
  stepIndex,
}: {
  interrupt: NonNullable<WfStepRun["interrupt"]>;
  onResume: (resumeData: string) => void;
  stepIndex: number;
}) {
  const [isResuming, setIsResuming] = useState(false);

  const handleFormSubmit = useCallback(
    (formData: Record<string, string>) => {
      setIsResuming(true);
      onResume(JSON.stringify({ type: "form_input", values: formData }));
    },
    [onResume]
  );

  const handleApprove = useCallback(() => {
    setIsResuming(true);
    onResume(JSON.stringify({ type: "tool_approval", decision: "approve" }));
  }, [onResume]);

  const handleReject = useCallback(() => {
    setIsResuming(true);
    onResume(JSON.stringify({ type: "tool_approval", decision: "reject" }));
  }, [onResume]);

  const handleEdit = useCallback(
    (editedArgs: Record<string, unknown>) => {
      setIsResuming(true);
      onResume(JSON.stringify({ type: "tool_approval", decision: "edit", edited_args: editedArgs }));
    },
    [onResume]
  );

  if (interrupt.type === "tool_approval" && interrupt.toolName) {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <ToolApprovalCard
          toolName={interrupt.toolName}
          toolArgs={(interrupt.toolArgs as Record<string, unknown>) || {}}
          allowedDecisions={["approve", "reject", "edit"]}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          disabled={isResuming}
        />
      </div>
    );
  }

  // input_required — use MetadataInputForm if fields are available, else fallback to simple prompt
  const fields = (interrupt.fields || []) as InputField[];

  if (fields.length > 0) {
    return (
      <div className="mt-3">
        <MetadataInputForm
          messageId={`workflow-step-${stepIndex}`}
          title={interrupt.prompt || "Input Required"}
          description={interrupt.agent ? `Requested by ${interrupt.agent}` : undefined}
          inputFields={fields}
          onSubmit={handleFormSubmit}
          disabled={isResuming}
        />
      </div>
    );
  }

  // Fallback: simple text input for unstructured prompts
  return (
    <div className="mt-3">
      <MetadataInputForm
        messageId={`workflow-step-${stepIndex}`}
        title={interrupt.prompt || "This step requires input to continue."}
        inputFields={[
          {
            field_name: "response",
            field_label: "Your response",
            field_type: "text",
            required: true,
          },
        ]}
        onSubmit={(data) => {
          setIsResuming(true);
          onResume(JSON.stringify({ type: "form_input", values: data }));
        }}
        disabled={isResuming}
      />
    </div>
  );
}
