"use client";

import React, { useState } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { DynamicAgentContext } from "../dynamic-agents/DynamicAgentContext";
import type { SubAgentRef } from "@/types/dynamic-agent";

interface ChatViewProps {
  /** The dynamic agent backend endpoint */
  endpoint: string;
  /** MongoDB conversation UUID */
  conversationId: string;
  /** Conversation title for display */
  conversationTitle?: string;
  /** The selected dynamic agent ID */
  selectedAgentId: string;
  /** Agent name for display in context panel */
  agentName?: string;
  /** Agent description for display in context panel */
  agentDescription?: string;
  /** Agent model ID */
  agentModel?: string;
  /** Agent visibility (private, team, global) */
  agentVisibility?: string;
  /** Agent gradient theme (e.g., "ocean", "sunset") */
  agentGradient?: string | null;
  /** Map of server_id -> tool names */
  allowedTools?: Record<string, string[]>;
  /** Configured subagents */
  subagents?: SubAgentRef[];
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
  /** Whether the agent is disabled */
  agentDisabled?: boolean;
  /** Whether the chat is read-only */
  readOnly?: boolean;
  /** Reason for read-only mode */
  readOnlyReason?: "admin_audit" | "shared_readonly";
  /** Which admin tab the user navigated from */
  adminOrigin?: "audit-logs" | "feedback" | null;
  /** Whether messages are still loading (show skeleton) */
  isLoadingMessages?: boolean;
}

/**
 * Chat view for Dynamic Agents.
 * Combines ChatPanel with DynamicAgentContext (simplified tools/info panel).
 */
export function ChatView({
  endpoint,
  conversationId,
  conversationTitle,
  selectedAgentId,
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  agentGradient,
  allowedTools,
  subagents,
  agentNotFound,
  agentDisabled,
  readOnly,
  readOnlyReason,
  adminOrigin,
  isLoadingMessages,
}: ChatViewProps) {
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(true);

  return (
    <div className="flex-1 min-w-0 flex h-full">
      {/* Chat Panel - no fade animation to avoid flash on conversation switch */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <ChatPanel
          endpoint={endpoint}
          conversationId={conversationId}
          conversationTitle={conversationTitle}
          readOnly={readOnly || agentNotFound || agentDisabled}
          readOnlyReason={agentNotFound ? 'agent_deleted' : agentDisabled ? 'agent_disabled' : readOnlyReason}
          agentId={selectedAgentId}
          agentGradient={agentGradient}
          agentName={agentName}
          isLoadingMessages={isLoadingMessages}
        />
      </div>

      {/* Context Panel - Dynamic Agent variant */}
      <DynamicAgentContext
        conversationId={conversationId}
        agentId={selectedAgentId}
        agentName={agentName}
        agentDescription={agentDescription}
        agentModel={agentModel}
        agentVisibility={agentVisibility}
        agentGradient={agentGradient}
        allowedTools={allowedTools}
        subagents={subagents}
        agentNotFound={agentNotFound}
        agentDisabled={agentDisabled}
        collapsed={contextPanelCollapsed}
        onCollapse={setContextPanelCollapsed}
      />
    </div>
  );
}
