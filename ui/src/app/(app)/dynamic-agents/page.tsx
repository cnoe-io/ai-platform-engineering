"use client";

// assisted-by Codex Codex-sonnet-4-6

import { AuthGuard } from "@/components/auth-guard";
import { ConversationsTab } from "@/components/dynamic-agents/ConversationsTab";
import { DynamicAgentsTab } from "@/components/dynamic-agents/DynamicAgentsTab";
import { LLMModelsTab } from "@/components/dynamic-agents/LLMModelsTab";
import { LLMProvidersTab } from "@/components/dynamic-agents/LLMProvidersTab";
import { MCPServersTab } from "@/components/dynamic-agents/MCPServersTab";
import { isAgentSetupStep,type AgentSetupStep } from "@/components/dynamic-agents/deep-linking";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import {
  WorkspaceSectionNavigation,
  type WorkspaceNavigationGroup,
} from "@/components/layout/WorkspaceNavigation";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { UnsavedChangesDialog } from "@/components/shared/UnsavedChangesDialog";
import { useAdminTabGates } from "@/hooks/useAdminTabGates";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { Bot,Cpu,KeyRound,MessageSquare,Server } from "lucide-react";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import React from "react";

const BASE_VISIBLE_TABS = ["agents", "mcp-servers", "model-providers", "llm-models"] as const;
const RESOURCE_QUERY_KEYS = ["agent", "server", "model", "step"] as const;

function DynamicAgentsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { gates } = useAdminTabGates();
  const showConversations = Boolean(gates.dynamic_agent_conversations);
  const visibleTabs = React.useMemo(
    () => new Set<string>(showConversations ? [...BASE_VISIBLE_TABS, "conversations"] : BASE_VISIBLE_TABS),
    [showConversations],
  );

  const requestedTab = searchParams.get("tab") ?? "agents";
  const activeTab = visibleTabs.has(requestedTab) ? requestedTab : "agents";
  const selectedAgentId = searchParams.get("agent");
  const selectedServerId = searchParams.get("server");
  const selectedModelId = searchParams.get("model");
  const requestedAgentStep = searchParams.get("step");
  const agentStep = isAgentSetupStep(requestedAgentStep) ? requestedAgentStep : "basic";

  // When the embedded DynamicAgentEditor has unsaved changes, switching sibling
  // tabs would unmount it and silently discard work. Intercept the switch and
  // surface the in-app modal instead. The interception is local to this page;
  // the global store's pendingNavigationHref is reserved for header-level
  // navigation handled by AppHeader.
  const [pendingTab, setPendingTab] = React.useState<string | null>(null);

  function hrefFor(params: URLSearchParams): string {
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function clearResourceSelection(params: URLSearchParams) {
    RESOURCE_QUERY_KEYS.forEach((key) => params.delete(key));
  }

  function performTabSwitch(tab: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    clearResourceSelection(params);
    router.push(hrefFor(params));
  }

  function selectResource(tab: "agents" | "mcp-servers" | "llm-models", key: "agent" | "server" | "model", id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    clearResourceSelection(params);
    if (id) {
      params.set(key, id);
      if (key === "agent") params.set("step", "basic");
    }
    router.push(hrefFor(params));
  }

  function setAgentStep(step: AgentSetupStep) {
    if (!selectedAgentId) return;
    const params = new URLSearchParams(searchParams.toString());
    clearResourceSelection(params);
    params.set("tab", "agents");
    params.set("agent", selectedAgentId);
    params.set("step", step);
    router.replace(hrefFor(params));
  }

  function setActiveTab(tab: string) {
    if (tab === activeTab) return;
    if (useUnsavedChangesStore.getState().hasUnsavedChanges) {
      setPendingTab(tab);
      return;
    }
    performTabSwitch(tab);
  }

  function handleConfirmTabSwitch() {
    const target = pendingTab;
    setPendingTab(null);
    useUnsavedChangesStore.getState().setUnsaved(false);
    if (target) performTabSwitch(target);
  }

  function handleCancelTabSwitch() {
    setPendingTab(null);
  }

  const navigationGroups: WorkspaceNavigationGroup[] = [{
    id: "agent-sections",
    items: [
      {
        id: "agents",
        label: "Agents",
        icon: Bot,
        description: "Create and configure agents",
        onSelect: () => setActiveTab("agents"),
      },
      {
        id: "mcp-servers",
        label: "MCP Servers",
        icon: Server,
        description: "Connect tools and services",
        onSelect: () => setActiveTab("mcp-servers"),
      },
      {
        id: "model-settings",
        label: "LLM Models",
        icon: Cpu,
        description: "Configure providers and models",
        children: [
          {
            id: "model-providers",
            label: "Model Providers",
            icon: KeyRound,
            description: "Connect model providers",
            onSelect: () => setActiveTab("model-providers"),
          },
          {
            id: "llm-models",
            label: "LLM Models",
            icon: Cpu,
            description: "Register available models",
            onSelect: () => setActiveTab("llm-models"),
          },
        ],
      },
      ...(showConversations ? [{
        id: "conversations",
        label: "Conversations",
        icon: MessageSquare,
        description: "Review agent conversations",
        onSelect: () => setActiveTab("conversations"),
      }] : []),
    ],
  }];

  return (
    <>
      <WorkspaceShell
        header={(
          <WorkspaceHeader
            description="Create and configure custom AI agents with MCP tool integrations."
            icon={Bot}
            iconAnimationClassName="motion-safe:duration-300 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:rotate-3 motion-safe:group-hover:scale-110"
            iconTestId="agents-header-icon"
            title="Agents"
          />
        )}
        maxWidthClassName="max-w-[108rem]"
        navigation={(
          <WorkspaceSectionNavigation
            activeItemId={activeTab}
            groups={navigationGroups}
            navigationLabel="Agent sections"
            pickerLabel="Agent section"
          />
        )}
      >
        {activeTab === "agents" ? (
          <DynamicAgentsTab
            selectedAgentId={selectedAgentId}
            initialStep={agentStep}
            onSelectedAgentChange={(id) => selectResource("agents", "agent", id)}
            onStepChange={setAgentStep}
          />
        ) : null}

        {activeTab === "mcp-servers" ? (
          <MCPServersTab
            selectedServerId={selectedServerId}
            onSelectedServerChange={(id) => selectResource("mcp-servers", "server", id)}
          />
        ) : null}

        {activeTab === "model-providers" ? <LLMProvidersTab /> : null}

        {activeTab === "llm-models" ? (
          <LLMModelsTab
            selectedModelId={selectedModelId}
            onSelectedModelChange={(id) => selectResource("llm-models", "model", id)}
          />
        ) : null}

        {showConversations && activeTab === "conversations" ? <ConversationsTab /> : null}
      </WorkspaceShell>

      <UnsavedChangesDialog
        open={pendingTab !== null}
        onCancel={handleCancelTabSwitch}
        onDiscard={handleConfirmTabSwitch}
        title="Unsaved changes"
        description="You have unsaved changes in the agent editor. They will be lost if you switch tabs."
      />
    </>
  );
}

export default function DynamicAgentsPage() {
  return (
    <AuthGuard>
      <DynamicAgentsPageContent />
    </AuthGuard>
  );
}
