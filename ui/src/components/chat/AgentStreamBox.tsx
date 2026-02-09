"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Copy, Check, Radio, Loader2, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { A2AEvent } from "@/types/a2a";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentLogo, getAgentLogo } from "@/components/shared/AgentLogos";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AgentStreamBoxProps {
  agentName: string;
  events: A2AEvent[];
  isStreaming?: boolean;
  className?: string;
}

/**
 * AgentStreamBox - Individual streaming box for each agent
 * Shows real-time streaming output per agent with intuitive UI
 */
export function AgentStreamBox({
  agentName,
  events,
  isStreaming = false,
  className,
}: AgentStreamBoxProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isAutoScrollingRef = useRef(false);

  // Aggregate streaming content from all events for this agent
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

    return textParts.join("");
  }, [events]);

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

  // Get viewport element for scroll handling
  const viewportRef = useRef<HTMLDivElement>(null);

  // Auto-scroll handler
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement;
    if (!viewport) return;

    viewportRef.current = viewport;

    const handleScroll = () => {
      if (isAutoScrollingRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsUserScrolled(!isAtBottom);
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [isExpanded]);

  // Auto-scroll when content updates
  useEffect(() => {
    if (isUserScrolled || !isExpanded) return;

    const viewport = viewportRef.current || scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement;
    if (!viewport) return;

    isAutoScrollingRef.current = true;
    viewport.scrollTop = viewport.scrollHeight;

    requestAnimationFrame(() => {
      isAutoScrollingRef.current = false;
    });
  }, [streamContent, isUserScrolled, isExpanded]);

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
              <ScrollArea
                ref={scrollAreaRef}
                className="h-[300px] w-full"
              >
                <div className="h-full">
                <div className="p-4">
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden" style={{ overflowWrap: 'anywhere' }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamContent}
                    </ReactMarkdown>
                  </div>

                  {/* Resume auto-scroll button */}
                  {isUserScrolled && (
                    <button
                      onClick={() => {
                        setIsUserScrolled(false);
                        const viewport = viewportRef.current || scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
                        if (viewport) {
                          viewport.scrollTop = viewport.scrollHeight;
                        }
                      }}
                      className="sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors mt-4 z-10"
                    >
                      <ChevronDown className="h-3 w-3" />
                      <span>Resume auto-scroll</span>
                    </button>
                  )}
                </div>
              </div>
              </ScrollArea>
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
}
