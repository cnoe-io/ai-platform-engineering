"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Layers,
  Radio,
  Activity,
  Wrench,
  CheckSquare,
  FileText,
  CheckCircle,
  AlertCircle,
  Box,
  ListTodo,
  CircleDot,
  MessageSquare,
  Filter,
  Trash2,
  ChevronDown,
  ExternalLink,
  Copy,
  Check,
  Download,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChatStore } from "@/store/chat-store";
import { A2AEvent } from "@/types/a2a";
import { cn, formatTimestamp, truncateText } from "@/lib/utils";
import { A2ATimelineModal } from "./A2ATimelineModal";
import { useShallow } from "zustand/react/shallow";

// Stable empty array to avoid infinite re-render loops in selectors
const EMPTY_EVENTS: A2AEvent[] = [];

const iconMap: Record<string, React.ElementType> = {
  Layers,
  Radio,
  Activity,
  Wrench,
  CheckSquare,
  FileText,
  CheckCircle,
  AlertCircle,
  Box,
  ListTodo,
  CircleDot,
  MessageSquare,
};

type FilterType = "all" | "task" | "artifact" | "tool" | "execution_plan" | "status";

export function A2AStreamPanel() {
  // ═══════════════════════════════════════════════════════════════
  // OPTIMIZED: Targeted Zustand selectors to prevent unnecessary re-renders.
  // Only re-renders when these specific values change, not on every store update.
  // ═══════════════════════════════════════════════════════════════
  const { isStreaming, clearA2AEvents, activeConversationId } = useChatStore(
    useShallow((s) => ({
      isStreaming: s.isStreaming,
      clearA2AEvents: s.clearA2AEvents,
      activeConversationId: s.activeConversationId,
    }))
  );

  // Get a2aEvents for the active conversation.
  // IMPORTANT: Uses useMemo instead of a Zustand selector to avoid infinite loops —
  // returning `[]` from a selector creates a new reference each time, and Zustand's
  // default Object.is equality check sees it as changed, causing re-renders.
  //
  const conversations = useChatStore((s) => s.conversations);
  const a2aEvents = useMemo(() => {
    if (!activeConversationId) return EMPTY_EVENTS;
    const conv = conversations.find((c) => c.id === activeConversationId);
    const events = conv?.a2aEvents || EMPTY_EVENTS;
    const execPlans = events.filter(e => e.artifact?.name === 'execution_plan_update' || e.artifact?.name === 'execution_plan_status_update');
    const toolStarts = events.filter(e => e.artifact?.name === 'tool_notification_start');
    console.log(`[A2A-DEBUG] 🔍 A2AStreamPanel.a2aEvents: conv=${activeConversationId.substring(0, 8)}, total=${events.length}, exec_plans=${execPlans.length}, tool_starts=${toolStarts.length}`);
    return events;
  }, [activeConversationId, conversations]);

  const [filter, setFilter] = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [a2aEvents.length]);

  const filteredEvents = useMemo(() => {
    return a2aEvents.filter((event) => {
      if (filter === "all") return true;
      if (filter === "tool") return event.type === "tool_start" || event.type === "tool_end";
      return event.type === filter;
    });
  }, [a2aEvents, filter]);

  // ═══════════════════════════════════════════════════════════════
  // OPTIMIZED: Single-pass event counting instead of 6 separate .filter() calls
  // ═══════════════════════════════════════════════════════════════
  const eventCounts = useMemo(() => {
    const counts = { all: 0, task: 0, artifact: 0, tool: 0, execution_plan: 0, status: 0 };
    for (const e of a2aEvents) {
      counts.all++;
      if (e.type === "task") counts.task++;
      else if (e.type === "artifact") counts.artifact++;
      else if (e.type === "tool_start" || e.type === "tool_end") counts.tool++;
      else if (e.type === "execution_plan") counts.execution_plan++;
      else if (e.type === "status") counts.status++;
    }
    return counts;
  }, [a2aEvents]);

  // ═══════════════════════════════════════════════════════════════
  // VIRTUALIZATION: Only render visible events for large event lists
  // ═══════════════════════════════════════════════════════════════
  const rowVirtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68, // ~68px per collapsed event row
    overscan: 5,
  });

  const getEventStyles = (type: A2AEvent["type"]) => {
    switch (type) {
      case "task":
        return {
          bg: "bg-sky-500/10",
          border: "border-sky-500/30",
          icon: "text-sky-400",
          badge: "a2a-badge-task",
        };
      case "artifact":
        return {
          bg: "bg-purple-500/10",
          border: "border-purple-500/30",
          icon: "text-purple-400",
          badge: "a2a-badge-artifact",
        };
      case "tool_start":
      case "tool_end":
        return {
          bg: "bg-amber-500/10",
          border: "border-amber-500/30",
          icon: "text-amber-400",
          badge: "a2a-badge-tool",
        };
      case "execution_plan":
        return {
          bg: "bg-cyan-500/10",
          border: "border-cyan-500/30",
          icon: "text-cyan-400",
          badge: "a2a-badge-execution-plan",
        };
      case "status":
        return {
          bg: "bg-green-500/10",
          border: "border-green-500/30",
          icon: "text-green-400",
          badge: "a2a-badge-status",
        };
      case "error":
        return {
          bg: "bg-red-500/10",
          border: "border-red-500/30",
          icon: "text-red-400",
          badge: "bg-red-500/15 text-red-400 border-red-500/30",
        };
      default:
        return {
          bg: "bg-muted/50",
          border: "border-border",
          icon: "text-muted-foreground",
          badge: "bg-muted",
        };
    }
  };

  const getEventIcon = (iconName: string) => {
    return iconMap[iconName] || Box;
  };

  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);

  const copyToClipboard = (text: string, eventId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEventId(eventId);
    setTimeout(() => setCopiedEventId(null), 2000);
  };

  const downloadEvents = () => {
    if (a2aEvents.length === 0) return;

    // Create a formatted JSON with all event details
    const exportData = {
      exportedAt: new Date().toISOString(),
      conversationId: activeConversationId,
      eventCount: a2aEvents.length,
      events: a2aEvents.map((event, idx) => ({
        index: idx,
        id: event.id,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
        displayName: event.displayName,
        displayContent: event.displayContent,
        raw: event.raw,
        artifact: event.artifact,
        status: event.status,
        isFinal: event.isFinal,
        isLastChunk: event.isLastChunk,
        shouldAppend: event.shouldAppend,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `a2a-events-${activeConversationId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-card/30 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className={cn(
            "p-1.5 rounded-md",
            isStreaming ? "bg-green-500/20" : "bg-muted"
          )}>
            <Radio className={cn(
              "h-4 w-4",
              isStreaming ? "text-green-400 animate-pulse" : "text-muted-foreground"
            )} />
          </div>
          <div>
            <h3 className="font-semibold text-sm">A2A Stream</h3>
            <p className="text-xs text-muted-foreground">
              {isStreaming ? "Live" : "Ready"} • {a2aEvents.length} events
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTimelineOpen(true)}
            className="h-8 w-8"
            title="View timeline"
            disabled={a2aEvents.length === 0}
          >
            <Clock className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={downloadEvents}
            className="h-8 w-8"
            title="Download events as JSON"
            disabled={a2aEvents.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => activeConversationId && clearA2AEvents(activeConversationId)}
            className="h-8 w-8"
            title="Clear events"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Timeline Modal */}
      <A2ATimelineModal
        isOpen={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        events={a2aEvents}
        conversationId={activeConversationId || undefined}
      />

      {/* Filters */}
      <div className="flex items-center gap-1 p-2 border-b border-border/50 overflow-x-auto scrollbar-modern">
        {(["all", "task", "artifact", "tool", "execution_plan", "status"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="capitalize">{f === "execution_plan" ? "Plan" : f}</span>
            {eventCounts[f] > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-[10px]",
                filter === f ? "bg-white/20" : "bg-background"
              )}>
                {eventCounts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Events Stream — Virtualized for performance with large event lists */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        {filteredEvents.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-muted flex items-center justify-center">
              <Radio className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {filter === "all" ? "No A2A events yet" : `No ${filter} events`}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Events will appear here during streaming
            </p>
          </div>
        ) : (
          <div
            className="p-2 relative"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const event = filteredEvents[virtualRow.index];
              const Icon = getEventIcon(event.icon);
              const styles = getEventStyles(event.type);
              const isEventExpanded = expanded === event.id;

              return (
                <div
                  key={event.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="pb-2"
                >
                  <div
                    className={cn(
                      "group p-3 rounded-lg border cursor-pointer transition-all",
                      styles.bg,
                      styles.border,
                      isEventExpanded && "ring-1 ring-primary/50"
                    )}
                    onClick={() => setExpanded(isEventExpanded ? null : event.id)}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={cn(
                        "p-1.5 rounded-md shrink-0",
                        styles.bg
                      )}>
                        <Icon className={cn("h-3.5 w-3.5", styles.icon)} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
                            styles.badge
                          )}>
                            {event.displayName}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {formatTimestamp(event.timestamp)}
                          </span>
                          {event.isFinal && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                              ✓ FINAL
                            </span>
                          )}
                          {event.isLastChunk && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30">
                              LAST
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {isEventExpanded
                            ? event.displayContent
                            : truncateText(event.displayContent, 100)
                          }
                        </p>

                        {/* Expanded Details — keep AnimatePresence for expand/collapse only */}
                        <AnimatePresence>
                          {isEventExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-3 pt-3 border-t border-border/50"
                            >
                              <div className="space-y-2 text-xs">
                                {event.taskId && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">Task:</span>
                                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">
                                      {event.taskId.slice(0, 8)}...
                                    </code>
                                  </div>
                                )}
                                {event.contextId && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">Context:</span>
                                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">
                                      {event.contextId.slice(0, 8)}...
                                    </code>
                                  </div>
                                )}
                                {event.artifact && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">Artifact:</span>
                                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">
                                      {event.artifact.name}
                                    </code>
                                  </div>
                                )}

                                <details
                                  className="cursor-pointer group/details"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <summary className="text-muted-foreground hover:text-foreground flex items-center gap-1 select-none">
                                    <ChevronDown className="h-3 w-3 group-open/details:rotate-180 transition-transform" />
                                    Raw JSON
                                  </summary>
                                  <div className="mt-2 relative">
                                    <pre className="p-2 pr-10 bg-muted/50 rounded-md overflow-x-auto text-[10px] font-mono max-h-40 whitespace-pre-wrap break-all">
                                      {JSON.stringify(
                                        // Prefer event.raw if available (live streaming).
                                        // After reload from MongoDB, raw is stripped by serializeA2AEvent
                                        // to avoid circular refs, so reconstruct from persisted fields.
                                        event.raw || {
                                          id: event.id,
                                          type: event.type,
                                          timestamp: event.timestamp,
                                          taskId: event.taskId,
                                          contextId: event.contextId,
                                          status: event.status,
                                          isFinal: event.isFinal,
                                          sourceAgent: event.sourceAgent,
                                          displayName: event.displayName,
                                          displayContent: event.displayContent,
                                          ...(event.artifact ? { artifact: event.artifact } : {}),
                                        },
                                        null,
                                        2
                                      )}
                                    </pre>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className={cn(
                                        "absolute top-1 right-1 h-6 w-6 transition-colors",
                                        copiedEventId === event.id
                                          ? "text-green-500 hover:text-green-500"
                                          : "text-muted-foreground hover:text-foreground"
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const jsonData = event.raw || {
                                          id: event.id,
                                          type: event.type,
                                          timestamp: event.timestamp,
                                          taskId: event.taskId,
                                          contextId: event.contextId,
                                          status: event.status,
                                          isFinal: event.isFinal,
                                          sourceAgent: event.sourceAgent,
                                          displayName: event.displayName,
                                          displayContent: event.displayContent,
                                          ...(event.artifact ? { artifact: event.artifact } : {}),
                                        };
                                        copyToClipboard(JSON.stringify(jsonData, null, 2), event.id);
                                      }}
                                      title={copiedEventId === event.id ? "Copied!" : "Copy JSON"}
                                    >
                                      {copiedEventId === event.id ? (
                                        <Check className="h-3 w-3" />
                                      ) : (
                                        <Copy className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                </details>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-border/50">
        <a
          href="https://a2ui.org/specification/v0.8-a2ui/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>A2A Spec v0.8</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
