"use client";

import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio,
  Bug,
  Loader2,
  ListTodo,
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
  const { a2aEvents, isStreaming } = useChatStore();
  // Default to tasks tab, switch to debug if debug mode is enabled
  const [activeTab, setActiveTab] = useState<"tasks" | "debug">(debugMode ? "debug" : "tasks");

  // Parse execution plan tasks from A2A events
  const executionTasks = useMemo(() => {
    return parseExecutionTasks(a2aEvents);
  }, [a2aEvents]);

  // Sync tab with debug mode
  useEffect(() => {
    if (debugMode) {
      setActiveTab("debug");
    }
  }, [debugMode]);


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
          /* Tasks Tab - Execution Plan (Default) */
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
                            <div className="flex items-center gap-2 mb-1.5">
                              {/* Agent Logo */}
                              <AgentLogo agent={task.agent} size="sm" />

                              {/* Agent Name Badge with official color */}
                              {(() => {
                                const agentLogo = getAgentLogo(task.agent);
                                return (
                                  <span
                                    className={cn(
                                      "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                                      task.status === "completed" && "opacity-60"
                                    )}
                                    style={{
                                      backgroundColor: agentLogo ? `${agentLogo.color}20` : 'var(--muted)',
                                      color: agentLogo?.color || 'var(--muted-foreground)',
                                    }}
                                  >
                                    {agentLogo?.displayName || task.agent}
                                  </span>
                                );
                              })()}
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
        ) : (
          /* A2A Debug Tab - Full Event Stream */
          <A2AStreamPanel />
        )}
      </div>
    </div>
  );
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
