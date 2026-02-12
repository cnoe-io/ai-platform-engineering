"use client";

import React, { useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Copy, Check, Radio, Loader2, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { A2AEvent } from "@/types/a2a";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentLogo, getAgentLogo } from "@/components/shared/AgentLogos";

interface AgentStreamBoxProps {
  agentName: string;
  events: A2AEvent[];
  isStreaming?: boolean;
  className?: string;
}

/**
 * AgentStreamBox - Individual streaming box for each agent
 * Shows real-time streaming output per agent with intuitive UI
 * Wrapped in React.memo to prevent re-renders when sibling components update.
 */
export const AgentStreamBox = React.memo(function AgentStreamBox({
  agentName,
  events,
  isStreaming = false,
  className,
}: AgentStreamBoxProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Aggregate streaming content from all events for this agent (chronological order).
  // PERFORMANCE: During streaming, only keep the LAST STREAM_TAIL_CHARS characters
  // to prevent the browser from choking on 80K+ char strings being re-rendered
  // on every token update. Full content is shown once streaming completes.
  const STREAM_TAIL_CHARS = 2000;

  const streamContent = useMemo(() => {
    const textParts: string[] = [];

    for (const event of events) {
      // Skip tool notifications - they're shown in Tasks panel
      if (event.type === "tool_start" || event.type === "tool_end") {
        continue;
      }

      // Skip execution plan artifacts - shown in Tasks panel
      if (event.artifact?.name === "execution_plan_update" ||
          event.artifact?.name === "execution_plan_status_update") {
        continue;
      }

      if (event.displayContent) {
        textParts.push(event.displayContent);
      }
    }

    const full = textParts.join("");

    // During streaming, truncate to tail to avoid choking the DOM
    if (isStreaming && full.length > STREAM_TAIL_CHARS) {
      return "…" + full.slice(-STREAM_TAIL_CHARS);
    }

    return full;
  }, [events, isStreaming]);

  // Determine agent status
  const agentStatus = useMemo(() => {
    if (isStreaming) {
      // Check if agent has active tool calls
      const hasActiveTools = events.some(e => e.type === "tool_start");
      if (hasActiveTools) return "processing";
      return "streaming";
    }

    // Check completion status
    const hasFinalResult = events.some(e =>
      e.artifact?.name === "final_result" ||
      e.artifact?.name === "partial_result"
    );
    if (hasFinalResult) return "completed";

    const hasErrors = events.some(e => e.type === "error");
    if (hasErrors) return "error";

    return "idle";
  }, [events, isStreaming]);

  // Get agent display info
  const agentInfo = useMemo(() => {
    const logo = getAgentLogo(agentName);
    const displayName = logo?.displayName ||
      `${agentName.charAt(0).toUpperCase()}${agentName.slice(1)} Agent`;
    const color = logo?.color || "#6366f1";

    return { displayName, color, logo };
  }, [agentName]);

  // No auto-scroll — user controls their own scroll position.
  // Auto-scroll was removed to prevent layout thrashing on large content.

  const handleCopy = async () => {
    await navigator.clipboard.writeText(streamContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Don't render if no content and not streaming
  if (!streamContent && !isStreaming && agentStatus === "idle") {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden",
        "transition-all duration-200",
        isStreaming && agentStatus === "streaming" && "border-primary/50 ring-2 ring-primary/20",
        agentStatus === "processing" && "border-amber-500/50 ring-2 ring-amber-500/20",
        agentStatus === "completed" && "border-emerald-500/30",
        agentStatus === "error" && "border-red-500/50",
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3",
          "bg-muted/30 border-b cursor-pointer hover:bg-muted/50",
          "transition-colors duration-150"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Agent Logo */}
          <div className="shrink-0">
            <AgentLogo agent={agentName.toLowerCase()} size="sm" />
          </div>

          {/* Agent Name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="font-semibold text-sm truncate"
                style={{ color: agentInfo.color }}
              >
                {agentInfo.displayName}
              </span>

              {/* Status Badge */}
              {agentStatus === "streaming" && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  <Radio className="h-3 w-3 animate-pulse" />
                  <span>Streaming</span>
                </div>
              )}
              {agentStatus === "processing" && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-xs font-medium">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Processing</span>
                </div>
              )}
              {agentStatus === "completed" && !isStreaming && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-medium">
                  <CheckCircle className="h-3 w-3" />
                  <span>Complete</span>
                </div>
              )}
              {agentStatus === "error" && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-xs font-medium">
                  <XCircle className="h-3 w-3" />
                  <span>Error</span>
                </div>
              )}
            </div>

            {/* Content preview when collapsed */}
            {!isExpanded && streamContent && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {streamContent.slice(0, 100)}...
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Copy button */}
          {streamContent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
              className="p-1.5 hover:bg-muted rounded-md transition-colors"
              title="Copy stream content"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          )}

          {/* Expand/Collapse */}
          <button className="p-1.5 hover:bg-muted rounded-md transition-colors">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Streaming Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative"
          >
            {streamContent ? (
              /* Simple scrollable container — no auto-scroll, no flex-col-reverse.
                 flex-col-reverse caused OOM/crash ("Aw, Snap!") on large content
                 (80K+ chars) because the browser re-layouts the entire reversed
                 flex container on every token update. Plain overflow-y-auto is safe. */
              <div
                ref={scrollAreaRef}
                className="h-[300px] w-full overflow-y-auto"
              >
                <div className="p-4">
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden" style={{ overflowWrap: 'anywhere' }}>
                    {/* OPTIMIZED: Defer ReactMarkdown during streaming.
                        Markdown parsing on every token chunk is expensive.
                        Use plain <pre> while streaming, switch to ReactMarkdown when complete. */}
                    {agentStatus === "completed" || agentStatus === "idle" ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamContent}
                      </ReactMarkdown>
                    ) : (
                      <pre className="text-sm whitespace-pre-wrap break-words font-sans leading-relaxed m-0">
                        {streamContent}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ) : isStreaming ? (
              <div className="p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="flex gap-1.5">
                  <div
                    className="h-2 w-2 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <div
                    className="h-2 w-2 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <div
                    className="h-2 w-2 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
                <span className="text-sm">Waiting for {agentInfo.displayName} response...</span>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
