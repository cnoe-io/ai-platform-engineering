"use client";

import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from "react";
import {
  ChevronDown,
  Loader2,
  Wrench,
  AlertTriangle,
  XCircle,
  Bot,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  StreamingMarkdown,
  CollapsibleSection,
  TaskList,
} from "@/components/shared/timeline";
import type { TaskItem } from "@/components/shared/timeline";
import type {
  DATimelineData,
  DATimelineSegment,
  DAToolSegment,
  DAToolGroupSegment,
  DASubagentSegment,
  DAContentSegment,
  DAWarningSegment,
  DAErrorSegment,
  DADoneSegment,
  DAStatusSegment,
  DAToolInfo,
} from "@/types/dynamic-agent-timeline";
import { extractToolThought, groupConsecutiveTools } from "@/types/dynamic-agent-timeline";
import { FileTree } from "@/components/dynamic-agents/FileTree";
import { isFileToolName, isTodoToolName } from "@/components/dynamic-agents/sse-types";
import { getGradientStyle } from "@/lib/gradient-themes";

// ═══════════════════════════════════════════════════════════════
// Helper: Detect file-related tools in segments
// ═══════════════════════════════════════════════════════════════

/**
 * Check if any file-related tools were called in the segments (including nested subagents).
 */
function hasFileToolsInSegments(segments: DATimelineSegment[]): boolean {
  for (const segment of segments) {
    if (segment.type === "tool" && isFileToolName(segment.data.name)) {
      return true;
    }
    if (segment.type === "tool-group") {
      if (segment.tools.some(t => isFileToolName(t.name))) {
        return true;
      }
    }
    if (segment.type === "subagent" && hasFileToolsInSegments(segment.segments)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if any todo-related tools were called in the segments (including nested subagents).
 */
function hasTodoToolsInSegments(segments: DATimelineSegment[]): boolean {
  for (const segment of segments) {
    if (segment.type === "tool" && isTodoToolName(segment.data.name)) {
      return true;
    }
    if (segment.type === "tool-group") {
      if (segment.tools.some(t => isTodoToolName(t.name))) {
        return true;
      }
    }
    if (segment.type === "subagent" && hasTodoToolsInSegments(segment.segments)) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// Subagent Lookup Context
// ═══════════════════════════════════════════════════════════════

export interface SubagentLookupInfo {
  name: string;
  gradientTheme?: string;
}

type SubagentLookupFn = (subagentName: string) => SubagentLookupInfo | undefined;

const SubagentLookupContext = createContext<SubagentLookupFn | undefined>(undefined);

// ═══════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════

interface DynamicAgentTimelineProps {
  /** Interleaved timeline data from DATimelineManager */
  data: DATimelineData;
  /** Duration in seconds (for summary bar) */
  durationSec?: number;

  // ─── Files & Tasks (passed from parent, not from segments) ───
  /** Files created by the agent */
  files: string[];
  /** Tasks/todos from the agent */
  tasks: TaskItem[];

  // ─── Controls ────────────────────────────────────────────────
  /** Whether this is the latest message (enables file download) */
  isLatestMessage: boolean;

  // ─── Subagent lookup (optional) ──────────────────────────────
  /** Function to look up subagent info by name (for avatar gradient) */
  getSubagentInfo?: SubagentLookupFn;

  // ─── File operations (only active when isLatestMessage=true) ─
  onFileDownload?: (path: string) => void;
  onFileDelete?: (path: string) => void;
  isDownloadingFile?: boolean;
  downloadingFilePath?: string;
  isDeletingFile?: boolean;
  deletingFilePath?: string;
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export function DynamicAgentTimeline({
  data,
  durationSec,
  files,
  tasks,
  isLatestMessage,
  getSubagentInfo,
  onFileDownload,
  onFileDelete,
  isDownloadingFile,
  downloadingFilePath,
  isDeletingFile,
  deletingFilePath,
}: DynamicAgentTimelineProps) {
  const { segments, finalAnswer, isStreaming, hasTools } = data;

  // Determine if turn has ended (not streaming and has final answer)
  const turnEnded = !isStreaming && finalAnswer !== null;

  // Machinery sections collapse after streaming ends (or start collapsed if already ended)
  const [machineryExpanded, setMachineryExpanded] = useState(!turnEnded);
  const prevStreamingRef = useRef(isStreaming);
  const prevFinalAnswerRef = useRef(finalAnswer);
  
  // For ref to timeline container (kept for potential future use)
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Collapse when streaming ends
    if (prevStreamingRef.current && !isStreaming) {
      setMachineryExpanded(false);
    }
    // Also collapse when final answer first appears AND streaming has stopped
    // (Don't collapse while still streaming - keep answer visible as "thinking")
    if (!prevFinalAnswerRef.current && finalAnswer && !isStreaming) {
      setMachineryExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
    prevFinalAnswerRef.current = finalAnswer;
  }, [isStreaming, finalAnswer]);

  // Group consecutive tools for compact rendering
  const groupedSegments = groupConsecutiveTools(segments);

  // Count stats for summary bar
  const toolCount = segments.filter(s => s.type === "tool").length;
  const subagentCount = segments.filter(s => s.type === "subagent").length;
  const warningCount = segments.filter(s => s.type === "warning").length;
  const errorCount = segments.filter(s => s.type === "error").length;

  const hasWarningsOrErrors = warningCount > 0 || errorCount > 0;

  // Determine if tasks/files sections will actually be shown
  const showTasksSection = tasks.length > 0 && hasTodoToolsInSegments(segments) && (isStreaming || tasks.some(t => t.status !== "completed"));
  const showFilesSection = files.length > 0 && hasFileToolsInSegments(segments);

  // Check if we have meaningful timeline segments (tools, subagents, content, warnings, errors)
  // "done" and "status" segments don't count - they're just markers
  const hasMeaningfulSegments = segments.some(s => s.type !== "done" && s.type !== "status");
  
  // Should show timeline content (always show when streaming to include final answer as thinking)
  const showTimeline = isStreaming || machineryExpanded;
  
  // Streaming content display logic:
  // - If streaming with NO tools yet: show content as streaming text (like normal message)
  // - If streaming WITH tools: show final answer as "thinking" in timeline
  // - After streaming: show final answer as completed message
  const showStreamingContent = isStreaming && !hasTools && finalAnswer;
  const showFinalAnswerInTimeline = isStreaming && hasTools && finalAnswer;
  const showFinalAnswerOutside = !isStreaming && finalAnswer;

  // If there's nothing to show at all, render nothing
  const hasAnythingToShow = hasMeaningfulSegments || showStreamingContent || showFinalAnswerInTimeline || showFinalAnswerOutside || showTasksSection || showFilesSection;

  // If streaming but nothing to show yet, show thinking indicator
  if (isStreaming && !hasAnythingToShow) {
    return (
      <div className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-card/50 border border-border/50">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary/80" />
        </span>
        <span className="text-xs text-muted-foreground">Thinking...</span>
      </div>
    );
  }

  if (!hasAnythingToShow) {
    return null;
  }

  // When streaming without tools, render as simple streaming message (no timeline chrome)
  if (showStreamingContent) {
    return (
      <div className="animate-reveal-ltr bg-muted/30 border border-border/30 rounded-lg px-4 py-3">
        <StreamingMarkdown
          content={finalAnswer}
          isStreaming={true}
        />
      </div>
    );
  }

  return (
    <SubagentLookupContext.Provider value={getSubagentInfo}>
      <div className="space-y-3">
        {/* Summary bar - only shown when NOT streaming and has meaningful timeline segments */}
        {!isStreaming && hasMeaningfulSegments && (
          <DATimelineSummary
            expanded={machineryExpanded}
            onToggle={() => setMachineryExpanded(!machineryExpanded)}
            toolCount={toolCount}
            subagentCount={subagentCount}
            taskCount={showTasksSection ? tasks.length : 0}
            fileCount={showFilesSection ? files.length : 0}
            durationSec={durationSec}
          />
        )}

        {/* Timeline sections - grid-based animation for smooth expand/collapse */}
        {(hasMeaningfulSegments || showFinalAnswerInTimeline) && (
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-150 ease-out",
              showTimeline ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            )}
          >
            <div className="overflow-hidden">
              <div ref={timelineRef} className="relative pl-6">
                {/* Vertical timeline line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/60" />

                {/* Render interleaved segments in stream order */}
                {groupedSegments.map((segment) => (
                  <DASegmentRenderer
                    key={segment.id}
                    segment={segment}
                    isStreaming={isStreaming}
                  />
                ))}

                {/* Streaming final answer - shown as "thinking" content attached to timeline */}
                {showFinalAnswerInTimeline && (
                  <div className="relative pb-3">
                    <TimelineDot color="primary" />
                    <StreamingMarkdown
                      content={finalAnswer}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tasks section */}
        {showTasksSection && (
          <DATaskSection tasks={tasks} readonly={!isLatestMessage} turnEnded={turnEnded} isStreaming={isStreaming} />
        )}

        {/* Files section */}
        {showFilesSection && (
          <DAFileSection
            files={files}
            readonly={!isLatestMessage}
            turnEnded={turnEnded}
            isStreaming={isStreaming}
            onFileDownload={onFileDownload}
            onFileDelete={onFileDelete}
            isDownloading={isDownloadingFile}
            downloadingPath={downloadingFilePath}
            isDeleting={isDeletingFile}
            deletingPath={deletingFilePath}
          />
        )}

        {/* Final answer - only shown after streaming completes */}
        {showFinalAnswerOutside && (
          <div className="animate-reveal-ltr bg-muted/30 border border-border/30 rounded-lg px-4 py-3">
            <StreamingMarkdown
              content={finalAnswer}
            />
          </div>
        )}

        {/* Warnings & Errors summary (only when collapsed) */}
        {!machineryExpanded && hasWarningsOrErrors && (
          <DAWarningsSummary warningCount={warningCount} errorCount={errorCount} />
        )}
      </div>
    </SubagentLookupContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════
// Timeline Dot Component
// ═══════════════════════════════════════════════════════════════

function TimelineDot({ color, size = "md" }: { color: "amber" | "sky" | "muted" | "primary" | "red" | "emerald"; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "absolute rounded-full border-2 bg-background",
        size === "sm" ? "left-[-21px] top-1 w-2 h-2" : "left-[-20px] top-1.5 w-2.5 h-2.5",
        color === "amber" && "border-amber-500",
        color === "sky" && "border-sky-400",
        color === "muted" && "border-muted-foreground/40",
        color === "primary" && "border-primary/60",
        color === "red" && "border-red-500",
        color === "emerald" && "border-emerald-500"
      )}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// Segment Renderer (dispatches to appropriate component)
// ═══════════════════════════════════════════════════════════════

function DASegmentRenderer({
  segment,
  isStreaming,
  isNested = false,
}: {
  segment: DATimelineSegment;
  isStreaming: boolean;
  /** Whether this segment is inside a subagent (affects sizing) */
  isNested?: boolean;
}) {
  const getDotColor = (): "amber" | "sky" | "muted" | "primary" | "red" | "emerald" => {
    switch (segment.type) {
      case "content":
        return "muted";
      case "tool":
        return segment.data.status === "running" ? "amber" : 
               segment.data.status === "failed" ? "red" : "emerald";
      case "tool-group": {
        // Show amber if any tool is running, red if any failed, otherwise emerald
        const hasRunning = segment.tools.some(t => t.status === "running");
        const hasFailed = segment.tools.some(t => t.status === "failed");
        return hasRunning ? "amber" : hasFailed ? "red" : "emerald";
      }
      case "subagent":
        return segment.info.status === "running" ? "sky" : "emerald";
      case "warning":
        return "amber";
      case "error":
        return "red";
      case "status":
        return segment.status === "done" ? "emerald" : "amber";
      case "done":
        return "emerald";
      default:
        return "muted";
    }
  };

  return (
    <div className={cn(
      "relative last:pb-0 animate-in fade-in slide-in-from-top-1 duration-150",
      isNested ? "pb-1.5" : "pb-3"
    )}>
      <TimelineDot color={getDotColor()} size={isNested ? "sm" : "md"} />
      {segment.type === "content" && (
        <DAContentSegmentView segment={segment} isStreaming={isStreaming} isNested={isNested} />
      )}
      {segment.type === "tool" && (
        <DAToolSegmentView segment={segment} isNested={isNested} />
      )}
      {segment.type === "tool-group" && (
        <DAToolGroupSegmentView segment={segment} isNested={isNested} />
      )}
      {segment.type === "subagent" && (
        <DASubagentSegmentView segment={segment} isStreaming={isStreaming} />
      )}
      {segment.type === "warning" && (
        <DAWarningSegmentView segment={segment} isNested={isNested} />
      )}
      {segment.type === "error" && (
        <DAErrorSegmentView segment={segment} isNested={isNested} />
      )}
      {segment.type === "status" && (
        <DAStatusSegmentView segment={segment} isNested={isNested} />
      )}
      {segment.type === "done" && (
        <DADoneSegmentView segment={segment} isNested={isNested} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Content Segment
// ═══════════════════════════════════════════════════════════════

function DAContentSegmentView({
  segment,
  isStreaming,
  isNested = false,
}: {
  segment: DAContentSegment;
  isStreaming: boolean;
  isNested?: boolean;
}) {
  // For nested subagent content, use smaller text with no special styling
  // For root content, use the thinking variant
  if (isNested) {
    return (
      <div className="text-[11px] leading-relaxed text-muted-foreground/70 whitespace-pre-wrap">
        {segment.text.trim()}
      </div>
    );
  }

  return (
    <StreamingMarkdown
      content={segment.text}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// Tool Segment
// ═══════════════════════════════════════════════════════════════

function DAToolSegmentView({ segment, isNested = false }: { segment: DAToolSegment; isNested?: boolean }) {
  const { data: tool } = segment;
  const thought = extractToolThought(tool.args);
  const argsPreview = formatToolArgsPreview(tool.args);
  const isRunning = tool.status === "running";
  const isFailed = tool.status === "failed";
  const errorDisplay = isFailed && tool.error ? formatToolError(tool.error) : null;

  return (
    <div
      className={cn(
        "rounded-md",
        isNested ? "text-[10px] px-2 py-1" : "text-xs px-3 py-1.5",
        isRunning && "bg-amber-500/10 border border-amber-500/25",
        !isRunning && !isFailed && "bg-emerald-500/8 border border-emerald-500/20",
        isFailed && "bg-red-500/10 border border-red-500/25"
      )}
    >
      {/* Header row with tool name, thought, and status */}
      <div className="flex items-center gap-1.5">
        {isRunning ? (
          <Loader2 className={cn("animate-spin text-amber-500 shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
        ) : isFailed ? (
          <XCircle className={cn("text-red-500 shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
        ) : (
          <CheckCircle className={cn("text-emerald-500 shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
        )}
        <span className="font-medium text-foreground/80">{tool.name}</span>
        {thought && (
          <span className={cn(
            "text-muted-foreground/60 truncate flex-1 italic",
            isNested ? "text-[9px]" : "text-[10px]"
          )}>
            — {thought}
          </span>
        )}
        <span
          className={cn(
            "ml-auto shrink-0",
            isNested ? "text-[9px]" : "text-[10px]",
            isRunning && "text-amber-500",
            !isRunning && !isFailed && "text-emerald-500/70",
            isFailed && "text-red-500"
          )}
        >
          {isRunning ? "running" : isFailed ? "failed" : "done"}
        </span>
      </div>
      {/* Error message for failed tools */}
      {errorDisplay && (
        <p className={cn(
          "text-red-400/80 mt-0.5 font-mono leading-snug",
          isNested ? "text-[8px]" : "text-[10px]"
        )}>
          {errorDisplay}
        </p>
      )}
      {/* Arguments preview in human-friendly format */}
      {argsPreview && (
        <p className={cn(
          "text-muted-foreground/50 mt-0.5 font-mono leading-snug",
          isNested ? "text-[8px]" : "text-[10px]"
        )}>
          {argsPreview}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helper: Format tool error message for display
// ═══════════════════════════════════════════════════════════════

/**
 * Return the raw error string as-is for full transparency.
 */
function formatToolError(raw: string): string {
  return raw;
}

// ═══════════════════════════════════════════════════════════════
// Helper: Format tool arguments for display
// ═══════════════════════════════════════════════════════════════

function formatToolArgsPreview(args?: Record<string, unknown>, maxLength = 80): string | null {
  if (!args || Object.keys(args).length === 0) return null;
  
  // Skip thought/description keys - they're shown separately via extractToolThought
  const skipKeys = new Set([
    "thought", "thoughts", "reason", "thinking", "rationale", 
    "explanation", "description", "purpose", "intent", "goal"
  ]);
  
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (skipKeys.has(key.toLowerCase())) continue;
    
    let displayValue: string;
    if (typeof value === "string") {
      displayValue = value.length > 30 ? value.slice(0, 30) + "..." : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      displayValue = String(value);
    } else if (Array.isArray(value)) {
      displayValue = `[${value.length} items]`;
    } else if (value && typeof value === "object") {
      displayValue = "{...}";
    } else {
      continue;
    }
    
    parts.push(`${key}: ${displayValue}`);
  }
  
  if (parts.length === 0) return null;
  
  const result = parts.join(" · ");
  return result.length > maxLength ? result.slice(0, maxLength) + "..." : result;
}

// ═══════════════════════════════════════════════════════════════
// Tool Group Segment (multiple consecutive tools) - A2A style
// ═══════════════════════════════════════════════════════════════

function DAToolGroupSegmentView({ segment, isNested = false }: { segment: DAToolGroupSegment; isNested?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { tools } = segment;
  const completedCount = tools.filter(t => t.status === "completed").length;
  const hasRunning = tools.some(t => t.status === "running");

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 text-left",
          "hover:bg-muted/30 transition-colors duration-150",
          isNested ? "px-2 py-1.5 text-[10px]" : "px-3 py-2 text-xs"
        )}
      >
        <span 
          className={cn(
            "shrink-0 transition-transform duration-150 ease-out",
            expanded && "rotate-180"
          )}
        >
          <ChevronDown className={cn("text-muted-foreground", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
        </span>
        {hasRunning ? (
          <Loader2 className={cn("animate-spin text-amber-500 shrink-0", isNested ? "h-3 w-3" : "h-3.5 w-3.5")} />
        ) : (
          <Wrench className={cn("text-muted-foreground shrink-0", isNested ? "h-3 w-3" : "h-3.5 w-3.5")} />
        )}
        <span className="text-muted-foreground">
          {tools.length} tool{tools.length !== 1 ? "s" : ""}
        </span>
        <span className={cn("text-muted-foreground/60 ml-auto", isNested ? "text-[9px]" : "text-[10px]")}>
          {completedCount}/{tools.length}
        </span>
      </button>
      {/* Grid-based animation for smooth auto-height transitions */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className={cn("space-y-1", isNested ? "px-1.5 pb-1.5" : "px-2 pb-2")}>
            {tools.map((tool) => (
              <DAToolItemView key={tool.id} tool={tool} isNested={isNested} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Single tool item within a group - with individual status background */
function DAToolItemView({ tool, isNested = false }: { tool: DAToolInfo; isNested?: boolean }) {
  const thought = extractToolThought(tool.args);
  const argsPreview = formatToolArgsPreview(tool.args);
  const isRunning = tool.status === "running";
  const isFailed = tool.status === "failed";
  const errorDisplay = isFailed && tool.error ? formatToolError(tool.error) : null;

  return (
    <div
      className={cn(
        "rounded-md",
        isNested ? "px-2 py-1 text-[10px]" : "px-2 py-1.5 text-xs",
        isRunning && "bg-amber-500/10 border border-amber-500/25",
        !isRunning && !isFailed && "bg-emerald-500/8 border border-emerald-500/20",
        isFailed && "bg-red-500/10 border border-red-500/25"
      )}
    >
      {/* Header row with tool name, thought, and status */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className={cn("animate-spin text-amber-500 shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
        ) : isFailed ? (
          <XCircle className={cn("text-red-500 shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
        ) : (
          <CheckCircle className={cn("text-emerald-500 shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
        )}
        <span className="font-medium text-foreground/80">{tool.name}</span>
        {thought && (
          <span className={cn(
            "text-muted-foreground/60 truncate flex-1 italic",
            isNested ? "text-[9px]" : "text-[10px]"
          )}>
            — {thought}
          </span>
        )}
        <span
          className={cn(
            "ml-auto shrink-0",
            isNested ? "text-[8px]" : "text-[10px]",
            isRunning && "text-amber-500",
            !isRunning && !isFailed && "text-emerald-500/70",
            isFailed && "text-red-500"
          )}
        >
          {isRunning ? "running" : isFailed ? "failed" : "done"}
        </span>
      </div>
      {/* Error message for failed tools */}
      {errorDisplay && (
        <p className={cn(
          "text-red-400/80 mt-0.5 font-mono leading-snug",
          isNested ? "text-[8px]" : "text-[10px]"
        )}>
          {errorDisplay}
        </p>
      )}
      {/* Arguments preview in human-friendly format - shown for both nested and non-nested */}
      {argsPreview && (
        <p className={cn(
          "text-muted-foreground/50 mt-0.5 font-mono leading-snug",
          isNested ? "text-[8px]" : "text-[10px]"
        )}>
          {argsPreview}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Subagent Segment (with nested timeline)
// ═══════════════════════════════════════════════════════════════

function DASubagentSegmentView({
  segment,
  isStreaming,
}: {
  segment: DASubagentSegment;
  isStreaming: boolean;
}) {
  const { info, segments: nestedSegments } = segment;
  const isRunning = info.status === "running";
  
  // Group consecutive tools in nested segments (same as parent)
  const groupedNestedSegments = groupConsecutiveTools(nestedSegments);
  
  // Look up subagent info for gradient
  const getSubagentInfo = useContext(SubagentLookupContext);
  const subagentLookup = getSubagentInfo?.(info.name);
  const gradientStyle = subagentLookup?.gradientTheme 
    ? getGradientStyle(subagentLookup.gradientTheme) 
    : null;

  // Custom icon with gradient avatar
  const subagentIcon = (
    <div 
      className={cn(
        "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
        !gradientStyle && "bg-sky-500/20"
      )}
      style={gradientStyle || undefined}
    >
      <Bot className="h-3 w-3 text-white" />
    </div>
  );
  
  // Build a description string for collapsed mode
  const purposePreview = info.purpose 
    ? (info.purpose.length > 180 ? info.purpose.slice(0, 180) + "..." : info.purpose)
    : null;

  return (
    <CollapsibleSection
      title={
        <span className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium text-foreground/80">{subagentLookup?.name || info.name}</span>
          {purposePreview && (
            <span className="text-muted-foreground/50 truncate text-[11px]">
              — {purposePreview}
            </span>
          )}
        </span>
      }
      icon={subagentIcon}
      badge={
        isRunning ? (
          <div className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 text-sky-400 animate-spin" />
            <span className="text-[10px] text-sky-400">running</span>
          </div>
        ) : (
          <CheckCircle className="h-3 w-3 text-emerald-500" />
        )
      }
      defaultExpanded={false}
      contentClassName="relative pl-8 pr-3 pt-2 pb-2"
      headerClassName="py-2.5 px-3 text-xs"
      className={cn(
        isRunning && "bg-sky-500/5 border-sky-500/30"
      )}
    >
      {/* Nested vertical timeline line */}
      <div className="absolute left-3 top-1 bottom-1 w-px bg-border/30" />

      {/* Nested segments (interleaved content + tools, grouped) */}
      {groupedNestedSegments.map((nestedSeg) => (
        <DASegmentRenderer
          key={nestedSeg.id}
          segment={nestedSeg}
          isStreaming={isStreaming && isRunning}
          isNested={false}
        />
      ))}

      {/* Show loading if running but no segments yet */}
      {isRunning && nestedSegments.length === 0 && (
        <div className="relative pb-0">
          <TimelineDot color="primary" size="md" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Working...</span>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ═══════════════════════════════════════════════════════════════
// Warning Segment
// ═══════════════════════════════════════════════════════════════

function DAWarningSegmentView({ segment, isNested = false }: { segment: DAWarningSegment; isNested?: boolean }) {
  return (
    <div className={cn(
      "flex items-start gap-1.5 text-amber-500 rounded-md bg-amber-500/10 border border-amber-500/25",
      isNested ? "text-[10px] px-2 py-1" : "text-xs px-3 py-2"
    )}>
      <AlertTriangle className={cn("shrink-0 mt-0.5", isNested ? "h-2.5 w-2.5" : "h-3.5 w-3.5")} />
      <span>{segment.message}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Error Segment
// ═══════════════════════════════════════════════════════════════

function DAErrorSegmentView({ segment, isNested = false }: { segment: DAErrorSegment; isNested?: boolean }) {
  return (
    <div className={cn(
      "flex items-start gap-1.5 text-red-500 rounded-md bg-red-500/10 border border-red-500/25",
      isNested ? "text-[10px] px-2 py-1" : "text-xs px-3 py-2"
    )}>
      <XCircle className={cn("shrink-0 mt-0.5", isNested ? "h-2.5 w-2.5" : "h-3.5 w-3.5")} />
      <span>{segment.message}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Status Segment (done, interrupted, waiting_for_input)
// ═══════════════════════════════════════════════════════════════

function DAStatusSegmentView({ segment, isNested = false }: { segment: DAStatusSegment; isNested?: boolean }) {
  const { status, label } = segment;
  
  // Determine styling based on status
  const isDone = status === "done";
  const isInterrupted = status === "interrupted";
  const isWaiting = status === "waiting_for_input";
  
  // Status labels
  const statusLabel = isDone ? "Done" : isInterrupted ? "Interrupted" : "Waiting for user response";
  
  return (
    <div className={cn(
      "flex items-center gap-1.5",
      isNested ? "text-[10px]" : "text-xs",
      isDone && "text-emerald-500",
      (isInterrupted || isWaiting) && "text-amber-500"
    )}>
      {isDone ? (
        <CheckCircle className={cn("shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
      ) : (
        <span className="relative flex shrink-0">
          <span className={cn(
            "relative inline-flex rounded-full bg-amber-500",
            isNested ? "h-2 w-2" : "h-2.5 w-2.5"
          )} />
        </span>
      )}
      <span className="font-medium">{statusLabel}</span>
      {label && (
        <span className="text-muted-foreground/60">— {label}</span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Done Segment (completion marker)
// ═══════════════════════════════════════════════════════════════

function DADoneSegmentView({ segment, isNested = false }: { segment: DADoneSegment; isNested?: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 text-emerald-500",
      isNested ? "text-[10px]" : "text-xs"
    )}>
      <CheckCircle className={cn("shrink-0", isNested ? "h-2.5 w-2.5" : "h-3 w-3")} />
      <span className="font-medium">Done</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Summary Bar
// ═══════════════════════════════════════════════════════════════

function DATimelineSummary({
  expanded,
  onToggle,
  toolCount,
  subagentCount,
  taskCount,
  fileCount,
  durationSec,
}: {
  expanded: boolean;
  onToggle: () => void;
  toolCount: number;
  subagentCount: number;
  taskCount: number;
  fileCount: number;
  durationSec?: number;
}) {
  const parts: string[] = [];
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  if (subagentCount > 0) parts.push(`${subagentCount} subagent${subagentCount !== 1 ? "s" : ""}`);
  if (taskCount > 0) parts.push(`${taskCount} task${taskCount !== 1 ? "s" : ""}`);
  if (fileCount > 0) parts.push(`${fileCount} file${fileCount !== 1 ? "s" : ""}`);
  if (durationSec != null && durationSec > 0) {
    parts.push(`${Math.round(durationSec)}s`);
  }

  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
        "bg-muted/40 hover:bg-muted/60 border border-border/40 hover:border-border/60",
        "transition-all duration-200 cursor-pointer text-left"
      )}
    >
      <span 
        className={cn(
          "shrink-0 transition-transform duration-200 ease-out",
          expanded && "rotate-180"
        )}
      >
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">
        {parts.length > 0 ? parts.join(" \u00b7 ") : "View execution details"}
      </span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// Warnings Summary (shown when machinery is collapsed)
// ═══════════════════════════════════════════════════════════════

function DAWarningsSummary({
  warningCount,
  errorCount,
}: {
  warningCount: number;
  errorCount: number;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      {warningCount > 0 && (
        <span className="flex items-center gap-1 text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          {warningCount} warning{warningCount !== 1 ? "s" : ""}
        </span>
      )}
      {errorCount > 0 && (
        <span className="flex items-center gap-1 text-red-500">
          <XCircle className="h-3 w-3" />
          {errorCount} error{errorCount !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Task Section
// ═══════════════════════════════════════════════════════════════

function DATaskSection({
  tasks,
  readonly,
  turnEnded = false,
  isStreaming = false,
}: {
  tasks: TaskItem[];
  readonly: boolean;
  turnEnded?: boolean;
  isStreaming?: boolean;
}) {
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const allCompleted = completedCount === tasks.length;

  return (
    <CollapsibleSection
      title="Tasks"
      icon={allCompleted 
        ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
        : <Loader2 className="h-3.5 w-3.5 text-sky-400" />
      }
      badge={
        <span className={cn(
          "text-[10px]",
          allCompleted ? "text-emerald-500" : "text-muted-foreground"
        )}>
          {completedCount}/{tasks.length}
        </span>
      }
      defaultExpanded={!turnEnded}
      autoCollapseOnStreamEnd
      isStreaming={isStreaming}
      contentClassName="px-3 pb-3"
    >
      <TaskList tasks={tasks} readonly={readonly} />
    </CollapsibleSection>
  );
}

// ═══════════════════════════════════════════════════════════════
// File Section
// ═══════════════════════════════════════════════════════════════

function DAFileSection({
  files,
  readonly,
  turnEnded = false,
  isStreaming = false,
  onFileDownload,
  onFileDelete,
  isDownloading,
  downloadingPath,
  isDeleting,
  deletingPath,
}: {
  files: string[];
  readonly: boolean;
  turnEnded?: boolean;
  isStreaming?: boolean;
  onFileDownload?: (path: string) => void;
  onFileDelete?: (path: string) => void;
  isDownloading?: boolean;
  downloadingPath?: string;
  isDeleting?: boolean;
  deletingPath?: string;
}) {
  return (
    <CollapsibleSection
      title={`${files.length} file${files.length !== 1 ? "s" : ""}`}
      defaultExpanded={!turnEnded}
      autoCollapseOnStreamEnd
      isStreaming={isStreaming}
      contentClassName="px-3 pb-3"
    >
      <FileTree
        files={files}
        onFileClick={readonly ? undefined : onFileDownload}
        onFileDelete={readonly ? undefined : onFileDelete}
        isDownloading={isDownloading}
        downloadingPath={downloadingPath}
        isDeleting={isDeleting}
        deletingPath={deletingPath}
      />
    </CollapsibleSection>
  );
}
