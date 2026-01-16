"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio,
  Bug,
  FileText,
  CheckCircle,
  Loader2,
  Sparkles,
  Activity,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useChatStore } from "@/store/chat-store";
import { cn, extractFinalAnswer } from "@/lib/utils";
import { A2AStreamPanel } from "./A2AStreamPanel";

interface ContextPanelProps {
  debugMode: boolean;
  onDebugModeChange: (enabled: boolean) => void;
}

export function ContextPanel({ debugMode, onDebugModeChange }: ContextPanelProps) {
  const { a2aEvents, isStreaming, activeConversationId, conversations } = useChatStore();
  const [activeTab, setActiveTab] = useState<"output" | "debug">(debugMode ? "debug" : "output");
  const [streamingChunks, setStreamingChunks] = useState<string[]>([]);
  const [showStreaming, setShowStreaming] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync tab with debug mode
  useEffect(() => {
    if (debugMode) {
      setActiveTab("debug");
    }
  }, [debugMode]);

  // Get active conversation
  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const lastAssistantMessage = activeConversation?.messages
    .filter((m) => m.role === "assistant")
    .slice(-1)[0];

  // Extract streaming text from artifacts
  useEffect(() => {
    if (isStreaming) {
      setShowStreaming(true);
      // Clear any pending fade timeout
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }

      // Collect text artifacts for streaming display
      const textArtifacts = a2aEvents
        .filter((e) => e.type === "artifact" && e.artifact?.text)
        .map((e) => e.artifact?.text || "");
      setStreamingChunks(textArtifacts);
    }
  }, [a2aEvents, isStreaming]);

  // Auto-scroll on new chunks
  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingChunks, isStreaming]);

  // Fade out streaming after final output
  useEffect(() => {
    if (!isStreaming && streamingChunks.length > 0) {
      // Wait 3 seconds after streaming ends, then fade out
      fadeTimeoutRef.current = setTimeout(() => {
        setShowStreaming(false);
        setStreamingChunks([]);
      }, 3000);
    }

    return () => {
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, [isStreaming, streamingChunks.length]);

  // Extract final answer from last message
  const finalAnswer = lastAssistantMessage
    ? extractFinalAnswer(lastAssistantMessage.content)
    : null;

  // Count events for badge
  const eventCount = a2aEvents.length;

  return (
    <div className="h-full flex flex-col bg-card/30 backdrop-blur-sm">
      {/* Header with Tabs */}
      <div className="border-b border-border/50">
        <div className="flex items-center justify-between px-3 py-2">
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              const tab = v as "output" | "debug";
              setActiveTab(tab);
              // Sync debug mode with tab selection
              if (tab === "debug" && !debugMode) {
                onDebugModeChange(true);
              }
            }}
          >
            <TabsList className="h-8 bg-muted/50">
              <TabsTrigger value="output" className="text-xs gap-1.5 h-7 px-3">
                <FileText className="h-3.5 w-3.5" />
                Output
              </TabsTrigger>
              <TabsTrigger
                value="debug"
                className={cn(
                  "text-xs gap-1.5 h-7 px-3",
                  debugMode && "text-amber-400"
                )}
              >
                <Bug className="h-3.5 w-3.5" />
                A2A Debug
                {eventCount > 0 && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "ml-1 h-4 px-1 text-[10px]",
                      debugMode && "bg-amber-500/20 text-amber-400"
                    )}
                  >
                    {eventCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            {/* Streaming indicator */}
            {isStreaming && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/15 text-green-400 text-xs">
                <Radio className="h-3 w-3 animate-pulse" />
                Live
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "output" ? (
          <ScrollArea className="h-full" ref={scrollRef}>
            <div className="p-4 space-y-4">
              {/* Streaming Section */}
              <AnimatePresence>
                {showStreaming && streamingChunks.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />
                        <span>Streaming Response</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          setShowStreaming(false);
                          setStreamingChunks([]);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="relative p-3 rounded-lg bg-muted/30 border border-border/50">
                      <div className="absolute top-2 right-2">
                        <Loader2 className="h-4 w-4 text-primary animate-spin" />
                      </div>
                      <div className="text-sm text-muted-foreground leading-relaxed pr-8">
                        {streamingChunks.slice(-5).map((chunk, idx) => (
                          <motion.span
                            key={idx}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="block"
                          >
                            {chunk.slice(0, 200)}
                            {chunk.length > 200 && "..."}
                          </motion.span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Final Answer Section */}
              {finalAnswer && !isStreaming && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <span className="font-medium text-green-400">Final Answer</span>
                  </div>

                  <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {finalAnswer}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Context Information */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Context</span>
                </div>

                {/* Active Agents */}
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-xs text-muted-foreground mb-2">Active Agents</p>
                  <div className="flex flex-wrap gap-1.5">
                    {getActiveAgents(a2aEvents).length > 0 ? (
                      getActiveAgents(a2aEvents).map((agent) => (
                        <Badge key={agent} variant="outline" className="text-xs">
                          {agent}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground/70">No agents active</span>
                    )}
                  </div>
                </div>

                {/* Event Summary */}
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-xs text-muted-foreground mb-2">Session Stats</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Events:</span>
                      <span className="font-medium">{eventCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Artifacts:</span>
                      <span className="font-medium">
                        {a2aEvents.filter((e) => e.type === "artifact").length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tools:</span>
                      <span className="font-medium">
                        {a2aEvents.filter((e) => e.type === "tool_start" || e.type === "tool_end").length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      <span className={cn(
                        "font-medium",
                        isStreaming ? "text-green-400" : "text-muted-foreground"
                      )}>
                        {isStreaming ? "Active" : "Idle"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Empty state */}
              {!finalAnswer && !isStreaming && streamingChunks.length === 0 && eventCount === 0 && (
                <div className="text-center py-12">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    No output yet
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Start a chat to see streaming output here
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <A2AStreamPanel />
        )}
      </div>
    </div>
  );
}

// Helper to extract active agents from events
function getActiveAgents(events: Array<{ raw?: unknown }>): string[] {
  const agents = new Set<string>();

  events.forEach((event) => {
    const raw = event.raw as Record<string, unknown> | undefined;
    if (raw) {
      // Check for agent name in various places
      if (raw.agent && typeof raw.agent === "string") {
        agents.add(raw.agent);
      }
      if (raw.metadata && typeof raw.metadata === "object") {
        const meta = raw.metadata as Record<string, unknown>;
        if (meta.agent && typeof meta.agent === "string") {
          agents.add(meta.agent);
        }
      }
      // Check task status for agent
      const result = raw.result as Record<string, unknown> | undefined;
      if (result?.status && typeof result.status === "object") {
        const status = result.status as Record<string, unknown>;
        if (status.message && typeof status.message === "string") {
          // Try to extract agent name from status message
          const match = status.message.match(/\[(\w+)\s+Agent\]/i);
          if (match) {
            agents.add(match[1]);
          }
        }
      }
    }
  });

  return Array.from(agents);
}
