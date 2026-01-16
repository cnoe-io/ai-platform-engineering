"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChatStore } from "@/store/chat-store";
import { A2AEvent } from "@/types/a2a";
import { cn, formatTimestamp, truncateText } from "@/lib/utils";

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

type FilterType = "all" | "task" | "artifact" | "tool" | "status";

export function A2AStreamPanel() {
  const { a2aEvents, isStreaming, clearA2AEvents } = useChatStore();
  const [filter, setFilter] = React.useState<FilterType>("all");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [a2aEvents]);

  const filteredEvents = a2aEvents.filter((event) => {
    if (filter === "all") return true;
    if (filter === "tool") return event.type === "tool_start" || event.type === "tool_end";
    return event.type === filter;
  });

  const eventCounts = {
    all: a2aEvents.length,
    task: a2aEvents.filter(e => e.type === "task").length,
    artifact: a2aEvents.filter(e => e.type === "artifact").length,
    tool: a2aEvents.filter(e => e.type === "tool_start" || e.type === "tool_end").length,
    status: a2aEvents.filter(e => e.type === "status").length,
  };

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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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
        <Button
          variant="ghost"
          size="icon"
          onClick={clearA2AEvents}
          className="h-8 w-8"
          title="Clear events"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 p-2 border-b border-border/50 overflow-x-auto scrollbar-modern">
        {(["all", "task", "artifact", "tool", "status"] as FilterType[]).map((f) => (
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
            <span className="capitalize">{f}</span>
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

      {/* Events Stream */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-2 space-y-2">
          <AnimatePresence mode="popLayout">
            {filteredEvents.map((event) => {
              const Icon = getEventIcon(event.icon);
              const styles = getEventStyles(event.type);
              const isExpanded = expanded === event.id;

              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -20, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "group p-3 rounded-lg border cursor-pointer transition-all",
                    styles.bg,
                    styles.border,
                    isExpanded && "ring-1 ring-primary/50"
                  )}
                  onClick={() => setExpanded(isExpanded ? null : event.id)}
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
                        {isExpanded
                          ? event.displayContent
                          : truncateText(event.displayContent, 100)
                        }
                      </p>

                      {/* Expanded Details */}
                      <AnimatePresence>
                        {isExpanded && (
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

                              <details className="cursor-pointer group/details">
                                <summary className="text-muted-foreground hover:text-foreground flex items-center gap-1">
                                  <ChevronDown className="h-3 w-3 group-open/details:rotate-180 transition-transform" />
                                  Raw JSON
                                </summary>
                                <div className="mt-2 relative">
                                  <pre className="p-2 bg-muted/50 rounded-md overflow-x-auto text-[10px] font-mono max-h-40">
                                    {JSON.stringify(event.raw, null, 2)}
                                  </pre>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="absolute top-1 right-1 h-6 w-6"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(JSON.stringify(event.raw, null, 2));
                                    }}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                              </details>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {filteredEvents.length === 0 && (
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
          )}
        </div>
      </ScrollArea>

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
