"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  ChevronLeft,
  Bot,
  Info,
  Trash2,
  RefreshCw,
  Download,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import { getGradientStyle } from "@/lib/gradient-themes";
import type { SubAgentRef } from "@/types/dynamic-agent";
import { useShallow } from "zustand/react/shallow";
import { useSession } from "next-auth/react";

interface DynamicAgentContextProps {
  /** Conversation ID from route params - used for API calls */
  conversationId?: string;
  agentId?: string;
  agentName?: string;
  agentDescription?: string;
  agentModel?: string;
  agentVisibility?: string;
  /** Agent gradient theme (e.g., "ocean", "sunset") */
  agentGradient?: string | null;
  /** Map of server_id -> tool names (empty array = all tools from server) */
  allowedTools?: Record<string, string[]>;
  /** Configured subagents for delegation */
  subagents?: SubAgentRef[];
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
  /** Whether the agent is disabled */
  agentDisabled?: boolean;
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
}

/**
 * Simplified context panel for Dynamic Agents.
 * Shows agent info only - todos/files are shown in the main chat panel.
 */
export function DynamicAgentContext({
  conversationId,
  agentId,
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  agentGradient,
  allowedTools,
  subagents,
  agentNotFound,
  agentDisabled,
  collapsed = false,
  onCollapse,
}: DynamicAgentContextProps) {
  const { data: session } = useSession();
  const { clearStreamEvents, conversations } = useChatStore(
    useShallow((s) => ({
      clearStreamEvents: s.clearStreamEvents,
      conversations: s.conversations,
    }))
  );

  // Get current conversation for download
  const conversation = conversations.find((c) => c.id === conversationId);

  // Restart runtime handler
  const [isRestarting, setIsRestarting] = useState(false);
  const [runtimeRestarted, setRuntimeRestarted] = useState(false);

  // Download chat handler
  const handleDownloadChat = useCallback(() => {
    if (!conversation) return;

    // Build export object, omitting MongoDB-specific fields
    const exportData = {
      exportedAt: new Date().toISOString(),
      conversationId,
      title: conversation.title,
      agent: {
        id: agentId,
        name: agentName,
        model: agentModel,
        visibility: agentVisibility,
      },
      messages: conversation.messages?.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        streamEvents: m.streamEvents,
        feedback: m.feedback,
        timelineSegments: m.timelineSegments,
      })),
      streamEvents: conversation.streamEvents,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };

    // Create and trigger download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${conversationId?.slice(0, 8)}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [conversation, conversationId, agentId, agentName, agentModel, agentVisibility]);

  const handleRestartRuntime = useCallback(async () => {
    if (!agentId || !conversationId || isRestarting) return;
    
    setIsRestarting(true);
    try {
      const response = await fetch("/api/dynamic-agents/chat/restart-runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        },
        body: JSON.stringify({
          agent_id: agentId,
          session_id: conversationId,
        }),
      });
      
      if (response.ok) {
        // Clear SSE events on restart
        if (conversationId) clearStreamEvents(conversationId);
        // Show restart notification
        setRuntimeRestarted(true);
        // Clear notification after a few seconds
        setTimeout(() => setRuntimeRestarted(false), 5000);
      } else {
        console.error("Failed to restart runtime:", await response.text());
      }
    } catch (error) {
      console.error("Failed to restart runtime:", error);
    } finally {
      setIsRestarting(false);
    }
  }, [agentId, conversationId, session?.accessToken, isRestarting, clearStreamEvents]);

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 340 }}
      transition={{ duration: 0.2 }}
      className="relative h-full flex flex-col bg-card/30 backdrop-blur-sm border-l border-border/50 shrink-0 overflow-hidden"
    >
      {/* Header - only show when expanded */}
      {!collapsed && (
        <div className="border-b border-border/50">
          <div className="flex items-center py-2 justify-between px-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Info className="h-4 w-4 text-blue-400" />
              Agent Info
            </div>

            {onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onCollapse(true)}
                className="h-8 w-8 hover:bg-muted shrink-0"
              >
                <ChevronLeft className="h-4 w-4 rotate-180" />
              </Button>
            )}
          </div>
        </div>
      )}

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

            {/* Runtime Restarted Notification */}
            {runtimeRestarted && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border-2 border-blue-500/60 bg-gradient-to-br from-blue-500/15 to-blue-600/10 p-3 shadow-lg shadow-blue-500/10"
              >
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-full bg-blue-500/20 shrink-0">
                    <RefreshCw className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1.5">
                      Runtime Restarted
                    </p>
                    <p className="text-sm text-blue-300 leading-relaxed">
                      Send a message to create the runtime and reconnect to MCP servers.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            <AgentInfoContent
              agentName={agentName}
              agentDescription={agentDescription}
              agentModel={agentModel}
              agentVisibility={agentVisibility}
              agentGradient={agentGradient}
              allowedTools={allowedTools}
              subagents={subagents}
              agentId={agentId}
              sessionId={conversationId}
              onRestartRuntime={handleRestartRuntime}
              isRestarting={isRestarting}
              agentNotFound={agentNotFound}
              agentDisabled={agentDisabled}
              onDownloadChat={handleDownloadChat}
              hasMessages={!!conversation?.messages?.length}
            />
          </div>
        </ScrollArea>
      )}

      {/* Collapsed state - clickable area to expand */}
      {collapsed && onCollapse && (
        <button
          onClick={() => onCollapse(false)}
          className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
        >
          {/* Small agent avatar */}
          {(() => {
            const gradientStyle = agentGradient ? getGradientStyle(agentGradient) : null;
            return (
              <div 
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  !gradientStyle && "bg-gradient-to-br from-purple-500 to-pink-600"
                )}
                style={gradientStyle || undefined}
              >
                <Bot className="h-4 w-4 text-white" />
              </div>
            );
          })()}
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
    </motion.div>
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
  agentGradient?: string | null;
  allowedTools?: Record<string, string[]>;
  subagents?: SubAgentRef[];
  /** Agent ID for restart runtime */
  agentId?: string;
  /** Session ID for restart runtime */
  sessionId?: string;
  /** Callback to restart the runtime */
  onRestartRuntime?: () => void;
  /** Whether a restart is in progress */
  isRestarting?: boolean;
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
  /** Whether the agent is disabled */
  agentDisabled?: boolean;
  /** Callback to download chat as JSON */
  onDownloadChat?: () => void;
  /** Whether there are messages to download */
  hasMessages?: boolean;
}

