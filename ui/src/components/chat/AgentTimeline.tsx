"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ListTodo,
  Wrench,
  MessageSquareText,
  PauseCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SupervisorTimelineSegment, PlanStep, ToolCallInfo } from "@/types/a2a";
import { AgentLogo, getAgentLogo } from "@/components/shared/AgentLogos";
import { MarkdownRenderer } from "@/components/shared/timeline";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ThinkingInfo {
  id: string;
  content: string;
  isStreaming?: boolean;
}

/**
 * Group adjacent standalone tool_call segments into "runs".
 * Each run becomes one ToolGroupDropdown. Non-tool segments stay as-is.
 *
 * Input:  [thinking, tool, tool, thinking, tool]
 * Output: [
 *   { type: "segment", segment: thinking },
 *   { type: "tool_run", tools: [tool, tool] },
 *   { type: "segment", segment: thinking },
 *   { type: "tool_run", tools: [tool] },
 * ]
 */
type RenderItem =
  | { type: "segment"; segment: SupervisorTimelineSegment }
  | { type: "tool_run"; tools: SupervisorTimelineSegment[] };

function groupAdjacentTools(
  segments: SupervisorTimelineSegment[],
  standaloneIds: Set<string>,
): RenderItem[] {
  const items: RenderItem[] = [];
  let currentToolRun: SupervisorTimelineSegment[] = [];

  const flushToolRun = () => {
    if (currentToolRun.length > 0) {
      items.push({ type: "tool_run", tools: [...currentToolRun] });
      currentToolRun = [];
    }
  };

  for (const seg of segments) {
    if (seg.type === "tool_call" && standaloneIds.has(seg.id)) {
      currentToolRun.push(seg);
    } else {
      flushToolRun();
      items.push({ type: "segment", segment: seg });
    }
  }
  flushToolRun();

  return items;
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface SupervisorTimelineProps {
  segments: SupervisorTimelineSegment[];
  isStreaming: boolean;
  durationSec?: number;
  isCollapsed?: boolean;
}

export function SupervisorTimeline({ segments, isStreaming, durationSec, isCollapsed }: SupervisorTimelineProps) {
  // Machinery (plan, tools, thinking) is expanded during streaming, collapses after.
  const [machineryExpanded, setMachineryExpanded] = useState(true);
  const prevStreamingRef = React.useRef(isStreaming);
  React.useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setMachineryExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Classify segments
  const { renderItems, nestedIds, thinkingByStep, stats, finalAnswer, allToolSegments } =
    useMemo(() => {
      const tools = segments.filter((s) => s.type === "tool_call");
      const planSegment = segments.find((s) => s.type === "execution_plan");
      const nested = new Set<string>();
      const standaloneIds = new Set<string>();

      // Classify tool calls: nested under plan vs standalone
      for (const tool of tools) {
        if (
          tool.toolCall?.planStepId &&
          planSegment?.planSteps?.some((s) => s.id === tool.toolCall?.planStepId)
        ) {
          nested.add(tool.id);
        } else {
          standaloneIds.add(tool.id);
        }
      }

      // Nest thinking segments that have a planStepId
      const thinkByStep = new Map<string, ThinkingInfo[]>();
      for (const seg of segments) {
        if (seg.type === "thinking" && seg.planStepId) {
          nested.add(seg.id);
          const list = thinkByStep.get(seg.planStepId) || [];
          list.push({
            id: seg.id,
            content: seg.content || "",
            isStreaming: seg.isStreaming,
          });
          thinkByStep.set(seg.planStepId, list);
        }
      }

      // Machinery = everything except final_answer and nested segments
      const machinery = segments.filter(
        (s) => s.type !== "final_answer" && !nested.has(s.id),
      );

      // Group adjacent standalone tools into runs
      const items = groupAdjacentTools(machinery, standaloneIds);

      const answer = segments.find((s) => s.type === "final_answer");

      return {
        renderItems: items,
        nestedIds: nested,
        thinkingByStep: thinkByStep,
        allToolSegments: tools,
        stats: {
          toolCount: tools.length,
          stepCount: planSegment?.planSteps?.length ?? 0,
          completedTools: tools.filter((s) => s.toolCall?.status === "completed").length,
        },
        finalAnswer: answer,
      };
    }, [segments]);

  const hasMachinery = renderItems.length > 0;

  return (
    <div className="space-y-3">
      {/* Collapsed summary bar — only shown when NOT streaming */}
      {!isStreaming && hasMachinery && (
        <TimelineSummary
          expanded={machineryExpanded}
          onToggle={() => setMachineryExpanded(!machineryExpanded)}
          toolCount={stats.toolCount}
          stepCount={stats.stepCount}
          durationSec={durationSec}
        />
      )}

      {/* Machinery: plan, tools, thinking — expanded during streaming, collapsible after */}
      <AnimatePresence>
        {(isStreaming || machineryExpanded) && hasMachinery && (
          <motion.div
            initial={isStreaming ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative pl-6"
          >
            {/* Vertical timeline line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/60" />

            {renderItems.map((item, idx) => (
              <div key={item.type === "tool_run" ? `toolrun-${idx}` : item.segment.id} className="relative pb-3 last:pb-0">
                {/* Timeline dot */}
                <div className={cn(
                  "absolute left-[-20px] top-1.5 w-2.5 h-2.5 rounded-full border-2 bg-background",
                  item.type === "tool_run" ? "border-amber-500" :
                  item.type === "segment" && item.segment.type === "execution_plan" ? "border-sky-400" :
                  item.type === "segment" && item.segment.type === "thinking" ? "border-muted-foreground/40" :
                  "border-border"
                )} />

                {item.type === "tool_run" ? (
                  <ToolGroupDropdown
                    tools={item.tools}
                    isStreaming={isStreaming}
                  />
                ) : (
                  <SegmentRenderer
                    segment={item.segment}
                    toolSegments={allToolSegments}
                    thinkingByStep={thinkingByStep}
                  />
                )}
              </div>
            ))}

            {/* Streaming cursor — only when no final answer is streaming yet */}
            {isStreaming && !finalAnswer?.isStreaming && (
              <div className="relative pb-0">
                <div className={cn(
                  "absolute left-[-20px] top-1.5 w-2.5 h-2.5 rounded-full border-2 bg-background border-primary/60"
                )} />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Working...</span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Final answer — collapsible via parent's isCollapsed prop */}
      {finalAnswer && (
        <FinalAnswerSegment
          content={
            isCollapsed
              ? (finalAnswer.content || "").slice(0, 300).trim() + ((finalAnswer.content || "").length > 300 ? "..." : "")
              : (finalAnswer.content || "")
          }
          isStreaming={!isCollapsed && finalAnswer.isStreaming}
        />
      )}
    </div>
  );
}

// ─── Segment Renderer ────────────────────────────────────────────────────────

function SegmentRenderer({
  segment,
  toolSegments,
  thinkingByStep,
}: {
  segment: SupervisorTimelineSegment;
  toolSegments?: SupervisorTimelineSegment[];
  thinkingByStep?: Map<string, ThinkingInfo[]>;
}) {
  switch (segment.type) {
    case "thinking":
      return <ThinkingSegment content={segment.content || ""} isStreaming={segment.isStreaming} />;
    case "execution_plan":
      return (
        <PlanSegment
          steps={segment.planSteps || []}
          toolSegments={toolSegments || []}
          thinkingByStep={thinkingByStep || new Map()}
        />
      );
    case "tool_call":
      // Standalone tools rendered individually (shouldn't hit this with grouping, but fallback)
      return segment.toolCall ? <ToolCallSegment tool={segment.toolCall} /> : null;
    default:
      return null;
  }
}

// ─── Timeline Summary (collapsed accordion) ──────────────────────────────────

function TimelineSummary({
  expanded,
  onToggle,
  toolCount,
  stepCount,
  durationSec,
}: {
  expanded: boolean;
  onToggle: () => void;
  toolCount: number;
  stepCount: number;
  durationSec?: number;
}) {
  const parts: string[] = [];
  if (stepCount > 0) parts.push(`${stepCount} step${stepCount !== 1 ? "s" : ""}`);
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  if (durationSec != null && durationSec > 0) {
    parts.push(`${Math.round(durationSec)}s`);
  }

  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
        "bg-muted/40 hover:bg-muted/60 border border-border/40 hover:border-border/60",
        "transition-all duration-200 cursor-pointer text-left",
      )}
    >
      {expanded ? (
        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">
        {parts.length > 0 ? parts.join(" \u00b7 ") : "View execution details"}
      </span>
    </button>
  );
}

// ─── Thinking Segment ────────────────────────────────────────────────────────

function ThinkingSegment({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <MarkdownRenderer
      content={content}
      isStreaming={isStreaming}
      variant="thinking"
    />
  );
}

// ─── Nested Thinking (compact, collapsed under plan steps) ───────────────────

function NestedThinkingSegment({ items }: { items: ThinkingInfo[] }) {
  const [expanded, setExpanded] = useState(false);

  const combined = items.map((i) => i.content).join("\n").trim();
  if (!combined) return null;

  const isStillStreaming = items.some((i) => i.isStreaming);
  const preview = combined.length > 120 ? combined.slice(0, 120) + "..." : combined;

  return (
    <div className="mt-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <MessageSquareText className="h-2.5 w-2.5 shrink-0" />
        {expanded ? (
          <ChevronUp className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        )}
        <span className="truncate max-w-[300px]">
          {expanded ? "Hide details" : preview}
        </span>
        {isStillStreaming && <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />}
      </button>
      {expanded && (
        <div className="mt-1 ml-4 text-[11px] text-muted-foreground/70 italic leading-relaxed whitespace-pre-wrap">
          {combined}
        </div>
      )}
    </div>
  );
}

// ─── Tool Group Dropdown (adjacent standalone tools) ─────────────────────────

function ToolGroupDropdown({
  tools,
  isStreaming,
}: {
  tools: SupervisorTimelineSegment[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const prevStreamingRef = React.useRef(isStreaming);
  React.useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  if (tools.length === 0) return null;

  const completedCount = tools.filter((t) => t.toolCall?.status === "completed").length;
  const hasRunning = tools.some((t) => t.toolCall?.status === "running");

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-xs text-left",
          "hover:bg-muted/30 transition-colors",
        )}
      >
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        {hasRunning ? (
          <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin shrink-0" />
        ) : (
          <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-muted-foreground">
          {tools.length} tool{tools.length !== 1 ? "s" : ""}
        </span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">
          {completedCount}/{tools.length}
        </span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-2 pb-2 space-y-1"
          >
            {tools.map((t) =>
              t.toolCall ? <ToolCallSegment key={t.id} tool={t.toolCall} compact /> : null,
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Plan Segment ────────────────────────────────────────────────────────────

function PlanSegment({
  steps,
  toolSegments,
  thinkingByStep,
}: {
  steps: PlanStep[];
  toolSegments: SupervisorTimelineSegment[];
  thinkingByStep: Map<string, ThinkingInfo[]>;
}) {
  if (steps.length === 0) return null;

  const toolsByStep = new Map<string, ToolCallInfo[]>();
  for (const seg of toolSegments) {
    const stepId = seg.toolCall?.planStepId;
    if (stepId) {
      const list = toolsByStep.get(stepId) || [];
      list.push(seg.toolCall!);
      toolsByStep.set(stepId, list);
    }
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/20">
        <ListTodo className="h-3.5 w-3.5 text-sky-400" />
        <span className="text-xs font-medium text-foreground/80">Plan</span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {steps.filter((s) => s.status === "completed").length}/{steps.length}
        </span>
      </div>
      <div className="p-2 space-y-1">
        {steps.map((step) => {
          const stepTools = toolsByStep.get(step.id) || [];
          const stepThinking = thinkingByStep.get(step.id) || [];
          const hasNestedContent = stepTools.length > 0 || stepThinking.length > 0;
          return (
            <div key={step.id}>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs">
                <StepStatusIcon status={step.status} />
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {step.agent && step.agent !== "Supervisor" && (
                    <AgentBadge agent={step.agent} muted={step.status === "completed"} />
                  )}
                  <span
                    className={cn(
                      "truncate",
                      step.status === "completed" &&
                        "text-muted-foreground line-through opacity-60",
                      step.status === "in_progress" && "text-foreground font-medium",
                      step.status === "input_required" && "text-amber-400 font-medium",
                      step.status === "pending" && "text-foreground/70",
                    )}
                  >
                    {step.description}
                  </span>
                </div>
              </div>
              {hasNestedContent && (
                <div className="ml-7 space-y-1 mb-1">
                  {stepTools.map((tool) => (
                    <ToolCallSegment key={tool.id} tool={tool} compact />
                  ))}
                  {stepThinking.length > 0 && (
                    <NestedThinkingSegment items={stepThinking} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepStatusIcon({ status }: { status: PlanStep["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 text-sky-400 animate-spin shrink-0" />;
    case "input_required":
      return <PauseCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />;
  }
}

function AgentBadge({ agent, muted }: { agent: string; muted?: boolean }) {
  const agentLogo = getAgentLogo(agent);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0",
        muted && "opacity-50",
      )}
      style={{
        backgroundColor: agentLogo ? `${agentLogo.color}25` : "var(--muted)",
        color: agentLogo?.color || "var(--foreground)",
      }}
    >
      <AgentLogo agent={agent} size="sm" showFallback={false} />
      {agentLogo?.displayName || agent}
    </div>
  );
}

// ─── Tool Call Segment ───────────────────────────────────────────────────────

function ToolCallSegment({ tool, compact }: { tool: ToolCallInfo; compact?: boolean }) {
  const isRunning = tool.status === "running";
  const isFailed = tool.status === "failed";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md text-xs",
        compact ? "px-2 py-1" : "px-3 py-1.5",
        isRunning && "bg-amber-500/10 border border-amber-500/25",
        !isRunning && !isFailed && "bg-emerald-500/8 border border-emerald-500/20",
        isFailed && "bg-red-500/10 border border-red-500/25",
      )}
    >
      {isRunning ? (
        <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0" />
      ) : isFailed ? (
        <XCircle className="h-3 w-3 text-red-500 shrink-0" />
      ) : (
        <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
      )}
      <AgentLogo agent={tool.agent || ""} size="sm" showFallback={false} />
      <span className="truncate text-foreground/80">
        <span
          className={cn(
            "font-medium",
            isRunning ? "text-amber-500" : "text-foreground/70",
          )}
        >
          {tool.agent}
        </span>
        <span className="text-foreground/40 mx-1">&rarr;</span>
        <span>{tool.tool}</span>
      </span>
      <span
        className={cn(
          "ml-auto text-[10px] shrink-0",
          isRunning
            ? "text-amber-500"
            : isFailed
              ? "text-red-500"
              : "text-emerald-500/70",
        )}
      >
        {isRunning ? "running" : isFailed ? "failed" : "done"}
      </span>
    </div>
  );
}

// ─── Final Answer Segment ────────────────────────────────────────────────────

function FinalAnswerSegment({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <MarkdownRenderer
      content={content}
      isStreaming={isStreaming}
      variant="final"
    />
  );
}
