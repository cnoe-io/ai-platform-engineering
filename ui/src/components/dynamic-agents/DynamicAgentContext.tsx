"use client";

import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Wrench,
  Bot,
  Info,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import { A2AEvent } from "@/types/a2a";
import { useShallow } from "zustand/react/shallow";

// Stable empty array to avoid infinite re-render loops in selectors
const EMPTY_EVENTS: A2AEvent[] = [];

// Tool call from events
interface ToolCall {
  id: string;
  tool: string;
  agent?: string;
  status: "running" | "completed";
  startTime?: Date;
  endTime?: Date;
  result?: string;
}

interface DynamicAgentContextProps {
  agentName?: string;
  agentDescription?: string;
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

  // Derive conversation events
  const conversationEvents = useMemo(() => {
    if (!activeConversationId) return EMPTY_EVENTS;
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.a2aEvents || EMPTY_EVENTS;
  }, [activeConversationId, conversations]);

  const [activeTab, setActiveTab] = useState<"tools" | "info">("tools");
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

  // Parse tool calls from events
  const { activeToolCalls, completedToolCalls } = useMemo(() => {
    const allTools = parseToolCalls(conversationEvents);
    if (isActuallyStreaming) {
      return {
        activeToolCalls: allTools.filter((t) => t.status === "running"),
        completedToolCalls: allTools.filter((t) => t.status === "completed"),
      };
    } else {
      const completedTools = allTools.map((t) => ({
        ...t,
        status: "completed" as const,
      }));
      return {
        activeToolCalls: [],
        completedToolCalls: completedTools,
      };
    }
  }, [conversationEvents, isActuallyStreaming]);

  const totalToolCalls = activeToolCalls.length + completedToolCalls.length;

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
                onValueChange={(v) => setActiveTab(v as "tools" | "info")}
              >
                <TabsList className="h-8 bg-muted/50">
                  <TabsTrigger
                    value="tools"
                    className={cn(
                      "text-xs gap-1.5 h-7 px-3",
                      activeTab === "tools" && "text-purple-400"
                    )}
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Tools
                    {totalToolCalls > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1 h-4 px-1 text-[10px] bg-purple-500/20 text-purple-400"
                      >
                        {totalToolCalls}
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
            {activeTab === "tools" && (
              <ToolsContent
                activeToolCalls={activeToolCalls}
                completedToolCalls={completedToolCalls}
                toolsCollapsed={toolsCollapsed}
                onToolsCollapse={setToolsCollapsed}
                isStreaming={isActuallyStreaming}
              />
            )}

            {activeTab === "info" && (
              <AgentInfoContent
                agentName={agentName}
                agentDescription={agentDescription}
              />
            )}
          </div>
        </ScrollArea>
      )}

      {/* Collapsed state indicator */}
      {collapsed && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Wrench className="h-5 w-5" />
          {totalToolCalls > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {totalToolCalls}
            </Badge>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tools Content
// ═══════════════════════════════════════════════════════════════

interface ToolsContentProps {
  activeToolCalls: ToolCall[];
  completedToolCalls: ToolCall[];
  toolsCollapsed: boolean;
  onToolsCollapse: (collapsed: boolean) => void;
  isStreaming: boolean;
}

function ToolsContent({
  activeToolCalls,
  completedToolCalls,
  toolsCollapsed,
  onToolsCollapse,
  isStreaming,
}: ToolsContentProps) {
  if (activeToolCalls.length === 0 && completedToolCalls.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Wrench className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No tool calls yet</p>
        <p className="text-xs mt-1 opacity-70">
          Tools will appear here as the agent uses them
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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

// ═══════════════════════════════════════════════════════════════
// Agent Info Content
// ═══════════════════════════════════════════════════════════════

interface AgentInfoContentProps {
  agentName?: string;
  agentDescription?: string;
}

function AgentInfoContent({ agentName, agentDescription }: AgentInfoContentProps) {
  return (
    <div className="space-y-4">
      {/* Agent header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shrink-0">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{agentName || "Custom Agent"}</h3>
          <p className="text-xs text-muted-foreground">Dynamic Agent</p>
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

      {/* Placeholder for future: system prompt preview, allowed tools, etc */}
      <div className="pt-2 border-t border-border/50">
        <p className="text-xs text-muted-foreground">
          This agent uses custom tools and prompts configured in the Dynamic Agents admin panel.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helper: Parse tool calls from A2A events
// ═══════════════════════════════════════════════════════════════

function parseToolCalls(events: A2AEvent[]): ToolCall[] {
  const toolMap = new Map<string, ToolCall>();

  for (const event of events) {
    const artifactName = event.artifact?.name;
    if (!artifactName) continue;

    if (artifactName === "tool_notification_start") {
      const text = event.artifact?.parts?.[0]?.text || "";
      try {
        const data = JSON.parse(text);
        const toolId = data.call_id || `tool-${Date.now()}`;
        toolMap.set(toolId, {
          id: toolId,
          tool: data.tool_name || "Unknown tool",
          agent: data.agent_name,
          status: "running",
          startTime: event.timestamp,
        });
      } catch {
        // Ignore parse errors
      }
    }

    if (artifactName === "tool_notification_end") {
      const text = event.artifact?.parts?.[0]?.text || "";
      try {
        const data = JSON.parse(text);
        const toolId = data.call_id;
        if (toolId && toolMap.has(toolId)) {
          const existing = toolMap.get(toolId)!;
          toolMap.set(toolId, {
            ...existing,
            status: "completed",
            endTime: event.timestamp,
            result: data.result,
          });
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return Array.from(toolMap.values());
}
