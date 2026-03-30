"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  ChevronLeft,
  Bot,
  Info,
  Trash2,
  RefreshCw,
  Download,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
} from "lucide-react";
import { SandboxPolicyPanel } from "./SandboxPolicyPanel";
import { SandboxRequestStream } from "./SandboxRequestStream";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import { getGradientStyle } from "@/lib/gradient-themes";
import type { SubAgentRef } from "@/types/dynamic-agent";
import type { SandboxDenialData } from "./sse-types";
import { useShallow } from "zustand/react/shallow";
import { useSession } from "next-auth/react";

type SandboxPhase = "not_found" | "pending" | "ready" | "error" | "unknown";

interface SandboxStatus {
  sandbox_enabled: boolean;
  sandbox_name?: string;
  provisioned?: boolean;
  phase?: SandboxPhase;
  connected?: boolean;
  watcher_active?: boolean;
  policy_loaded?: boolean;
  policy_status?: string;
  policy_error?: string;
  sandbox_error?: string;
}

function useSandboxStatus(agentId: string | undefined, enabled: boolean) {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!agentId || !enabled) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dynamic-agents/sandbox/status/${agentId}`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setStatus({
          sandbox_enabled: true,
          phase: "error",
          sandbox_error: `Status check failed (HTTP ${res.status})`,
        });
      }
    } catch (err) {
      setStatus({
        sandbox_enabled: true,
        phase: "error",
        sandbox_error:
          err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setLoading(false);
    }
  }, [agentId, enabled]);

  useEffect(() => {
    if (!enabled || !agentId) return;
    refresh();

    const phase = status?.phase;
    if (phase === "ready") return; // stop polling once ready

    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [agentId, enabled, refresh, status?.phase]);

  return { status, loading, refresh };
}

function SandboxStatusBadge({ status }: { status: SandboxStatus | null }) {
  if (!status || !status.sandbox_enabled) return null;

  const phase = status.phase ?? "unknown";
  const policyFailed =
    status.policy_status === "failed" || !!status.policy_error;

  if (phase === "ready" && policyFailed) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs text-amber-500">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>Sandbox Ready — Policy Failed</span>
        </div>
        {status.policy_error && (
          <span className="text-[10px] text-red-400 ml-5 leading-tight">
            {status.policy_error}
          </span>
        )}
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Sandbox Ready</span>
      </div>
    );
  }

  if (phase === "pending" || phase === "not_found") {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs text-amber-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Sandbox Provisioning...</span>
        </div>
        {status.sandbox_error && (
          <span className="text-[10px] text-red-400 ml-5 leading-tight">
            {status.sandbox_error}
          </span>
        )}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs text-red-500">
          <ShieldX className="h-3.5 w-3.5" />
          <span>Sandbox Error</span>
        </div>
        {(status.sandbox_error || status.policy_error) && (
          <span className="text-[10px] text-red-400 ml-5 leading-tight">
            {status.sandbox_error || status.policy_error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ShieldAlert className="h-3.5 w-3.5" />
      <span>Sandbox Unknown</span>
    </div>
  );
}

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
  /** Whether sandbox is enabled for this agent */
  sandboxEnabled?: boolean;
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
  sandboxEnabled,
  agentNotFound,
  agentDisabled,
  collapsed = false,
  onCollapse,
}: DynamicAgentContextProps) {
  const { data: session } = useSession();
  const { clearSSEEvents, conversations } = useChatStore(
    useShallow((s) => ({
      clearSSEEvents: s.clearSSEEvents,
      conversations: s.conversations,
    }))
  );

  const { status: sandboxStatus } = useSandboxStatus(agentId, !!sandboxEnabled);

  // Get current conversation for download
  const conversation = conversations.find((c) => c.id === conversationId);

  // Extract sandbox denial events from the current conversation's SSE stream
  const sandboxDenials: SandboxDenialData[] = React.useMemo(() => {
    if (!sandboxEnabled || !conversation?.sseEvents) return [];
    return conversation.sseEvents
      .filter((e) => e.type === "sandbox_denial" && e.sandboxDenialData)
      .map((e) => e.sandboxDenialData!);
  }, [sandboxEnabled, conversation?.sseEvents]);

  // Count policy update events to trigger panel refresh
  const policyRefreshTrigger = React.useMemo(() => {
    if (!sandboxEnabled || !conversation?.sseEvents) return 0;
    return conversation.sseEvents.filter((e) => e.type === "sandbox_policy_update").length;
  }, [sandboxEnabled, conversation?.sseEvents]);

  // Allow a denied host/port by adding a rule to the sandbox policy
  const [allowRuleError, setAllowRuleError] = useState<string | null>(null);
  const handleAllowRule = useCallback(
    async (host: string, port: number, temporary: boolean) => {
      if (!agentId) return;
      setAllowRuleError(null);
      try {
        const res = await fetch(
          `/api/dynamic-agents/sandbox/policy/${agentId}/allow-rule`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host, port, temporary }),
          }
        );
        if (!res.ok) {
          const body = await res.text();
          setAllowRuleError(`Failed to add rule: ${body}`);
        } else {
          const data = await res.json();
          if (!data.success) {
            setAllowRuleError(
              data.error || "Policy update failed — check sandbox status"
            );
          }
        }
      } catch (err) {
        setAllowRuleError(
          err instanceof Error ? err.message : "Network error"
        );
      }
    },
    [agentId]
  );

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
        sseEvents: m.sseEvents,
        feedback: m.feedback,
        timelineSegments: m.timelineSegments,
      })),
      sseEvents: conversation.sseEvents,
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

  const [activeTab, setActiveTab] = useState<"info" | "sandbox">(
    sandboxEnabled ? "sandbox" : "info"
  );

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
        if (conversationId) clearSSEEvents(conversationId);
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
  }, [agentId, conversationId, session?.accessToken, isRestarting, clearSSEEvents]);

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
            {sandboxEnabled ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab("info")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                    activeTab === "info"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Info className="h-3.5 w-3.5" />
                  Info
                </button>
                <button
                  onClick={() => setActiveTab("sandbox")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                    activeTab === "sandbox"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Sandbox
                  {sandboxDenials.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-destructive/20 text-destructive">
                      {sandboxDenials.length}
                    </span>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Info className="h-4 w-4 text-blue-400" />
                Agent Info
              </div>
            )}

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
            {/* ── Shared notifications (visible in both tabs) ── */}
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

            {/* ── INFO TAB ── */}
            {activeTab === "info" && (
              <>
                {/* Sandbox provisioning banner (also on info tab) */}
                {sandboxEnabled && sandboxStatus && sandboxStatus.phase !== "ready" && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "rounded-lg border-2 p-3 shadow-lg",
                      sandboxStatus.phase === "error"
                        ? "border-red-500/60 bg-gradient-to-br from-red-500/15 to-red-600/10 shadow-red-500/10"
                        : "border-blue-500/60 bg-gradient-to-br from-blue-500/15 to-blue-600/10 shadow-blue-500/10"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {sandboxStatus.phase === "error" ? (
                        <div className="p-1.5 rounded-full bg-red-500/20 shrink-0">
                          <ShieldX className="h-4 w-4 text-red-500" />
                        </div>
                      ) : (
                        <div className="p-1.5 rounded-full bg-blue-500/20 shrink-0">
                          <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-xs font-semibold uppercase tracking-wide mb-1",
                          sandboxStatus.phase === "error" ? "text-red-500" : "text-blue-500"
                        )}>
                          {sandboxStatus.phase === "error"
                            ? "Sandbox Error"
                            : "Sandbox Provisioning"}
                        </p>
                        <p className={cn(
                          "text-xs leading-relaxed",
                          sandboxStatus.phase === "error" ? "text-red-300" : "text-blue-300"
                        )}>
                          {sandboxStatus.phase === "error"
                            ? "The sandbox failed to start. Try restarting the agent session."
                            : "Setting up the isolated sandbox environment. Chat will be available once ready."}
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
                  sandboxStatus={sandboxStatus}
                />
              </>
            )}

            {/* ── SANDBOX TAB ── */}
            {activeTab === "sandbox" && sandboxEnabled && agentId && (
              <>
                {/* Sandbox provisioning status */}
                {sandboxStatus && sandboxStatus.phase !== "ready" && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "rounded-lg border-2 p-3 shadow-lg",
                      sandboxStatus.phase === "error"
                        ? "border-red-500/60 bg-gradient-to-br from-red-500/15 to-red-600/10 shadow-red-500/10"
                        : "border-blue-500/60 bg-gradient-to-br from-blue-500/15 to-blue-600/10 shadow-blue-500/10"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {sandboxStatus.phase === "error" ? (
                        <div className="p-1.5 rounded-full bg-red-500/20 shrink-0">
                          <ShieldX className="h-4 w-4 text-red-500" />
                        </div>
                      ) : (
                        <div className="p-1.5 rounded-full bg-blue-500/20 shrink-0">
                          <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-xs font-semibold uppercase tracking-wide mb-1",
                          sandboxStatus.phase === "error" ? "text-red-500" : "text-blue-500"
                        )}>
                          {sandboxStatus.phase === "error"
                            ? "Sandbox Error"
                            : "Sandbox Provisioning"}
                        </p>
                        <p className={cn(
                          "text-xs leading-relaxed",
                          sandboxStatus.phase === "error" ? "text-red-300" : "text-blue-300"
                        )}>
                          {sandboxStatus.phase === "error"
                            ? "The sandbox failed to start. Try restarting the agent session."
                            : "Setting up the isolated sandbox environment…"}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Policy rule error banner */}
                {allowRuleError && (
                  <div className="mx-3 p-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-start gap-2">
                    <ShieldX className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <span>{allowRuleError}</span>
                      <button
                        className="ml-2 underline hover:text-red-300"
                        onClick={() => setAllowRuleError(null)}
                      >
                        dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Full sandbox policy panel with editor + denials */}
                <SandboxPolicyPanel
                  agentId={agentId}
                  denials={sandboxDenials}
                  onAllowRule={handleAllowRule}
                  refreshTrigger={policyRefreshTrigger}
                />

                {/* Live OpenShell request stream */}
                {conversation?.sseEvents && conversation.sseEvents.length > 0 && (
                  <SandboxRequestStream
                    events={conversation.sseEvents}
                  />
                )}
              </>
            )}
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
  agentId?: string;
  sessionId?: string;
  onRestartRuntime?: () => void;
  isRestarting?: boolean;
  agentNotFound?: boolean;
  agentDisabled?: boolean;
  onDownloadChat?: () => void;
  hasMessages?: boolean;
  sandboxStatus?: SandboxStatus | null;
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
  sandboxStatus,
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

          {/* Sandbox Status */}
          {sandboxStatus?.sandbox_enabled && (
            <div className="space-y-0.5 col-span-2">
              <span className="text-xs text-muted-foreground">Sandbox</span>
              <SandboxStatusBadge status={sandboxStatus} />
            </div>
          )}

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
