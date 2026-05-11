"use client";

import React, { useState } from "react";
import { ChatPanel } from "@/components/chat/DynamicAgentChatPanel";
import { DynamicAgentContext } from "@/components/dynamic-agents/DynamicAgentContext";
import type { SubAgentRef, CustomThemeConfig } from "@/types/dynamic-agent";

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
  /** Extra page/module context sent through the existing dynamic-agent backend path. */
  clientContext?: Record<string, unknown>;
  /** Optional prompt chips rendered by the chat composer. */
  suggestedPrompts?: string[];
  /** Start suggested prompts collapsed behind the compact Suggestions pill. */
  suggestedPromptsInitiallyHidden?: boolean;
  /** Hide the right-side agent info/tools panel for constrained embedded views. */
  hideContextPanel?: boolean;
  /** Optional empty-state title for embedded or specialized chat surfaces. */
  emptyStateTitle?: string;
  /** Optional empty-state subtitle shown above the selected agent name. */
  emptyStateSubtitle?: string;
  /** Optional visual surface treatment for embedded chat surfaces. */
  surface?: "default" | "glass";
  /** Optional font-size scale for embedded chat surfaces. */
  fontScale?: "compact" | "default" | "large";
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
  clientContext,
  suggestedPrompts,
  suggestedPromptsInitiallyHidden,
  hideContextPanel,
  emptyStateTitle,
  emptyStateSubtitle,
  surface = "default",
  fontScale = "default",
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
          agentCustomTheme={agentCustomTheme}
          agentName={agentName}
          agentSkills={agentSkills}
          isLoadingMessages={isLoadingMessages}
          clientContext={clientContext}
          suggestedPrompts={suggestedPrompts}
          suggestedPromptsInitiallyHidden={suggestedPromptsInitiallyHidden}
          emptyStateTitle={emptyStateTitle}
          emptyStateSubtitle={emptyStateSubtitle}
          surface={surface}
          fontScale={fontScale}
        />
      </div>

      {/* Context Panel - Dynamic Agent variant */}
      {!hideContextPanel && (
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
          onCollapse={setContextPanelCollapsed}
        />
      )}
    </div>
  );
}
