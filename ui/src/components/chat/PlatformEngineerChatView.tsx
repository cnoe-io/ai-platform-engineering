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
  /** Which admin tab the user navigated from */
  adminOrigin?: "audit-logs" | "feedback" | null;
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
  adminOrigin,
  contextPanelVisible = true,
}: PlatformEngineerChatViewProps) {
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
          adminOrigin={adminOrigin}
        />
      </motion.div>

      {/* Context Panel - A2A debug */}
      {contextPanelVisible && (
        <ContextPanel
          collapsed={contextPanelCollapsed}
          onCollapse={setContextPanelCollapsed}
        />
      )}
    </div>
  );
}
