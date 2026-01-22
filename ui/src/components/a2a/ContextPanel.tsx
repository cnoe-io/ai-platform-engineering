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
  Wrench,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import { A2AStreamPanel } from "./A2AStreamPanel";
import { A2AEvent } from "@/types/a2a";
import { AgentLogo, getAgentLogo } from "@/components/shared/AgentLogos";

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
  const { isStreaming, activeConversationId, getActiveConversation, conversations } = useChatStore();
  // Default to tasks tab, switch to debug if debug mode is enabled
  const [activeTab, setActiveTab] = useState<"tasks" | "debug">(debugMode ? "debug" : "tasks");
  // Collapse tool history after streaming ends
  const [toolsCollapsed, setToolsCollapsed] = useState(false);

  // Get events for the active conversation (triggers re-render when conversations change)
  const conversationEvents = useMemo(() => {
    if (!activeConversationId) return [];
    const conv = conversations.find(c => c.id === activeConversationId);
    return conv?.a2aEvents || [];
  }, [activeConversationId, conversations]);

  // Check if streaming is truly active:
  // 1. Global isStreaming must be true
  // 2. AND the active conversation's last message must not be final
  // 3. ALSO check if we have a partial_result or final_result in events (fallback detection)
  // NOTE: complete_result is INTERNAL (sub-agent → supervisor), not final for UI
  const isActuallyStreaming = useMemo(() => {
    if (!isStreaming) return false;
    const conversation = getActiveConversation();
    if (!conversation) return false;
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    // If the last message is marked as final, streaming is done
    if (lastMessage?.isFinal) return false;

    // FALLBACK: Check if we received a partial_result or final_result artifact
    // This catches cases where isFinal wasn't properly set
    // NOTE: complete_result is internal (from sub-agents to supervisor) and should NOT trigger this
    const hasCompleteResult = conversationEvents.some(e =>
      e.artifact?.name === "partial_result" ||
      e.artifact?.name === "final_result"
    );
    if (hasCompleteResult) {
      console.log("[ContextPanel] Detected partial_result/final_result - treating as not streaming");
      return false;
    }

    return true;
  }, [isStreaming, getActiveConversation, activeConversationId, conversationEvents]);

  // Parse execution plan tasks from A2A events (per-conversation)
  // When streaming ends, mark all tasks as completed
  const executionTasks = useMemo(() => {
    const tasks = parseExecutionTasks(conversationEvents);
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
    <div className="h-full flex flex-col bg-card/30 backdrop-blur-sm">
      {/* Header with Tabs */}
      <div className="border-b border-border/50">
        <div className="flex items-center justify-between px-3 py-2">
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
                </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "tasks" ? (
          /* Tasks Tab - Execution Plan (Default) */
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {executionTasks.length > 0 ? (
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
                            task.status === "completed" && "bg-green-500/10 border-green-500/30",
                            task.status === "in_progress" && "bg-sky-500/10 border-sky-500/30",
                            task.status === "pending" && "bg-muted/30 border-border/50 hover:bg-muted/50",
                            task.status === "failed" && "bg-red-500/10 border-red-500/30"
                          )}
                        >
                          {/* Status Indicator */}
                          <div className="mt-0.5 w-4 h-4 flex items-center justify-center">
                            {task.status === "completed" ? (
                              /* Completed - Green checkbox with checkmark */
                              <div className="relative w-4 h-4">
                                <div className="w-4 h-4 rounded bg-green-500" />
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
                              </div>
                            ) : task.status === "in_progress" ? (
                              /* In Progress - Spinner only, no box */
                              <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                            ) : task.status === "failed" ? (
                              /* Failed - Red X */
                              <div className="w-4 h-4 rounded border-2 border-red-400 flex items-center justify-center">
                                <span className="text-red-400 text-xs font-bold">✕</span>
                              </div>
                            ) : (
                              /* Pending - Empty checkbox */
                              <div className="w-4 h-4 rounded border-2 border-muted-foreground/50" />
                            )}
                          </div>

                          {/* Task Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              {/* Agent Logo */}
                              <div className={cn(
                                "transition-opacity",
                                task.status === "completed" && "opacity-50"
                              )}>
                                <AgentLogo agent={task.agent} size="sm" />
                              </div>

                              {/* Agent Name Badge with theme-aware color */}
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

                  {/* Tool Calls Section - Shows both active and completed during streaming */}
                  {(activeToolCalls.length > 0 || completedToolCalls.length > 0) && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="space-y-3 mt-4 pt-4 border-t border-border/30"
                    >
                      {/* Active Tool Calls */}
                      {activeToolCalls.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-amber-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="font-medium">Active Tool Calls</span>
                          </div>
                          <div className="space-y-1.5">
                            {activeToolCalls.map((tool) => (
                              <div
                                key={tool.id}
                                className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-sm"
                              >
                                <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />
                                <span className="text-foreground/90 truncate">
                                  <span className="font-medium text-amber-400">{tool.agent}</span>
                                  <span className="text-foreground/60"> → </span>
                                  <span>{tool.tool}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Completed Tool Calls - Always visible, collapsible after streaming */}
                      {completedToolCalls.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-xs text-green-400">
                            <CheckCircle className="h-3.5 w-3.5" />
                            <span className="font-medium">Completed ({completedToolCalls.length})</span>
                          </div>
                          <div className="space-y-1">
                            {completedToolCalls.map((tool) => (
                              <div
                                key={tool.id}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-500/5 border border-green-500/20 text-sm"
                              >
                                <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />
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

                </>
              ) : activeToolCalls.length > 0 || completedToolCalls.length > 0 ? (
                /* Tool calls without execution plan - shows both active and completed */
                <div className="space-y-4">
                  {/* Active tool calls */}
                  {activeToolCalls.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-2"
                    >
                      <div className="flex items-center gap-2 text-xs text-amber-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span className="font-medium">Active Tool Calls</span>
                      </div>
                      <div className="space-y-1.5">
                        {activeToolCalls.map((tool) => (
                          <div
                            key={tool.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-sm"
                          >
                            <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />
                            <span className="text-foreground/90 truncate">
                              <span className="font-medium text-amber-400">{tool.agent}</span>
                              <span className="text-foreground/60"> → </span>
                              <span>{tool.tool}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Completed tool calls - always visible */}
                  {completedToolCalls.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-2"
                    >
                      <div className="flex items-center gap-2 text-xs text-green-400">
                        <CheckCircle className="h-3.5 w-3.5" />
                        <span className="font-medium">Completed ({completedToolCalls.length})</span>
                      </div>
                      <div className="space-y-1">
                        {completedToolCalls.map((tool) => (
                          <div
                            key={tool.id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-500/5 border border-green-500/20 text-sm"
                          >
                            <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />
                            <span className="text-foreground/70 truncate text-xs">
                              <span className="font-medium text-foreground/80">{tool.agent}</span>
                              <span className="text-foreground/40"> → </span>
                              <span>{tool.tool}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>
              ) : (
                /* Empty state - no tasks and no active tools */
                <div className="text-center py-12">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-sky-500/20 to-purple-500/20 flex items-center justify-center">
                    <ListTodo className="h-6 w-6 text-sky-400" />
                  </div>
                  <p className="text-sm font-medium text-foreground/80">
                    No active tasks
                  </p>
                  <p className="text-xs text-foreground/60 mt-1">
                    Task plans will appear here during execution
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
    </div>
  );
}

// Parse execution plan tasks from A2A events (ONLY from execution_plan artifacts, not tool notifications)
function parseExecutionTasks(events: A2AEvent[]): ExecutionTask[] {
  const tasksMap = new Map<string, ExecutionTask>();

  events.forEach((event) => {
    // ONLY check for execution plan artifacts - NOT tool notifications
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
