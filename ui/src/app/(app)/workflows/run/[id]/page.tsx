"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, Clock, MessageSquare, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WorkflowRunTimeline } from "@/components/workflows/WorkflowRunTimeline";
import { WorkflowProgressMap } from "@/components/workflows/WorkflowProgressMap";
import { useWorkflowExecStore } from "@/store/workflow-exec-store";
import type { WfRunStatus } from "@/store/workflow-exec-store";

const RUN_STATUS_CONFIG: Record<WfRunStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", color: "text-muted-foreground bg-muted/50", icon: <Clock className="h-4 w-4" /> },
  running: { label: "Running", color: "text-blue-500 bg-blue-500/10", icon: <Loader2 className="h-4 w-4 animate-spin" /> },
  waiting_for_input: { label: "Waiting", color: "text-amber-500 bg-amber-500/10", icon: <MessageSquare className="h-4 w-4" /> },
  completed: { label: "Completed", color: "text-green-500 bg-green-500/10", icon: <CheckCircle2 className="h-4 w-4" /> },
  failed: { label: "Failed", color: "text-red-500 bg-red-500/10", icon: <XCircle className="h-4 w-4" /> },
};

export default function WorkflowRunPage() {
  const params = useParams();
  const runId = params.id as string;
  const scrollRef = useRef<HTMLDivElement>(null);

  const { run, stepEvents, isLoading, error, loadRun, startPolling, stopPolling, resumeStep, cancelRun } =
    useWorkflowExecStore();

  // Workflow filesystem files (shared across all steps via fs_namespace)
  const [workflowFiles, setWorkflowFiles] = useState<string[]>([]);
  const [showFiles, setShowFiles] = useState(false);

  useEffect(() => {
    if (runId) {
      loadRun(runId);
      startPolling(runId);
    }
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Fetch workflow files when run progresses
  useEffect(() => {
    if (!run || !runId) return;
    const hasActiveStep = run.steps.some((s) => s.status !== "pending");
    if (!hasActiveStep) return;

    const fsNamespace = JSON.stringify([run.workflow_config_id, runId, "filesystem"]);

    (async () => {
      try {
        const res = await fetch(
          `/api/files/list?fs_namespace=${encodeURIComponent(fsNamespace)}`
        );
        if (res.ok) {
          const data = await res.json();
          setWorkflowFiles(data.files || []);
        }
      } catch {
        // ignore
      }
    })();
  }, [run?.status, run?.current_step_index, run, runId]);

  const handleFileDownload = useCallback(async (path: string) => {
    if (!run || !runId) return;

    const fsNamespace = JSON.stringify([run.workflow_config_id, runId, "filesystem"]);

    try {
      const res = await fetch(
        `/api/files/content?fs_namespace=${encodeURIComponent(fsNamespace)}&path=${encodeURIComponent(path)}`
      );
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = path.split("/").pop() || "file";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // ignore
    }
  }, [run, runId]);

  const handleResume = async (stepIndex: number, data: string) => {
    if (runId) {
      await resumeStep(runId, stepIndex, data);
    }
  };

  const handleCancel = async () => {
    if (runId && window.confirm("Cancel this workflow run?")) {
      await cancelRun(runId);
    }
  };

  const handleStepClick = useCallback((stepIndex: number) => {
    const el = document.getElementById(`workflow-step-${stepIndex}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Run header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-card/30 shrink-0">
        <div className="flex items-center gap-3">
          {run && (
            <span
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full",
                RUN_STATUS_CONFIG[run.status]?.color ?? "text-muted-foreground bg-muted/50"
              )}
            >
              {RUN_STATUS_CONFIG[run.status]?.icon}
              {RUN_STATUS_CONFIG[run.status]?.label}
            </span>
          )}
          <span className="text-sm font-mono text-muted-foreground">
            {runId}
          </span>
        </div>
        {run?.started_at && (
          <span className="text-xs text-muted-foreground">
            Started: {new Date(run.started_at).toLocaleString()}
            {run.completed_at && (
              <> | Completed: {new Date(run.completed_at).toLocaleString()}</>
            )}
          </span>
        )}
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6" ref={scrollRef}>
        <div className="max-w-5xl mx-auto">
          {isLoading && !run && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {error && !run && (
            <div className="text-center py-20">
              <p className="text-sm text-red-500 mb-4">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadRun(runId)}
              >
                Retry
              </Button>
            </div>
          )}

          {run && (
            <WorkflowRunTimeline
              run={run}
              stepEvents={stepEvents}
              workflowFiles={showFiles ? workflowFiles : undefined}
              onFileDownload={handleFileDownload}
              onResume={handleResume}
            />
          )}
        </div>
      </div>

      {/* Fixed bottom progress map */}
      {run && run.steps.length > 0 && (
        <div className="border-t border-border bg-background shrink-0">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <WorkflowProgressMap
                steps={run.steps}
                isRunning={run.status === "running" || run.status === "waiting_for_input"}
                onStepClick={handleStepClick}
                onCancel={handleCancel}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFiles(!showFiles)}
              className={cn(
                "shrink-0 gap-1.5 text-xs",
                showFiles && "bg-muted"
              )}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {showFiles ? "Hide Files" : "Show Files"}
              {workflowFiles.length > 0 && (
                <span className="text-[10px] text-muted-foreground">({workflowFiles.length})</span>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
