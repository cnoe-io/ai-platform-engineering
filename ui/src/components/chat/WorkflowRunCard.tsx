"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Workflow, ExternalLink, CheckCircle2, XCircle, Loader2, Clock, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface WorkflowRunInfo {
  runId: string;
  workflowConfigId?: string;
}

interface RunStatus {
  _id: string;
  workflow_config_id: string;
  status: "running" | "completed" | "failed" | "cancelled" | "waiting_for_input";
  started_at?: string;
  completed_at?: string;
  current_step_index?: number;
  steps?: unknown[];
}

interface WorkflowConfigInfo {
  name: string;
  description?: string;
}

interface WorkflowRunCardProps {
  runs: WorkflowRunInfo[];
}

const STATUS_CONFIG = {
  running: { icon: Loader2, label: "Running", className: "text-sky-400 animate-spin", bg: "border-sky-500/30 bg-sky-500/5" },
  waiting_for_input: { icon: PauseCircle, label: "Waiting for input", className: "text-amber-400", bg: "border-amber-500/30 bg-amber-500/5" },
  completed: { icon: CheckCircle2, label: "Completed", className: "text-emerald-400", bg: "border-emerald-500/30 bg-emerald-500/5" },
  failed: { icon: XCircle, label: "Failed", className: "text-red-400", bg: "border-red-500/30 bg-red-500/5" },
  cancelled: { icon: XCircle, label: "Cancelled", className: "text-muted-foreground", bg: "border-border bg-muted/30" },
} as const;

function RunCard({ runId }: { runId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [configInfo, setConfigInfo] = useState<WorkflowConfigInfo | null>(null);
  const [hidden, setHidden] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflow-runs?run_id=${encodeURIComponent(runId)}`);
      if (res.status === 401 || res.status === 404) {
        setHidden(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data);
    } catch {
      // silently ignore transient errors
    }
  }, [runId]);

  // Fetch workflow config name/description once we have the config ID
  useEffect(() => {
    if (!status?.workflow_config_id || configInfo) return;
    (async () => {
      try {
        const res = await fetch(`/api/workflow-configs?id=${encodeURIComponent(status.workflow_config_id)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.name) setConfigInfo({ name: data.name, description: data.description });
      } catch { /* best-effort */ }
    })();
  }, [status?.workflow_config_id, configInfo]);

  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (stopped || hidden) return;
    if (status && status.status !== "running" && status.status !== "waiting_for_input") {
      setStopped(true);
      return;
    }
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [status, stopped, hidden, fetchStatus]);

  if (hidden) return null;

  const cfg = status ? STATUS_CONFIG[status.status] || STATUS_CONFIG.running : null;
  const StatusIcon = cfg?.icon || Clock;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer hover:bg-muted/50",
        cfg?.bg || "border-border bg-card/50"
      )}
      onClick={() => router.push(`/workflows/run/${runId}`)}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Workflow className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {configInfo?.name || "Workflow Run"}
          </span>
          <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", cfg?.className || "text-muted-foreground")} />
          <span className="text-[10px] text-muted-foreground">{cfg?.label || "Loading..."}</span>
        </div>
        {configInfo?.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{configInfo.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
          {status?.started_at && (
            <span>{new Date(status.started_at).toLocaleString()}</span>
          )}
          {status?.current_step_index != null && status?.steps && (
            <span>Step {status.current_step_index + 1}/{status.steps.length}</span>
          )}
        </div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </div>
  );
}

/**
 * Renders workflow run cards as a sidecar section in the chat timeline.
 * Each card polls for status updates every 10 seconds while running.
 */
export function WorkflowRunCard({ runs }: WorkflowRunCardProps) {
  if (runs.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
        <Workflow className="h-3.5 w-3.5" />
        <span>Workflow{runs.length > 1 ? "s" : ""}</span>
      </div>
      <div className="space-y-2">
        {runs.map((run) => (
          <RunCard key={run.runId} runId={run.runId} />
        ))}
      </div>
    </div>
  );
}
