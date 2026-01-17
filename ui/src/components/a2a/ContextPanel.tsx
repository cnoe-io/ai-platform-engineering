"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
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
  ListTodo,
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useChatStore } from "@/store/chat-store";
import { cn, extractFinalAnswer } from "@/lib/utils";
import { A2AStreamPanel } from "./A2AStreamPanel";
import { A2AEvent } from "@/types/a2a";

// Task status from execution plan
interface ExecutionTask {
  id: string;
  agent: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  order: number;
}

interface ContextPanelProps {
  debugMode: boolean;
  onDebugModeChange: (enabled: boolean) => void;
}

export function ContextPanel({ debugMode, onDebugModeChange }: ContextPanelProps) {
  const { a2aEvents, isStreaming, activeConversationId, conversations } = useChatStore();
  const [activeTab, setActiveTab] = useState<"output" | "tasks" | "debug">(debugMode ? "debug" : "output");
  const [streamingChunks, setStreamingChunks] = useState<string[]>([]);
  const [showStreaming, setShowStreaming] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Parse execution plan tasks from A2A events
  const executionTasks = useMemo(() => {
    return parseExecutionTasks(a2aEvents);
  }, [a2aEvents]);

  // Auto-switch to tasks tab when tasks are detected
  useEffect(() => {
    if (executionTasks.length > 0 && activeTab === "output" && isStreaming) {
      setActiveTab("tasks");
    }
  }, [executionTasks.length, isStreaming, activeTab]);

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
        .filter((e) => e.type === "artifact" && e.artifact?.parts?.[0]?.text)
        .map((e) => e.artifact?.parts?.[0]?.text || "");
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
  const finalAnswerResult = lastAssistantMessage
    ? extractFinalAnswer(lastAssistantMessage.content)
    : null;
  const hasFinalAnswer = finalAnswerResult?.hasFinalAnswer ?? false;
  const finalAnswerContent = finalAnswerResult?.content ?? "";

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
              const tab = v as "output" | "tasks" | "debug";
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
                value="tasks"
                className={cn(
                  "text-xs gap-1.5 h-7 px-3",
                  executionTasks.length > 0 && "text-sky-400"
                )}
              >
                <ListTodo className="h-3.5 w-3.5" />
                Tasks
                {executionTasks.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 text-[10px] bg-sky-500/20 text-sky-400"
                  >
                    {executionTasks.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="debug"
                className={cn(
                  "text-xs gap-1.5 h-7 px-3",
                  debugMode && "text-amber-400"
                )}
              >
                <Bug className="h-3.5 w-3.5" />
                Debug
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
        {activeTab === "tasks" ? (
          /* Tasks Tab - Execution Plan */
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              {executionTasks.length > 0 ? (
                <>
                  {/* Progress Header */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ListTodo className="h-4 w-4 text-sky-400" />
                        <span className="font-medium">Execution Plan</span>
                      </div>
                      <span className="text-xs font-medium">
                        {executionTasks.filter(t => t.status === "completed").length}/{executionTasks.length} completed
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: `${(executionTasks.filter(t => t.status === "completed").length / executionTasks.length) * 100}%`
                        }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                      {executionTasks.map((task, idx) => (
                        <motion.div
                          key={task.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer",
                            task.status === "completed" && "bg-green-500/10 border-green-500/30",
                            task.status === "in_progress" && "bg-sky-500/10 border-sky-500/30",
                            task.status === "pending" && "bg-muted/30 border-border/50 hover:bg-muted/50",
                            task.status === "failed" && "bg-red-500/10 border-red-500/30"
                          )}
                        >
                          {/* Interactive Checkbox */}
                          <div className="mt-0.5 relative">
                            <input
                              type="checkbox"
                              checked={task.status === "completed"}
                              readOnly
                              className={cn(
                                "appearance-none w-4 h-4 rounded border-2 cursor-pointer transition-all",
                                task.status === "completed"
                                  ? "bg-green-500 border-green-500"
                                  : task.status === "in_progress"
                                  ? "border-sky-400 animate-pulse"
                                  : task.status === "failed"
                                  ? "border-red-400"
                                  : "border-muted-foreground/50 hover:border-muted-foreground"
                              )}
                            />
                            {/* Checkmark overlay */}
                            {task.status === "completed" && (
                              <svg
                                className="absolute inset-0 w-4 h-4 text-white pointer-events-none"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                            {/* Spinner overlay for in-progress */}
                            {task.status === "in_progress" && (
                              <Loader2 className="absolute inset-0 w-4 h-4 text-sky-400 animate-spin" />
                            )}
                          </div>

                          {/* Task Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5 py-0",
                                  task.status === "completed" && "border-green-500/50 text-green-400",
                                  task.status === "in_progress" && "border-sky-500/50 text-sky-400",
                                  task.status === "failed" && "border-red-500/50 text-red-400"
                                )}
                              >
                                {task.agent}
                              </Badge>
                            </div>
                            <p className={cn(
                              "text-sm leading-relaxed",
                              task.status === "completed" && "text-muted-foreground line-through",
                              task.status === "in_progress" && "text-foreground",
                              task.status === "pending" && "text-muted-foreground"
                            )}>
                              {task.description}
                            </p>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-sky-500/20 to-purple-500/20 flex items-center justify-center">
                    <ListTodo className="h-6 w-6 text-sky-400" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    No active tasks
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Task plans will appear here during execution
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : activeTab === "output" ? (
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
              {hasFinalAnswer && !isStreaming && (
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
                      {finalAnswerContent}
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
              {!hasFinalAnswer && !isStreaming && streamingChunks.length === 0 && eventCount === 0 && (
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

// Parse execution plan tasks from A2A events
function parseExecutionTasks(events: A2AEvent[]): ExecutionTask[] {
  const tasksMap = new Map<string, ExecutionTask>();

  events.forEach((event) => {
    // Check for execution plan artifacts
    if (event.artifact?.name === "execution_plan_update" ||
        event.artifact?.name === "execution_plan_status_update") {

      const text = event.displayContent || event.artifact?.parts?.[0]?.text || "";

      // Parse TODO list format from agent-forge style output
      // Matches patterns like:
      // ⏳ [ArgoCD] List all applications deployed in comn-dev-use2-1 cluster
      // ✅ [AWS] Query all pods in the cluster
      // 🔄 [CAIPE] Synthesize findings
      const todoPattern = /([⏳✅🔄❌📋])\s*\[([^\]]+)\]\s*(.+)/g;
      let match;
      let order = 0;

      while ((match = todoPattern.exec(text)) !== null) {
        const [, statusEmoji, agent, description] = match;
        const taskId = `${agent}-${description.slice(0, 20)}`.replace(/\s+/g, "-").toLowerCase();

        let status: ExecutionTask["status"] = "pending";
        if (statusEmoji === "✅") status = "completed";
        else if (statusEmoji === "🔄" || statusEmoji === "⏳") status = "in_progress";
        else if (statusEmoji === "❌") status = "failed";

        tasksMap.set(taskId, {
          id: taskId,
          agent: agent.trim(),
          description: description.trim(),
          status,
          order: order++,
        });
      }
    }

    // Also check tool notifications for task-like patterns
    if (event.type === "tool_start" && event.displayContent) {
      const text = event.displayContent;
      // Match agent calls like "Calling Agent Search..."
      const agentMatch = text.match(/(?:Calling|Starting|Running)\s+(?:Agent\s+)?(\w+)/i);
      if (agentMatch) {
        const taskId = `tool-${event.id}`;
        if (!tasksMap.has(taskId)) {
          tasksMap.set(taskId, {
            id: taskId,
            agent: agentMatch[1],
            description: text,
            status: "in_progress",
            order: tasksMap.size,
          });
        }
      }
    }

    // Mark tool_end as completed
    if (event.type === "tool_end") {
      // Find the matching in_progress task and mark it complete
      for (const [id, task] of tasksMap) {
        if (task.status === "in_progress" && id.startsWith("tool-")) {
          task.status = "completed";
          break;
        }
      }
    }
  });

  // Sort by order
  return Array.from(tasksMap.values()).sort((a, b) => a.order - b.order);
}