function AgentInfoContent({
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  agentGradient,
  allowedTools,
  subagents,
  agentId,
  sessionId,
  onRestartRuntime,
  isRestarting,
  agentNotFound,
  agentDisabled,
  onDownloadChat,
  hasMessages,
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
        {(() => {
          const gradientStyle = agentGradient ? getGradientStyle(agentGradient) : null;
          return (
            <div 
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                !gradientStyle && "bg-gradient-to-br from-purple-500 to-pink-600"
              )}
              style={gradientStyle || undefined}
            >
              <Bot className="h-5 w-5 text-white" />
            </div>
          );
        })()}
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

          {/* Conversation ID */}
          {sessionId && (
            <div className="space-y-0.5 col-span-2">
              <span className="text-xs text-muted-foreground">Conversation ID</span>
              <p className="font-mono text-xs truncate" title={sessionId}>
                {sessionId}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* MCP Server list */}
      {serverCount > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            MCP Servers
          </h4>
          <div className="space-y-1">
            {Object.keys(allowedTools || {}).map((serverId) => (
              <div
                key={serverId}
                className="flex items-center gap-2 text-xs px-2 py-1.5 rounded font-mono bg-muted/30 border border-border/50"
              >
                <span className="truncate">{serverId}</span>
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

      {/* Advanced Section */}
      {agentId && sessionId && onRestartRuntime && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Advanced
          </h4>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRestartRuntime}
              disabled={isRestarting || agentNotFound || agentDisabled}
              className="w-full justify-center gap-2 text-xs"
            >
              {isRestarting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isRestarting ? "Refreshing..." : "Refresh Agent Session"}
            </Button>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              This will refresh the session, checking for any new updates to the agent and refreshing connections to MCP servers. Chat history will not be affected.
            </p>
            
            {/* Download Chat Button */}
            {onDownloadChat && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDownloadChat}
                disabled={!hasMessages}
                className="w-full justify-center gap-2 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                Download Chat
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
