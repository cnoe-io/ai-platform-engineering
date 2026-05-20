"use client";

import React, { useState, useCallback } from "react";
import { ChatPanel } from "@/components/chat/DynamicAgentChatPanel";
import { DynamicAgentContext } from "@/components/dynamic-agents/DynamicAgentContext";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";
import { usePanelRef } from "react-resizable-panels";

interface ChatViewProps {
  /** The dynamic agent backend endpoint */
  endpoint: string;
  /** MongoDB conversation UUID */
  conversationId: string;
  /** Conversation title for display */
  conversationTitle?: string;
  /** The selected dynamic agent ID */
  selectedAgentId: string;
  /** Full agent config (null while loading) */
  agent?: DynamicAgentConfig | null;
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
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
 * Combines ChatPanel with a resizable DynamicAgentContext panel.
 */
export function ChatView({
  endpoint,
  conversationId,
  conversationTitle,
  selectedAgentId,
  agent,
  agentNotFound,
  readOnly,
  readOnlyReason,
  adminOrigin,
  isLoadingMessages,
}: ChatViewProps) {
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const contextPanelRef = usePanelRef();

  const handleCollapse = useCallback((collapsed: boolean) => {
    // Enable transition for programmatic expand/collapse, disable after animation
    setIsAnimating(true);
    if (collapsed) {
      contextPanelRef.current?.collapse();
    } else {
      contextPanelRef.current?.expand();
    }
    // Remove transition after animation completes so dragging isn't laggy
    setTimeout(() => setIsAnimating(false), 300);
  }, [contextPanelRef]);

  const isDisabled = agentNotFound || agent?.enabled === false;

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="flex-1 min-w-0 h-full"
      data-animating={isAnimating || undefined}
    >
      {/* Chat Panel */}
      <ResizablePanel minSize={40}>
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden h-full">
          <ChatPanel
            endpoint={endpoint}
            conversationId={conversationId}
            conversationTitle={conversationTitle}
            readOnly={readOnly || isDisabled}
            readOnlyReason={agentNotFound ? 'agent_deleted' : agent?.enabled === false ? 'agent_disabled' : readOnlyReason}
            agentId={selectedAgentId}
            agent={agent}
            isLoadingMessages={isLoadingMessages}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Context Panel - Dynamic Agent variant */}
      <ResizablePanel
        panelRef={contextPanelRef}
        defaultSize="64px"
        minSize="340px"
        maxSize="70%"
        collapsible
        collapsedSize="64px"
        onResize={(size) => {
          setContextPanelCollapsed(size.inPixels <= 80);
        }}
      >
        <DynamicAgentContext
          conversationId={conversationId}
          agentId={selectedAgentId}
          agent={agent}
          agentNotFound={agentNotFound}
          collapsed={contextPanelCollapsed}
          onCollapse={handleCollapse}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
