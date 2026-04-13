"use client";

import React from "react";
import { motion } from "framer-motion";
import { SupervisorChatPanel } from "@/components/chat/SupervisorChatPanel";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";

interface SupervisorChatViewProps {
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
}

/**
 * Chat view for Platform Engineer (Supervisor).
 */
export function SupervisorChatView({
  endpoint,
  conversationId,
  conversationTitle,
  readOnly,
  readOnlyReason,
  adminOrigin,
}: SupervisorChatViewProps) {
  const { status } = useCAIPEHealth();
  const isDisconnected = status === "disconnected";

  return (
    <div className="flex-1 min-w-0 flex h-full relative">
      <motion.div
        key="chat"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex-1 min-w-0 flex flex-col overflow-hidden"
      >
        <SupervisorChatPanel
          endpoint={endpoint}
          conversationId={conversationId}
          conversationTitle={conversationTitle}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          adminOrigin={adminOrigin}
        />
      </motion.div>
    </div>
  );
}
