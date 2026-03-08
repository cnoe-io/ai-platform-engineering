"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Bot,
  Info,
  Users,
  ListTodo,
  Activity,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import {
  SSEAgentEvent,
  EMPTY_SSE_EVENTS,
} from "./sse-types";
import type { SubAgentRef } from "@/types/dynamic-agent";
import { useShallow } from "zustand/react/shallow";

// Tool call from events
interface ToolCall {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  agent?: string;
  status: "running" | "completed";
  isBuiltin: boolean;
}

// Subagent call from events
interface SubagentCall {
  id: string;
  name: string;
  purpose?: string;
  parentAgent?: string;
  status: "running" | "completed";
}

// Todo item from todo_update events
interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface DynamicAgentContextProps {
  agentName?: string;
  agentDescription?: string;
  agentModel?: string;
  agentVisibility?: string;
  /** Map of server_id -> tool names (empty array = all tools from server) */
  allowedTools?: Record<string, string[]>;
  /** Configured subagents for delegation */
  subagents?: SubAgentRef[];
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
}

/**
 * Simplified context panel for Dynamic Agents.
 * Shows tool calls and agent info - no A2A debug panel.
 */
export function DynamicAgentContext({
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  allowedTools,
  subagents,
  agentNotFound,
  collapsed = false,
  onCollapse,
}: DynamicAgentContextProps) {
  const { isStreaming, activeConversationId } = useChatStore(
    useShallow((s) => ({
      isStreaming: s.isStreaming,
      activeConversationId: s.activeConversationId,
    }))
  );

  const conversations = useChatStore((s) => s.conversations);

  // Derive conversation SSE events (Dynamic Agents use sseEvents, not a2aEvents)
  const conversationEvents = useMemo(() => {
    if (!activeConversationId) return EMPTY_SSE_EVENTS;
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.sseEvents || EMPTY_SSE_EVENTS;
  }, [activeConversationId, conversations]);

  const [activeTab, setActiveTab] = useState<"events" | "info">("events");
  const [toolsCollapsed, setToolsCollapsed] = useState(false);

  // Check if streaming is active
  const conversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [activeConversationId, conversations]);

  const isActuallyStreaming = useMemo(() => {
    if (!isStreaming) return false;
    if (!conversation) return false;
    return true;
  }, [isStreaming, conversation]);

  // Parse tool calls from structured events
  const { activeToolCalls, completedToolCalls, builtinToolCalls } = useMemo(() => {
    const allTools = parseToolCalls(conversationEvents);
    const builtinTools = allTools.filter((t) => t.isBuiltin);
    const regularTools = allTools.filter((t) => !t.isBuiltin);
    
    if (isActuallyStreaming) {
      return {
        activeToolCalls: regularTools.filter((t) => t.status === "running"),
        completedToolCalls: regularTools.filter((t) => t.status === "completed"),
        builtinToolCalls: builtinTools,
      };
    } else {
      const completedTools = regularTools.map((t) => ({
        ...t,
        status: "completed" as const,
      }));
      return {
        activeToolCalls: [],
        completedToolCalls: completedTools,
        builtinToolCalls: builtinTools,
      };
    }
  }, [conversationEvents, isActuallyStreaming]);

  // Parse subagent calls from structured events
  const { activeSubagentCalls, completedSubagentCalls } = useMemo(() => {
    const allSubagents = parseSubagentCalls(conversationEvents);
    if (isActuallyStreaming) {
      return {
        activeSubagentCalls: allSubagents.filter((s) => s.status === "running"),
        completedSubagentCalls: allSubagents.filter((s) => s.status === "completed"),
      };
    } else {
      const completedSubagents = allSubagents.map((s) => ({
        ...s,
        status: "completed" as const,
      }));
      return {
        activeSubagentCalls: [],
        completedSubagentCalls: completedSubagents,
      };
    }
  }, [conversationEvents, isActuallyStreaming]);

  // Parse todos from structured events (replaces execution plan)
  const hasFinalResult = useMemo(() => {
    return conversationEvents.some((e) => e.type === "final_result");
  }, [conversationEvents]);

  const todos = useMemo(() => {
    const parsedTodos = parseTodos(conversationEvents);
    // Only force-mark as completed when the agent finished (final_result received)
    if (!isActuallyStreaming && hasFinalResult && parsedTodos.length > 0) {
      return parsedTodos.map((todo) => ({
        ...todo,
        status: "completed" as const,
      }));
    }
    return parsedTodos;
  }, [conversationEvents, isActuallyStreaming, hasFinalResult]);

  // Extract error messages from error events
  const errorMessages = useMemo(() => {
    return conversationEvents
      .filter((e) => e.type === "error")
      .map((e) => e.displayContent || e.content || "An unknown error occurred");
  }, [conversationEvents]);

  const totalToolCalls = activeToolCalls.length + completedToolCalls.length;
  const totalSubagentCalls = activeSubagentCalls.length + completedSubagentCalls.length;
  const totalActivityCount = totalToolCalls + totalSubagentCalls + todos.length;

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 340 }}
      transition={{ duration: 0.2 }}
      className="relative h-full flex flex-col bg-card/30 backdrop-blur-sm border-l border-border/50 shrink-0 overflow-hidden"
    >
      {/* Header */}
      <div className="border-b border-border/50">
        <div
          className={cn(
            "flex items-center py-2",
            collapsed ? "justify-center px-2" : "justify-between px-3"
          )}
        >
          {collapsed ? (
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
                onValueChange={(v) => setActiveTab(v as "events" | "info")}
              >
                <TabsList className="h-8 bg-muted/50">
                  <TabsTrigger
                    value="events"
                    className={cn(
                      "text-xs gap-1.5 h-7 px-3",
                      activeTab === "events" && "text-purple-400"
                    )}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Events
                    {totalActivityCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1 h-4 px-1 text-[10px] bg-purple-500/20 text-purple-400"
                      >
                        {totalActivityCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="info"
                    className={cn(
                      "text-xs gap-1.5 h-7 px-3",
                      activeTab === "info" && "text-blue-400"
                    )}
                  >
                    <Info className="h-3.5 w-3.5" />
                    Agent
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {onCollapse && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onCollapse(!collapsed)}
                  className="h-8 w-8 hover:bg-muted shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4">
            {/* Agent Not Found Warning */}
            {agentNotFound && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border-2 border-amber-500/60 bg-gradient-to-br from-amber-500/15 to-orange-600/10 p-4 shadow-lg shadow-amber-500/10"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-full bg-amber-500/20 shrink-0">
                    <Trash2 className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-400 mb-1">
                      Agent No Longer Exists
                    </p>
                    <p className="text-xs text-amber-300/80 leading-relaxed">
                      This agent has been deleted. You can view the conversation history, but new messages cannot be sent.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "events" && (
              <EventsContent
                todos={todos}
                activeToolCalls={activeToolCalls}
                completedToolCalls={completedToolCalls}
                builtinToolCalls={builtinToolCalls}
                activeSubagentCalls={activeSubagentCalls}
                completedSubagentCalls={completedSubagentCalls}
                toolsCollapsed={toolsCollapsed}
                onToolsCollapse={setToolsCollapsed}
                isStreaming={isActuallyStreaming}
                errorMessages={errorMessages}
              />
            )}

            {activeTab === "info" && (
              <AgentInfoContent
                agentName={agentName}
                agentDescription={agentDescription}
                agentModel={agentModel}
                agentVisibility={agentVisibility}
                allowedTools={allowedTools}
                subagents={subagents}
              />
            )}
          </div>
        </ScrollArea>
      )}

      {/* Collapsed state indicator */}
      {collapsed && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Activity className="h-5 w-5" />
          {totalActivityCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {totalActivityCount}
            </Badge>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Events Content
// ═══════════════════════════════════════════════════════════════

interface EventsContentProps {
  todos: TodoItem[];
  activeToolCalls: ToolCall[];
  completedToolCalls: ToolCall[];
  builtinToolCalls: ToolCall[];
  activeSubagentCalls: SubagentCall[];
  completedSubagentCalls: SubagentCall[];
  toolsCollapsed: boolean;
  onToolsCollapse: (collapsed: boolean) => void;
  isStreaming: boolean;
  errorMessages: string[];
}

function EventsContent({
  todos,
  activeToolCalls,
  completedToolCalls,
  builtinToolCalls,
  activeSubagentCalls,
  completedSubagentCalls,
  toolsCollapsed,
  onToolsCollapse,
  isStreaming,
  errorMessages,
}: EventsContentProps) {
  const [subagentsCollapsed, setSubagentsCollapsed] = useState(false);

  const hasNoActivity =
    todos.length === 0 &&
    activeToolCalls.length === 0 &&
    completedToolCalls.length === 0 &&
    builtinToolCalls.length === 0 &&
    activeSubagentCalls.length === 0 &&
    completedSubagentCalls.length === 0 &&
    errorMessages.length === 0;

  if (hasNoActivity) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No events yet</p>
        <p className="text-xs mt-1 opacity-70">
          Events will appear here as the agent runs
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Messages */}
      {errorMessages.length > 0 && (
        <div className="space-y-2">
          {errorMessages.map((message, idx) => (
            <motion.div
              key={`error-${idx}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border-2 border-red-500/60 bg-gradient-to-br from-red-500/15 to-red-600/10 p-3 shadow-lg shadow-red-500/10"
            >
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-full bg-red-500/20 shrink-0">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1.5">
                    Agent Error
                  </p>
                  <p className="text-sm text-red-300 leading-relaxed break-words">
                    {message}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Todos (replaces Execution Plan) */}
      {todos.length > 0 && (
        <div className="space-y-2">
          {/* Progress Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-foreground">
              <ListTodo className="h-4 w-4 text-sky-400 shrink-0" />
              <span className="font-medium whitespace-nowrap">Tasks</span>
            </div>
            <span className="text-xs font-medium text-foreground/80 whitespace-nowrap">
              {todos.filter((t) => t.status === "completed").length}/{todos.length}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{
                width: `${(todos.filter((t) => t.status === "completed").length / todos.length) * 100}%`,
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full"
            />
          </div>

          {/* Todo Items */}
          <div className="space-y-1.5">
            <AnimatePresence mode="popLayout">
              {todos.map((todo, idx) => (
                <motion.div
                  key={todo.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-lg border text-xs transition-all",
                    todo.status === "completed" && "bg-emerald-500/10 border-emerald-500/30",
                    todo.status === "in_progress" && "bg-sky-500/10 border-sky-500/30",
                    todo.status === "pending" && "bg-muted/30 border-border/50",
                  )}
                >
                  {/* Status Indicator */}
                  <div className="mt-0.5 shrink-0">
                    {todo.status === "completed" ? (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    ) : todo.status === "in_progress" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/40" />
                    )}
                  </div>

                  {/* Todo Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "leading-relaxed line-clamp-2",
                        todo.status === "completed" && "text-muted-foreground line-through opacity-60",
                        todo.status === "in_progress" && "text-foreground font-medium",
                        todo.status === "pending" && "text-foreground/80",
                      )}
                    >
                      {todo.content}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Builtin tool calls - compact inline chips */}
      {builtinToolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {builtinToolCalls.map((tool) => (
            <span
              key={tool.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tool.status === "completed" ? (
                <CheckCircle className="h-2.5 w-2.5 text-green-400" />
              ) : (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              )}
              {tool.tool}
            </span>
          ))}
        </div>
      )}

      {/* Active subagent calls */}
      {activeSubagentCalls.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
            <Users className="h-3 w-3 text-blue-400" />
            <span>Running Subagents ({activeSubagentCalls.length})</span>
          </div>
          {activeSubagentCalls.map((subagent) => (
            <SubagentCard key={subagent.id} subagent={subagent} />
          ))}
        </div>
      )}

      {/* Completed subagent calls */}
      {completedSubagentCalls.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setSubagentsCollapsed(!subagentsCollapsed)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <CheckCircle className="h-3 w-3 text-blue-400" />
            <Users className="h-3 w-3 text-blue-400" />
            <span>Completed Subagents ({completedSubagentCalls.length})</span>
            {subagentsCollapsed ? (
              <ChevronDown className="h-3 w-3 ml-auto" />
            ) : (
              <ChevronUp className="h-3 w-3 ml-auto" />
            )}
          </button>
          {!subagentsCollapsed &&
            completedSubagentCalls.map((subagent) => (
              <SubagentCard key={subagent.id} subagent={subagent} />
            ))}
        </div>
      )}

      {/* Active tool calls */}
      {activeToolCalls.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
            <span>Running ({activeToolCalls.length})</span>
          </div>
          {activeToolCalls.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Completed tool calls */}
      {completedToolCalls.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => onToolsCollapse(!toolsCollapsed)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <CheckCircle className="h-3 w-3 text-green-400" />
            <span>Completed ({completedToolCalls.length})</span>
            {toolsCollapsed ? (
              <ChevronDown className="h-3 w-3 ml-auto" />
            ) : (
              <ChevronUp className="h-3 w-3 ml-auto" />
            )}
          </button>
          {!toolsCollapsed &&
            completedToolCalls.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
        </div>
      )}
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolCall }) {
  const isRunning = tool.status === "running";

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-sm",
        isRunning
          ? "border-purple-500/30 bg-purple-500/5"
          : "border-border/50 bg-muted/30"
      )}
    >
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400 shrink-0" />
        ) : (
          <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
        )}
        <span className="font-medium truncate">{tool.tool}</span>
      </div>
      {tool.agent && (
        <div className="text-xs text-muted-foreground mt-1 pl-5.5">
          via {tool.agent}
        </div>
      )}
    </div>
  );
}

function SubagentCard({ subagent }: { subagent: SubagentCall }) {
  const isRunning = subagent.status === "running";

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-sm",
        isRunning
          ? "border-blue-500/30 bg-blue-500/5"
          : "border-border/50 bg-muted/30",
      )}
    >
      {/* Subagent header */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0" />
        ) : (
          <CheckCircle className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        )}
        <Bot className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="font-medium truncate">{subagent.name}</span>
      </div>

      {/* Purpose - why this subagent was called */}
      {subagent.purpose && (
        <div className="text-xs text-muted-foreground mt-1.5 pl-6 line-clamp-2">
          {subagent.purpose}
        </div>
      )}

      {/* Parent agent info */}
      {subagent.parentAgent && (
        <div className="text-[10px] text-muted-foreground mt-1 pl-6">
          via {subagent.parentAgent}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Agent Info Content
// ═══════════════════════════════════════════════════════════════

interface AgentInfoContentProps {
  agentName?: string;
  agentDescription?: string;
  agentModel?: string;
  agentVisibility?: string;
  allowedTools?: Record<string, string[]>;
  subagents?: SubAgentRef[];
}

function AgentInfoContent({
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  allowedTools,
  subagents,
}: AgentInfoContentProps) {
  // Count total tools across all MCP servers
  const toolCount = allowedTools
    ? Object.entries(allowedTools).reduce((sum, [, tools]) => {
        // Empty array means "all tools" from that server
        return sum + (tools.length > 0 ? tools.length : 1);
      }, 0)
    : 0;

  const serverCount = allowedTools ? Object.keys(allowedTools).length : 0;

  // Format visibility for display
  const visibilityDisplay = agentVisibility
    ? agentVisibility.charAt(0).toUpperCase() + agentVisibility.slice(1)
    : "Private";

  return (
    <div className="space-y-4">
      {/* Agent header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shrink-0">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{agentName || "Custom Agent"}</h3>
          <p className="text-xs text-muted-foreground">Custom Agent</p>
        </div>
      </div>

      {/* Description */}
      {agentDescription && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Description
          </h4>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {agentDescription}
          </p>
        </div>
      )}

      {/* Agent details */}
      <div className="space-y-2 pt-2 border-t border-border/50">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Configuration
        </h4>

        <div className="grid grid-cols-2 gap-2 text-sm">
          {/* Model */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">Model</span>
            <p className="font-medium truncate" title={agentModel || "Default"}>
              {agentModel || "Default"}
            </p>
          </div>

          {/* Visibility */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">Visibility</span>
            <p className="font-medium">{visibilityDisplay}</p>
          </div>

          {/* MCP Servers */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">MCP Servers</span>
            <p className="font-medium">{serverCount}</p>
          </div>

          {/* Tools */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">Tools</span>
            <p className="font-medium">
              {serverCount > 0
                ? toolCount > 0
                  ? `${toolCount}+`
                  : "All"
                : "None"}
            </p>
          </div>
        </div>
      </div>

      {/* MCP Server list */}
      {serverCount > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Connected MCP Servers
          </h4>
          <div className="space-y-1">
            {Object.keys(allowedTools || {}).map((serverId) => (
              <div
                key={serverId}
                className="text-xs px-2 py-1 rounded bg-muted/50 font-mono truncate"
                title={serverId}
              >
                {serverId}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Configured Subagents */}
      {subagents && subagents.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Configured Subagents
          </h4>
          <div className="space-y-1.5">
            {subagents.map((subagent) => (
              <div
                key={subagent.agent_id}
                className="rounded-lg border border-border/50 bg-muted/30 p-2"
              >
                <div className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span className="text-xs font-medium truncate" title={subagent.name}>
                    {subagent.name}
                  </span>
                </div>
                {subagent.description && (
                  <p className="text-[10px] text-muted-foreground mt-1 pl-5.5 line-clamp-2">
                    {subagent.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helper: Parse todos from SSE events (uses structured todoData)
// ═══════════════════════════════════════════════════════════════

function parseTodos(events: SSEAgentEvent[]): TodoItem[] {
  // Get the latest todo_update event (it contains the full todo list)
  const todoEvents = events.filter((e) => e.type === "todo_update" && e.todoData);
  if (todoEvents.length === 0) return [];

  const latestTodoEvent = todoEvents[todoEvents.length - 1];
  const todos = latestTodoEvent.todoData?.todos || [];

  return todos.map((todo, idx) => ({
    id: `todo-${idx}`,
    content: todo.content,
    status: todo.status,
  }));
}

// ═══════════════════════════════════════════════════════════════
// Helper: Parse tool calls from SSE events (uses structured toolData)
// ═══════════════════════════════════════════════════════════════

function parseToolCalls(events: SSEAgentEvent[]): ToolCall[] {
  const toolsMap = new Map<string, ToolCall>();

  events.forEach((event) => {
    if (event.type === "tool_start" && event.toolData) {
      const { tool_name, tool_call_id, args, agent, is_builtin } = event.toolData;
      toolsMap.set(tool_call_id, {
        id: tool_call_id,
        tool: tool_name,
        args,
        agent,
        status: "running",
        isBuiltin: is_builtin,
      });
    }

    if (event.type === "tool_end" && event.toolData) {
      const { tool_call_id } = event.toolData;
      const tool = toolsMap.get(tool_call_id);
      if (tool) {
        tool.status = "completed";
      }
    }
  });

  return Array.from(toolsMap.values());
}

// ═══════════════════════════════════════════════════════════════
// Helper: Parse subagent calls from SSE events (uses structured subagentData)
// ═══════════════════════════════════════════════════════════════

function parseSubagentCalls(events: SSEAgentEvent[]): SubagentCall[] {
  const subagentsMap = new Map<string, SubagentCall>();

  events.forEach((event, idx) => {
    if (event.type === "subagent_start" && event.subagentData) {
      const { subagent_name, purpose, parent_agent } = event.subagentData;
      const subagentId = `subagent-${event.id || idx}`;
      subagentsMap.set(subagent_name, {
        id: subagentId,
        name: subagent_name,
        purpose,
        parentAgent: parent_agent,
        status: "running",
      });
    }

    if (event.type === "subagent_end" && event.subagentData) {
      const { subagent_name } = event.subagentData;
      const subagent = subagentsMap.get(subagent_name);
      if (subagent) {
        subagent.status = "completed";
      }
    }
  });

  return Array.from(subagentsMap.values());
}
