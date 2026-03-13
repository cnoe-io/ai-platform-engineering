"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContextPanel } from "@/components/a2a/ContextPanel";

interface PlatformEngineerChatViewProps {
  /** The Platform Engineer (supervisor) backend endpoint */
  endpoint: string;
  /** MongoDB conversation UUID */
  conversationId: string;
  /** Conversation title for display */
  conversationTitle?: string;
  /** Whether the chat is read-only */
  readOnly?: boolean;
  /** Reason for read-only mode */
  readOnlyReason?: "admin_audit" | "shared_readonly";
  /** Whether to show the context panel */
  contextPanelVisible?: boolean;
}

/**
 * Chat view for Platform Engineer (Supervisor).
 * Combines ChatPanel with full ContextPanel (A2A debug, execution plan, tasks).
 */
export function PlatformEngineerChatView({
  endpoint,
  conversationId,
  conversationTitle,
  readOnly,
  readOnlyReason,
  contextPanelVisible = true,
}: PlatformEngineerChatViewProps) {
  const [debugMode, setDebugMode] = useState(false);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);

  return (
    <div className="flex-1 min-w-0 flex h-full">
      {/* Chat Panel */}
      <motion.div
        key="chat"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex-1 min-w-0 flex flex-col overflow-hidden"
      >
        <ChatPanel
          endpoint={endpoint}
          conversationId={conversationId}
          conversationTitle={conversationTitle}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          // No selectedAgentId = Platform Engineer (default)
        />
      </motion.div>

      {/* Context Panel - Full A2A variant */}
      {contextPanelVisible && (
        <ContextPanel
          debugMode={debugMode}
          onDebugModeChange={setDebugMode}
          collapsed={contextPanelCollapsed}
          onCollapse={setContextPanelCollapsed}
        />
      )}
    </div>
  );
}
