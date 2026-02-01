"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  CheckCircle,
  XCircle,
  Ban,
  Loader2,
  Play,
  Trash2,
  Calendar,
  Timer,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  RefreshCw,
  X,
  Check,
  Maximize2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { cn } from "@/lib/utils";
import { useWorkflowRunStore } from "@/store/workflow-run-store";
import { useToast } from "@/components/ui/toast";
import type { WorkflowRun } from "@/types/workflow-run";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getMarkdownComponents } from "@/lib/markdown-components";

interface WorkflowHistoryViewProps {
  onReRun?: (run: WorkflowRun) => void;
  workflowId?: string; // If provided, only show runs for this workflow
}

const STATUS_CONFIG = {
  running: {
    icon: Loader2,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    label: "Running",
  },
  completed: {
    icon: CheckCircle,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    label: "Failed",
  },
  cancelled: {
    icon: Ban,
    color: "text-gray-500",
    bgColor: "bg-gray-500/10",
    label: "Cancelled",
  },
};

function formatDuration(ms?: number): string {
  if (!ms) return "N/A";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function WorkflowHistoryView({ onReRun, workflowId }: WorkflowHistoryViewProps) {
  const { runs, isLoading, loadRuns, deleteRun } = useWorkflowRunStore();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewExecutionRun, setViewExecutionRun] = useState<WorkflowRun | null>(null);
  const [copied, setCopied] = useState(false);

  // Debug: Log when viewExecutionRun changes
  useEffect(() => {
    console.log('[WorkflowHistory] viewExecutionRun state changed:', viewExecutionRun?.id);
  }, [viewExecutionRun]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadRuns(workflowId ? { workflow_id: workflowId } : undefined);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Load runs on mount
  useEffect(() => {
    loadRuns(workflowId ? { workflow_id: workflowId } : undefined);
  }, [loadRuns, workflowId]);

  // Auto-refresh when there are running workflows (but pause when viewing execution)
  useEffect(() => {
    // Don't auto-refresh when viewing an execution
    if (viewExecutionRun) {
      console.log('[WorkflowHistory] Auto-refresh paused - modal is open');
      return;
    }

    const hasRunning = runs.some(run => run.status === "running");
    
    if (!hasRunning) return;

    console.log('[WorkflowHistory] Auto-refresh enabled - polling every 3s');
    // Poll every 3 seconds when there are active runs
    const interval = setInterval(() => {
      loadRuns(workflowId ? { workflow_id: workflowId } : undefined);
    }, 3000);

    return () => {
      console.log('[WorkflowHistory] Auto-refresh stopped');
      clearInterval(interval);
    };
  }, [runs, loadRuns, workflowId, viewExecutionRun]);

  // ESC key to close modal
  useEffect(() => {
    if (!viewExecutionRun) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('[WorkflowHistory] ESC pressed, closing modal');
        setViewExecutionRun(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [viewExecutionRun]);

  // Filter runs if workflowId is provided
  const displayRuns = workflowId
    ? runs.filter((run) => run.workflow_id === workflowId)
    : runs;

  const handleDeleteClick = (runId: string) => {
    setConfirmDeleteId(runId);
  };

  const handleCancelDelete = () => {
    setConfirmDeleteId(null);
  };

  const handleConfirmDelete = async (runId: string) => {
    try {
      setDeletingId(runId);
      setConfirmDeleteId(null);
      await deleteRun(runId);
      toast("Workflow run deleted successfully", "success", 3000);
    } catch (error) {
      console.error("Failed to delete run:", error);
      toast("Failed to delete workflow run", "error", 5000);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyResult = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast("Copied to clipboard", "success", 2000);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      toast("Failed to copy to clipboard", "error", 3000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <CAIPESpinner size="lg" message="Loading history..." />
      </div>
    );
  }

  if (displayRuns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <h3 className="font-semibold text-lg mb-2">No Workflow Runs Yet</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          {workflowId
            ? "This workflow hasn't been executed yet. Run it to see execution history here."
            : "You haven't executed any workflows yet. Start by running a workflow from the gallery."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with refresh button */}
      <div className="shrink-0 flex items-center justify-between p-3 border-b border-border/30">
        <div className="text-sm text-muted-foreground">
          {displayRuns.length} {displayRuns.length === 1 ? 'run' : 'runs'}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="gap-1 h-7"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          <span className="text-xs">Refresh</span>
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-1">
          <AnimatePresence mode="popLayout">
            {displayRuns.map((run, index) => {
            const config = STATUS_CONFIG[run.status];
            const Icon = config.icon;
            const startedAt = new Date(run.started_at);
            const completedAt = run.completed_at ? new Date(run.completed_at) : null;

            const isExpanded = expandedRunId === run.id;
            
            return (
              <motion.div
                key={run.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ delay: index * 0.05 }}
                className="group relative p-4 rounded-lg border border-border/50 bg-card hover:border-border hover:shadow-md transition-all"
              >
                {/* Status Badge - Top Right */}
                <div className="absolute top-3 right-3">
                  <Badge
                    variant="secondary"
                    className={cn("gap-1 text-xs", config.bgColor, config.color)}
                  >
                    <Icon className={cn("h-3 w-3", run.status === "running" && "animate-spin")} />
                    {config.label}
                  </Badge>
                </div>

                {/* Workflow Name - Clickable to expand */}
                <div 
                  className="pr-24 mb-2 cursor-pointer"
                  onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <h3 className="font-semibold text-base">{run.workflow_name}</h3>
                  </div>
                  {run.workflow_category && (
                    <p className="text-xs text-muted-foreground ml-6">{run.workflow_category}</p>
                  )}
                </div>

                {/* Timestamps */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>
                      {formatDistanceToNow(startedAt, { addSuffix: true })}
                    </span>
                  </div>
                  {run.duration_ms && (
                    <div className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      <span>{formatDuration(run.duration_ms)}</span>
                    </div>
                  )}
                </div>

                {/* Input Parameters Preview */}
                {run.input_parameters && Object.keys(run.input_parameters).length > 0 && (
                  <div className="mb-3 p-2 rounded bg-muted/30 text-xs">
                    <p className="font-medium mb-1 text-muted-foreground">Input:</p>
                    <div className="space-y-0.5">
                      {Object.entries(run.input_parameters).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <span className="font-medium">{key}:</span>
                          <span className="text-muted-foreground truncate">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Result or Error - Show preview when collapsed */}
                {!isExpanded && run.result_summary && run.status === "completed" && (
                  <div className="mb-3 p-2 rounded bg-green-500/5 text-xs">
                    <p className="font-medium mb-1 text-green-600 dark:text-green-400">Result:</p>
                    <p className="text-muted-foreground line-clamp-2">{run.result_summary}</p>
                  </div>
                )}

                {run.error_message && run.status === "failed" && (
                  <div className="mb-3 p-2 rounded bg-red-500/5 text-xs flex items-start gap-2">
                    <AlertCircle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium mb-1 text-red-600 dark:text-red-400">Error:</p>
                      <p className="text-muted-foreground line-clamp-2">{run.error_message}</p>
                    </div>
                  </div>
                )}

                {/* Execution Stats */}
                {(run.steps_completed || run.tools_called) && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                    {run.steps_completed !== undefined && run.steps_total !== undefined && (
                      <span>
                        Steps: {run.steps_completed}/{run.steps_total}
                      </span>
                    )}
                    {run.tools_called && run.tools_called.length > 0 && (
                      <span>Tools: {run.tools_called.join(", ")}</span>
                    )}
                  </div>
                )}

                {/* Expanded Details Section */}
                <AnimatePresence>
                  {isExpanded && run.result_summary && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-3 overflow-hidden"
                    >
                      <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                        <div className="flex items-center gap-2 mb-2">
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                          <h4 className="text-xs font-semibold text-muted-foreground">
                            Full Output
                          </h4>
                        </div>
                        <div className="text-xs">
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={getMarkdownComponents()}
                          >
                            {run.result_summary}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                  {/* Always show View Execution button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 h-7 text-xs"
                    onClick={() => {
                      console.log('[WorkflowHistory] View Execution clicked for run:', run.id, run);
                      setViewExecutionRun(run);
                    }}
                  >
                    <Maximize2 className="h-3 w-3" />
                    View Execution
                  </Button>
                  
                  {run.result_summary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 h-7 text-xs"
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronDown className="h-3 w-3" />
                          Hide Details
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3" />
                          Quick View
                        </>
                      )}
                    </Button>
                  )}
                  {run.status !== "running" && onReRun && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 h-7 text-xs"
                      onClick={() => onReRun(run)}
                    >
                      <Play className="h-3 w-3" />
                      Re-run
                    </Button>
                  )}
                  
                  {/* Delete actions - inline confirmation */}
                  {confirmDeleteId === run.id ? (
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-xs text-muted-foreground mr-1">Delete this run?</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        onClick={() => handleConfirmDelete(run.id)}
                        disabled={deletingId === run.id}
                      >
                        {deletingId === run.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={handleCancelDelete}
                        disabled={deletingId === run.id}
                      >
                        <X className="h-3 w-3" />
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 h-7 text-xs text-red-400 hover:text-red-500 ml-auto"
                      onClick={() => handleDeleteClick(run.id)}
                      disabled={deletingId === run.id}
                    >
                      {deletingId === run.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Delete
                    </Button>
                  )}
                </div>
              </motion.div>
            );
            })}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Fullscreen Execution View Modal - Using Portal */}
      {typeof document !== 'undefined' && viewExecutionRun && (() => {
        console.log('[WorkflowHistory] Creating portal for run:', viewExecutionRun.id);
        console.log('[WorkflowHistory] Portal target (document.body):', document.body);
        const portal = createPortal(
          <AnimatePresence>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed left-0 right-0 top-[64px] bottom-0 bg-black/60 backdrop-blur-sm z-[99]"
              onClick={() => {
                console.log('[WorkflowHistory] Backdrop clicked, closing modal');
                setViewExecutionRun(null);
              }}
            />

            {/* Fullscreen Content */}
            <motion.div
              key="content"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-2 right-2 top-[68px] bottom-2 z-[100] bg-background shadow-2xl rounded-lg border border-border flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background shrink-0">
                <div>
                  <h3 className="text-sm font-semibold">{viewExecutionRun.workflow_name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(viewExecutionRun.started_at), { addSuffix: true })} • 
                    {viewExecutionRun.duration_ms && ` ${formatDuration(viewExecutionRun.duration_ms)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {viewExecutionRun.result_summary && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyResult(viewExecutionRun.result_summary!)}
                      className="h-7 px-2 gap-1.5 text-xs"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-green-500" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewExecutionRun(null)}
                    className="h-7 px-2 gap-1.5 text-xs"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Close</span>
                  </Button>
                </div>
              </div>

              {/* Input Parameters */}
              {viewExecutionRun.input_parameters && Object.keys(viewExecutionRun.input_parameters).length > 0 && (
                <div className="px-4 py-2 border-b border-border/30 bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Input Parameters:</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(viewExecutionRun.input_parameters).map(([key, value]) => (
                      <Badge key={key} variant="secondary" className="text-xs">
                        <span className="font-medium">{key}:</span> {value}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Content - Split view if execution artifacts available */}
              <div className="flex-1 overflow-auto p-4 flex gap-4">
                {/* Left Panel - Execution Plan (if available) */}
                {viewExecutionRun.execution_artifacts && (
                  <div className="w-80 shrink-0 space-y-4">
                    {/* Execution Steps */}
                    {viewExecutionRun.execution_artifacts.steps && viewExecutionRun.execution_artifacts.steps.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-2">Execution Plan</h4>
                        <div className="space-y-2">
                          {viewExecutionRun.execution_artifacts.steps.map((step) => {
                            const statusConfig = {
                              pending: { color: "text-gray-400", bg: "bg-gray-500/10" },
                              in_progress: { color: "text-blue-500", bg: "bg-blue-500/10" },
                              completed: { color: "text-green-500", bg: "bg-green-500/10" },
                              failed: { color: "text-red-500", bg: "bg-red-500/10" },
                            };
                            const config = statusConfig[step.status];
                            
                            return (
                              <div key={step.id} className={cn("p-2 rounded border", config.bg)}>
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="text-xs px-1.5 py-0">
                                    {step.agent}
                                  </Badge>
                                  {step.status === "completed" && <CheckCircle className="h-3 w-3 text-green-500" />}
                                  {step.status === "failed" && <XCircle className="h-3 w-3 text-red-500" />}
                                </div>
                                <p className="text-xs text-muted-foreground">{step.description}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Tool Calls */}
                    {viewExecutionRun.execution_artifacts.tool_calls && viewExecutionRun.execution_artifacts.tool_calls.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-2">Tool Calls ({viewExecutionRun.execution_artifacts.tool_calls.length})</h4>
                        <div className="space-y-2">
                          {viewExecutionRun.execution_artifacts.tool_calls.map((tool) => (
                            <div key={tool.id} className="p-2 rounded border bg-green-500/5 border-green-500/30">
                              <div className="flex items-center gap-1 mb-1">
                                <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                                <span className="text-xs font-medium text-green-600 dark:text-green-400">
                                  {tool.description}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Right Panel - Result */}
                <div className={cn(
                  "flex-1",
                  viewExecutionRun.execution_artifacts && "border-l border-border/50 pl-4"
                )}>
                  {viewExecutionRun.result_summary ? (
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={getMarkdownComponents()}
                    >
                      {viewExecutionRun.result_summary}
                    </ReactMarkdown>
                  ) : viewExecutionRun.error_message ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <XCircle className="h-16 w-16 text-red-500 mb-4" />
                      <h3 className="text-lg font-semibold mb-2">Workflow Failed</h3>
                      <p className="text-muted-foreground text-center max-w-md">
                        {viewExecutionRun.error_message}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <AlertCircle className="h-16 w-16 text-muted-foreground/30 mb-4" />
                      <h3 className="text-lg font-semibold mb-2">No Output Available</h3>
                      <p className="text-muted-foreground max-w-md">
                        This workflow run was completed before execution artifacts were saved. 
                        Run the workflow again to see full execution details.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body
        );
        console.log('[WorkflowHistory] Portal created successfully');
        return portal;
      })()}
    </div>
  );
}
