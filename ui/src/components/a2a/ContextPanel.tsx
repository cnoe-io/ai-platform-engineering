"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Radio,
  Bug,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import { A2AStreamPanel } from "./A2AStreamPanel";
import { A2AEvent } from "@/types/a2a";
import { useShallow } from "zustand/react/shallow";

// Stable empty array to avoid infinite re-render loops in selectors
const EMPTY_EVENTS: A2AEvent[] = [];

interface ContextPanelProps {
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
}

export function ContextPanel({
  collapsed = false,
  onCollapse,
}: ContextPanelProps) {
  const { isStreaming, activeConversationId } = useChatStore(
    useShallow((s) => ({
      isStreaming: s.isStreaming,
      activeConversationId: s.activeConversationId,
    })),
  );

  const conversations = useChatStore((s) => s.conversations);

  const conversationEvents = useMemo(() => {
    if (!activeConversationId) return EMPTY_EVENTS;
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.a2aEvents || EMPTY_EVENTS;
  }, [activeConversationId, conversations]);

  const conversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [activeConversationId, conversations]);

  const isActuallyStreaming = isStreaming && !!conversation;
  const eventCount = conversationEvents.length;

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 380 }}
      transition={{ duration: 0.2 }}
      className="relative h-full flex flex-col bg-card/30 backdrop-blur-sm border-l border-border/50 shrink-0 overflow-hidden"
    >
      {/* Header */}
      <div className="border-b border-border/50">
        <div
          className={cn(
            "flex items-center py-2",
            collapsed ? "justify-center px-2" : "justify-between px-3",
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
              <div className="flex items-center gap-2 text-sm text-foreground/80">
                <Bug className="h-4 w-4 text-amber-400" />
                <span className="font-medium">A2A Debug</span>
                {eventCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 text-[10px] bg-amber-500/20 text-amber-400"
                  >
                    {eventCount}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isActuallyStreaming && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/15 text-green-400 text-xs">
                    <Radio className="h-3 w-3 animate-pulse" />
                    Live
                  </div>
                )}
                {onCollapse && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onCollapse(!collapsed)}
                    className="h-8 w-8 hover:bg-muted shrink-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content — A2A Debug Stream */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          <A2AStreamPanel />
        </div>
      )}
    </motion.div>
  );
}
