"use client";

import React, { useState } from "react";
import { ChatPanel } from "@/components/chat/DynamicAgentChatPanel";
import { DynamicAgentContext } from "@/components/dynamic-agents/DynamicAgentContext";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { SubAgentRef, CustomThemeConfig } from "@/types/dynamic-agent";
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
  /** Custom theme config (when agentGradient === "custom") */
  agentCustomTheme?: CustomThemeConfig | null;
  /** Map of server_id -> tool names */
  allowedTools?: Record<string, string[]>;
  /** Configured subagents */
  subagents?: SubAgentRef[];
  /** Configured skill IDs */
  agentSkills?: string[];
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
 * Combines ChatPanel with a resizable DynamicAgentContext panel.
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
  agentCustomTheme,
  allowedTools,
  subagents,
  agentSkills,
  agentNotFound,
  agentDisabled,
  readOnly,
  readOnlyReason,
  adminOrigin,
  isLoadingMessages,
}: ChatViewProps) {
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(true);
  const contextPanelRef = usePanelRef();

  const handleCollapse = (collapsed: boolean) => {
    if (collapsed) {
      contextPanelRef.current?.collapse();
    } else {
      // expand() restores to previous size or minSize
      contextPanelRef.current?.expand();
    }
  };

  return (
    <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0 h-full">
      {/* Chat Panel */}
      <ResizablePanel minSize={40}>
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden h-full">
          <ChatPanel
            endpoint={endpoint}
            conversationId={conversationId}
            conversationTitle={conversationTitle}
            readOnly={readOnly || agentNotFound || agentDisabled}
            readOnlyReason={agentNotFound ? 'agent_deleted' : agentDisabled ? 'agent_disabled' : readOnlyReason}
            agentId={selectedAgentId}
            agentGradient={agentGradient}
            agentCustomTheme={agentCustomTheme}
            agentName={agentName}
            agentSkills={agentSkills}
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
          agentName={agentName}
          agentDescription={agentDescription}
          agentModel={agentModel}
          agentVisibility={agentVisibility}
          agentGradient={agentGradient}
          agentCustomTheme={agentCustomTheme}
          allowedTools={allowedTools}
          subagents={subagents}
          agentSkills={agentSkills}
          agentNotFound={agentNotFound}
          agentDisabled={agentDisabled}
          collapsed={contextPanelCollapsed}
          onCollapse={handleCollapse}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
