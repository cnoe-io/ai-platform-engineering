"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";

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
}

/**
 * Chat view for Platform Engineer (Supervisor).
 */
export function PlatformEngineerChatView({
  endpoint,
  conversationId,
  conversationTitle,
  readOnly,
  readOnlyReason,
  adminOrigin,
}: PlatformEngineerChatViewProps) {
  const { status } = useCAIPEHealth();
  const isDisconnected = status === "disconnected";

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!isDisconnected) return;
    const handler = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [isDisconnected]);

  return (
    <div className="flex-1 min-w-0 flex h-full relative">
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

      {isDisconnected && (
        <div
          className="absolute inset-0 z-50 bg-background/60 backdrop-blur-[1px] cursor-none"
          style={{ pointerEvents: "all" }}
        >
          <div
            className="fixed z-[51] pointer-events-none px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium shadow-lg whitespace-nowrap"
            style={{
              left: mousePos.x + 16,
              top: mousePos.y + 16,
            }}
          >
            Disconnected from CAIPE
          </div>
        </div>
      )}
    </div>
  );
}
