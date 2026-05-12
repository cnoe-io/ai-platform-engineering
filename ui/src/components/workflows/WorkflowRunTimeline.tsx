"use client";

import React, { useState, useEffect, useMemo } from "react";
import { FolderOpen } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileTree } from "@/components/dynamic-agents/FileTree";
import { WorkflowStepTimeline } from "./WorkflowStepTimeline";
import type { AgentInfo } from "./WorkflowStepTimeline";
import type { WfRun } from "@/store/workflow-exec-store";
import type { StreamEvent } from "@/lib/streaming/types";

// ---------------------------------------------------------------------------
// Main timeline
// ---------------------------------------------------------------------------

interface WorkflowRunTimelineProps {
  run: WfRun;
  /** Events per step (step index → StreamEvent[]) */
  stepEvents: Record<number, StreamEvent[]>;
  /** Workflow filesystem files (shared across all steps) */
  workflowFiles?: string[];
  /** Callback for file download */
  onFileDownload?: (path: string) => void;
  onResume: (stepIndex: number, resumeData: string) => Promise<void>;
}

export function WorkflowRunTimeline({
  run,
  stepEvents,
  workflowFiles,
  onFileDownload,
  onResume,
}: WorkflowRunTimelineProps) {
  const [submitting, setSubmitting] = useState(false);

  // Fetch agent info for all agent_ids in this run
  const agentIds = useMemo(
    () => [...new Set(run.steps.map((s) => s.agent_id))],
    [run.steps]
  );
  const [agentMap, setAgentMap] = useState<Record<string, AgentInfo>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dynamic-agents?page_size=100");
        if (!res.ok) return;
        const data = await res.json();

        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.data?.items)
          ? data.data.items
          : Array.isArray(data?.data)
          ? data.data
          : [];
        if (cancelled) return;

        const map: Record<string, AgentInfo> = {};
        for (const a of list) {
          const id = a._id || a.id;
          if (agentIds.includes(id)) {
            map[id] = {
              name: a.name || id,
              gradient_theme: a.ui?.gradient_theme,
              custom_theme_config: a.ui?.custom_theme_config,
            };
          }
        }
        setAgentMap(map);

      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [agentIds]);

  const handleResume = async (stepIndex: number, data: string) => {
    setSubmitting(true);
    try {
      await onResume(stepIndex, data);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4">
      {/* Step timelines */}
      <div className="space-y-10">
        {run.steps.map((step) => {
          const isActive = run.current_step_index === step.index;
          const events = stepEvents[step.index] || [];

          return (
            <WorkflowStepTimeline
              key={step.index}
              step={step}
              events={events}
              isActive={isActive}
              agentInfo={agentMap[step.agent_id]}
              onResume={
                step.status === "waiting_for_input"
                  ? (data) => handleResume(step.index, data)
                  : undefined
              }
            />
          );
        })}
      </div>

      {/* End line — shows terminal marker or live progress indicator */}
      {(() => {
        const completedCount = run.steps.filter((s) => s.status === "completed").length;
        const totalCount = run.steps.length;

        if (run.status === "completed" || run.status === "failed") {
          return (
            <div className="flex items-center gap-3 mt-8">
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
              <span className="text-xs text-muted-foreground">
                — {run.status === "completed" ? `Completed ${completedCount} steps` : `Failed at step ${completedCount + 1} of ${totalCount}`} —
              </span>
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            </div>
          );
        }
        if (run.status === "running" || run.status === "waiting_for_input") {
          return (
            <div className="flex items-center gap-3 mt-8">
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
              <span className="text-xs text-muted-foreground animate-pulse">
                — Running: {completedCount} of {totalCount} steps —
              </span>
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            </div>
          );
        }
        return null;
      })()}

      {/* Workflow files section (after end) */}
      {workflowFiles && (
        <div className="mt-6">
          {workflowFiles.length > 0 ? (
            <FileTree
              files={workflowFiles}
              onFileClick={onFileDownload}
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
              <FolderOpen className="h-3.5 w-3.5" />
              No files created yet.
            </div>
          )}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
