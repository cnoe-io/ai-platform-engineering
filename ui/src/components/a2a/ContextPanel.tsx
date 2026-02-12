"use client";

import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio,
  Bug,
  Loader2,
  ListTodo,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Wrench,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import { A2AStreamPanel } from "./A2AStreamPanel";
import { A2AEvent } from "@/types/a2a";
import { useShallow } from "zustand/react/shallow";
import { AgentLogo, getAgentLogo } from "@/components/shared/AgentLogos";

// Stable empty array to avoid infinite re-render loops in selectors
const EMPTY_EVENTS: A2AEvent[] = [];

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
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
}

export function ContextPanel({
  debugMode,
  onDebugModeChange,
  collapsed = false,
  onCollapse
}: ContextPanelProps) {
  // ═══════════════════════════════════════════════════════════════
  // OPTIMIZED: Targeted Zustand selectors to prevent unnecessary re-renders
  // ═══════════════════════════════════════════════════════════════
  const { isStreaming, activeConversationId } = useChatStore(
    useShallow((s) => ({
      isStreaming: s.isStreaming,
      activeConversationId: s.activeConversationId,
    }))
  );

  // Subscribe to conversations directly so memos update when events arrive.
  // Previously used getActiveConversation() which is a stable function ref —
  // its deps never changed when new A2A events were added, making memos stale.
  const conversations = useChatStore((s) => s.conversations);

  // Derive conversation events from conversations (updates when addA2AEvent runs)
  const conversationEvents = useMemo(() => {
    if (!activeConversationId) return EMPTY_EVENTS;
    const conv = conversations.find((c) => c.id === activeConversationId);
    const events = conv?.a2aEvents || EMPTY_EVENTS;
    const execPlans = events.filter(e => e.artifact?.name === 'execution_plan_update' || e.artifact?.name === 'execution_plan_status_update');
    const toolStarts = events.filter(e => e.artifact?.name === 'tool_notification_start');
    const toolEnds = events.filter(e => e.artifact?.name === 'tool_notification_end');
    console.log(`[A2A-DEBUG] 🎯 ContextPanel.conversationEvents: conv=${activeConversationId.substring(0, 8)}, total=${events.length}, exec_plans=${execPlans.length}, tool_starts=${toolStarts.length}, tool_ends=${toolEnds.length}`);
    if (execPlans.length > 0) {
      console.log(`[A2A-DEBUG] 🎯 Execution plan contents:`, execPlans.map(e => ({
        id: e.id,
        text: e.artifact?.parts?.[0]?.text?.substring(0, 200),
      })));
    }
    return events;
  }, [activeConversationId, conversations]);

  // Default to tasks tab, switch to debug if debug mode is enabled
  const [activeTab, setActiveTab] = useState<"tasks" | "debug">(debugMode ? "debug" : "tasks");
  // Collapse tool history after streaming ends
  const [toolsCollapsed, setToolsCollapsed] = useState(false);

  // Get the active conversation (for non-events data like messages)
  const conversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [activeConversationId, conversations]);

  // Check if streaming is truly active.
  // Use the store's isStreaming as the single source of truth. Previously this
  // also checked isFinal and scanned for final_result artifacts, which caused
  // tasks to be force-marked "completed" mid-stream when final_result arrived
  // before the stream actually closed — making tasks disappear during streaming.
  const isActuallyStreaming = useMemo(() => {
    if (!isStreaming) return false;
    if (!conversation) return false;
    return true;
  }, [isStreaming, conversation]);

  // Parse execution plan tasks from A2A events (per-conversation)
  // When streaming ends, mark all tasks as completed
  const executionTasks = useMemo(() => {
    const tasks = parseExecutionTasks(conversationEvents);
    console.log(`[A2A-DEBUG] 📋 ContextPanel.executionTasks: parsed ${tasks.length} tasks from ${conversationEvents.length} events, isStreaming=${isActuallyStreaming}`, tasks.map(t => ({
      id: t.id,
      agent: t.agent,
      description: t.description?.substring(0, 50),
      status: t.status,
    })));
    // If streaming has ended and we have tasks, mark remaining as completed
    if (!isActuallyStreaming && tasks.length > 0) {
      return tasks.map(task => ({
        ...task,
        status: task.status === "failed" ? "failed" : "completed" as const,
      }));
    }
    return tasks;
  }, [conversationEvents, isActuallyStreaming]);

  // Parse tool calls - show running during streaming, completed after
  const { activeToolCalls, completedToolCalls } = useMemo(() => {
    const allTools = parseToolCalls(conversationEvents);
    console.log(`[A2A-DEBUG] 🔧 ContextPanel.toolCalls: parsed ${allTools.length} tools, isStreaming=${isActuallyStreaming}`, allTools.map(t => ({
      tool: t.tool,
      status: t.status,
      agent: t.agent,
    })));
    if (isActuallyStreaming) {
      // During streaming: show only running tools
      return {
        activeToolCalls: allTools.filter(t => t.status === "running"),
        completedToolCalls: allTools.filter(t => t.status === "completed"),
      };
    } else {
      // After streaming: mark ALL tools as completed for history
      // (since streaming ended, all tools must have finished)
      const completedTools = allTools.map(t => ({ ...t, status: "completed" as const }));
      return {
        activeToolCalls: [],
        completedToolCalls: completedTools,
      };
    }
  }, [conversationEvents, isActuallyStreaming]);

  // Sync tab with debug mode
  useEffect(() => {
    if (debugMode) {
      setActiveTab("debug");
    }
  }, [debugMode]);


  // Count events for badge (using conversation-specific events)
  const eventCount = conversationEvents.length;

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 380 }}
      transition={{ duration: 0.2 }}
      className="relative h-full flex flex-col bg-card/30 backdrop-blur-sm border-l border-border/50 shrink-0 overflow-hidden"
    >
      {/* Header with Tabs */}
      <div className="border-b border-border/50">
        <div className={cn(
          "flex items-center py-2",
          collapsed ? "justify-center px-2" : "justify-between px-3"
        )}>
          {collapsed ? (
            /* Collapsed state - show collapse button */
            onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onCollapse(!collapsed)}
                className="h-8 w-8 hover:bg-muted shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )
          ) : (
            <>
              <Tabs
                value={activeTab}
                onValueChange={(v) => {
                  const tab = v as "tasks" | "debug";
                  setActiveTab(tab);
                  // Sync debug mode with tab selection
                  if (tab === "debug" && !debugMode) {
                    onDebugModeChange(true);
                  } else if (tab === "tasks" && debugMode) {
                    onDebugModeChange(false);
                  }
                }}
              >
                <TabsList className="h-8 bg-muted/50">
                  <TabsTrigger
                    value="tasks"
                    className={cn(
                      "text-xs gap-1.5 h-7 px-3",
                      executionTasks.length > 0 && activeTab === "tasks" && "text-sky-400"
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
                      activeTab === "debug" && "text-amber-400"
                    )}
                  >
                    <Bug className="h-3.5 w-3.5" />
                    A2A Debug
                    {eventCount > 0 && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "ml-1 h-4 px-1 text-[10px]",
                          activeTab === "debug" && "bg-amber-500/20 text-amber-400"
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
                {isActuallyStreaming && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/15 text-green-400 text-xs">
                    <Radio className="h-3 w-3 animate-pulse" />
                    Live
                  </div>
                )}
                {/* Collapse Toggle */}
                {onCollapse && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onCollapse(!collapsed)}
                    className="h-8 w-8 hover:bg-muted shrink-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          {activeTab === "tasks" ? (
          /* Tasks Tab - Execution Plan (Default) */
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* ═══════════════════════════════════════════════════════
                  EXECUTION PLAN — Always visible during streaming.
                  Previously nested tool calls inside the execution plan
                  branch, so tools disappeared when no plan existed yet.
                  Now: plan and tools are independent, always-visible sections.
                  ═══════════════════════════════════════════════════════ */}

              {/* Execution Plan Section */}
              {executionTasks.length > 0 && (
                <>
                  {/* Progress Header */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-foreground">
                        <ListTodo className="h-4 w-4 text-sky-400" />
                        <span className="font-medium">Execution Plan</span>
                      </div>
                      <span className="text-xs font-medium text-foreground/80">
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
                            task.status === "completed" && "bg-emerald-500/15 border-emerald-500/40",
                            task.status === "in_progress" && "bg-sky-500/15 border-sky-500/40",
                            task.status === "pending" && "bg-muted/30 border-border/50 hover:bg-muted/50",
                            task.status === "failed" && "bg-red-500/15 border-red-500/40"
                          )}
                        >
                          {/* Status Indicator */}
                          <div className="mt-0.5 w-4 h-4 flex items-center justify-center">
                            {task.status === "completed" ? (
                              <div className="relative w-4 h-4">
                                <div
                                  className="w-4 h-4 rounded bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                                  style={{ backgroundColor: '#10B981' }}
                                />
                                <svg
                                  className="absolute inset-0 w-4 h-4 text-white pointer-events-none drop-shadow-sm"
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
                              </div>
                            ) : task.status === "in_progress" ? (
                              <Loader2
                                className="w-4 h-4 animate-spin"
                                style={{ color: '#0EA5E9', filter: 'drop-shadow(0 0 4px rgba(14,165,233,0.5))' }}
                              />
                            ) : task.status === "failed" ? (
                              <div
                                className="w-4 h-4 rounded border-2 flex items-center justify-center shadow-[0_0_6px_rgba(239,68,68,0.5)]"
                                style={{ borderColor: '#EF4444' }}
                              >
                                <span className="text-xs font-bold" style={{ color: '#EF4444' }}>✕</span>
                              </div>
                            ) : (
                              <div className="w-4 h-4 rounded border-2 border-muted-foreground/40" />
                            )}
                          </div>

                          {/* Task Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className={cn(
                                "transition-opacity",
                                task.status === "completed" && "opacity-50"
                              )}>
                                <AgentLogo agent={task.agent} size="sm" />
                              </div>
                              {(() => {
                                const agentLogo = getAgentLogo(task.agent);
                                return (
                                  <span
                                    className={cn(
                                      "text-[10px] font-semibold px-1.5 py-0.5 rounded transition-opacity text-foreground",
                                      task.status === "completed" && "opacity-50"
                                    )}
                                    style={{
                                      backgroundColor: agentLogo ? `${agentLogo.color}30` : 'var(--muted)',
                                    }}
                                  >
                                    {agentLogo?.displayName || task.agent}
                                  </span>
                                );
                              })()}
                            </div>
                            <p className={cn(
                              "text-sm leading-relaxed",
                              task.status === "completed" && "text-muted-foreground line-through decoration-2 opacity-60",
                              task.status === "in_progress" && "text-foreground font-medium",
                              task.status === "pending" && "text-foreground/80"
                            )}>
                              {task.description}
                            </p>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </>
              )}

              {/* Tool Calls Section — ALWAYS visible, independent of execution plan.
                  Previously tool calls were nested inside the executionTasks branch,
                  so they disappeared when no plan tasks existed yet. */}
              {(activeToolCalls.length > 0 || completedToolCalls.length > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={cn(
                    "space-y-3",
                    executionTasks.length > 0 && "mt-4 pt-4 border-t border-border/30"
                  )}
                >
                  {/* Active Tool Calls */}
                  {activeToolCalls.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs" style={{ color: '#F59E0B' }}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ filter: 'drop-shadow(0 0 3px rgba(245,158,11,0.4))' }} />
                        <span className="font-semibold">Active Tool Calls</span>
                      </div>
                      <div className="space-y-1.5">
                        {activeToolCalls.map((tool) => (
                          <div
                            key={tool.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/15 border border-amber-500/30 text-sm"
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" style={{ color: '#F59E0B' }} />
                            <span className="text-foreground/90 truncate">
                              <span className="font-medium" style={{ color: '#F59E0B' }}>{tool.agent}</span>
                              <span className="text-foreground/60"> → </span>
                              <span>{tool.tool}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Completed Tool Calls */}
                  {completedToolCalls.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs" style={{ color: '#10B981' }}>
                        <CheckCircle className="h-3.5 w-3.5" style={{ filter: 'drop-shadow(0 0 3px rgba(16,185,129,0.4))' }} />
                        <span className="font-semibold">Completed ({completedToolCalls.length})</span>
                      </div>
                      <div className="space-y-1">
                        {completedToolCalls.map((tool) => (
                          <div
                            key={tool.id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-sm"
                          >
                            <CheckCircle className="h-3 w-3 shrink-0" style={{ color: '#10B981' }} />
                            <span className="text-foreground/70 truncate text-xs">
                              <span className="font-medium text-foreground/80">{tool.agent}</span>
                              <span className="text-foreground/40"> → </span>
                              <span>{tool.tool}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Empty state — only when nothing at all is happening */}
              {executionTasks.length === 0 && activeToolCalls.length === 0 && completedToolCalls.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-sky-500/20 to-purple-500/20 flex items-center justify-center">
                    <ListTodo className="h-6 w-6 text-sky-400" />
                  </div>
                  <p className="text-sm font-medium text-foreground/80">
                    {isActuallyStreaming ? "Waiting for tasks..." : "No active tasks"}
                  </p>
                  <p className="text-xs text-foreground/60 mt-1">
                    {isActuallyStreaming ? "The agent is working — tasks will appear shortly" : "Task plans will appear here during execution"}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          /* A2A Debug Tab - Full Event Stream */
          <A2AStreamPanel />
        )}
        </div>
      )}
    </motion.div>
  );
}

// Parse execution plan tasks from A2A events (ONLY from execution_plan artifacts, not tool notifications)
function parseExecutionTasks(events: A2AEvent[]): ExecutionTask[] {
  const tasksMap = new Map<string, ExecutionTask>();
  let execPlanEventCount = 0;

  events.forEach((event, eventIdx) => {
    // ONLY check for execution plan artifacts - NOT tool notifications
    if (event.artifact?.name === "execution_plan_update" ||
        event.artifact?.name === "execution_plan_status_update") {
      execPlanEventCount++;

      const text = event.displayContent || event.artifact?.parts?.[0]?.text || "";
      console.log(`[A2A-DEBUG] 📋 parseExecutionTasks: processing exec_plan event #${execPlanEventCount} (eventIdx=${eventIdx}, eventId=${event.id})`, {
        artifactName: event.artifact?.name,
        textPreview: text.substring(0, 200),
        existingTaskKeys: Array.from(tasksMap.keys()),
      });

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
  });

  // Sort by order
  return Array.from(tasksMap.values()).sort((a, b) => a.order - b.order);
}

// Tool call interface
interface ToolCall {
  id: string;
  agent: string;
  tool: string;
  status: "running" | "completed";
  timestamp: number;
}

// Parse active tool calls from A2A events
function parseToolCalls(events: A2AEvent[]): ToolCall[] {
  const toolsMap = new Map<string, ToolCall>();

  events.forEach((event, idx) => {
    if (event.type === "tool_start") {
      // Try to get tool name from artifact description (most reliable)
      // Format: "Tool call started: {tool_name}"
      const description = event.artifact?.description || "";
      const text = event.displayContent || "";

      let toolName = "Unknown Tool";
      let agentName = "Agent";

      // Parse from description: "Tool call started: list_pull_requests"
      const descMatch = description.match(/Tool call (?:started|completed):\s*(.+)/i);
      if (descMatch) {
        toolName = descMatch[1].trim();
      }

      // Try to get agent from displayContent: "🔧 Supervisor: Calling Agent Github..."
      const agentMatch = text.match(/🔧?\s*(\w+):\s*(?:Calling|Tool)/i);
      if (agentMatch) {
        agentName = agentMatch[1];
      }

      // Also try pattern: "Github: Calling tool: List_Pull_Requests"
      const fullMatch = text.match(/(\w+):\s*(?:Calling\s+)?(?:tool:\s*|Agent\s+)?(\w+)/i);
      if (fullMatch && !descMatch) {
        agentName = fullMatch[1];
        toolName = fullMatch[2];
      }

      const toolId = `tool-${event.id}`;
      toolsMap.set(toolId, {
        id: toolId,
        agent: agentName,
        tool: toolName,
        status: "running",
        timestamp: idx,
      });
    }

    if (event.type === "tool_end") {
      // Get tool name from artifact description
      const description = event.artifact?.description || "";
      const descMatch = description.match(/Tool call (?:completed|started):\s*(.+)/i);
      const toolName = descMatch ? descMatch[1].trim().toLowerCase() : "";

      // Mark matching running tool as complete
      for (const [, tool] of toolsMap) {
        if (tool.status === "running") {
          // Match by tool name if available, otherwise just mark the oldest running tool
          if (toolName && tool.tool.toLowerCase() === toolName) {
            tool.status = "completed";
            break;
          } else if (!toolName) {
            tool.status = "completed";
            break;
          }
        }
      }
    }
  });

  return Array.from(toolsMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}
