"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { DynamicAgentContext } from "./DynamicAgentContext";
import type { SubAgentRef } from "@/types/dynamic-agent";

interface DynamicAgentChatViewProps {
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
  /** Map of server_id -> tool names */
  allowedTools?: Record<string, string[]>;
  /** Configured subagents */
  subagents?: SubAgentRef[];
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
  /** Whether the chat is read-only */
  readOnly?: boolean;
  /** Reason for read-only mode */
  readOnlyReason?: "admin_audit" | "shared_readonly";
}

/**
 * Chat view for Dynamic Agents.
 * Combines ChatPanel with DynamicAgentContext (simplified tools/info panel).
 */
export function DynamicAgentChatView({
  endpoint,
  conversationId,
  conversationTitle,
  selectedAgentId,
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  allowedTools,
  subagents,
  agentNotFound,
  readOnly,
  readOnlyReason,
}: DynamicAgentChatViewProps) {
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);

  return (
    <div className="flex-1 min-w-0 flex h-full">
      {/* Chat Panel */}
      <motion.div
        key="chat"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex-1 min-w-0 flex flex-col"
      >
        <ChatPanel
          endpoint={endpoint}
          conversationId={conversationId}
          conversationTitle={conversationTitle}
          readOnly={readOnly || agentNotFound}
          readOnlyReason={agentNotFound ? 'agent_deleted' : readOnlyReason}
          selectedAgentId={selectedAgentId}
        />
      </motion.div>

      {/* Context Panel - Dynamic Agent variant */}
      <DynamicAgentContext
        agentId={selectedAgentId}
        agentName={agentName}
        agentDescription={agentDescription}
        agentModel={agentModel}
        agentVisibility={agentVisibility}
        allowedTools={allowedTools}
        subagents={subagents}
        agentNotFound={agentNotFound}
        collapsed={contextPanelCollapsed}
        onCollapse={setContextPanelCollapsed}
      />
    </div>
  );
}
