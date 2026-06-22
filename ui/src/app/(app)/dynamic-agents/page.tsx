"use client";

// assisted-by Codex Codex-sonnet-4-6

import { AuthGuard } from "@/components/auth-guard";
import { ConversationsTab } from "@/components/dynamic-agents/ConversationsTab";
import { DynamicAgentsTab } from "@/components/dynamic-agents/DynamicAgentsTab";
import { LLMProvidersTab } from "@/components/dynamic-agents/LLMProvidersTab";
import { MCPServersTab } from "@/components/dynamic-agents/MCPServersTab";
import { UnsavedChangesDialog } from "@/components/task-builder/UnsavedChangesDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { useAdminTabGates } from "@/hooks/useAdminTabGates";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { Bot,Cpu,MessageSquare,Server } from "lucide-react";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import React from "react";

const BASE_VISIBLE_TABS = ["agents", "mcp-servers", "llm-models"] as const;

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

  // When the embedded DynamicAgentEditor has unsaved changes, switching sibling
  // tabs would unmount it and silently discard work. Intercept the switch and
  // surface the in-app modal instead. The interception is local to this page;
  // the global store's pendingNavigationHref is reserved for header-level
  // navigation handled by AppHeader.
  const [pendingTab, setPendingTab] = React.useState<string | null>(null);

  function performTabSwitch(tab: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`${pathname}?${params.toString()}`);
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

  return (
    <div className="flex-1 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
            <p className="text-muted-foreground">
              Create and configure custom AI agents with MCP tool integrations.
            </p>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className={`grid w-full max-w-xl ${showConversations ? "grid-cols-4" : "grid-cols-3"}`}>
              <TabsTrigger value="agents" className="gap-2">
                <Bot className="h-4 w-4" />
                Agents
              </TabsTrigger>
              <TabsTrigger value="mcp-servers" className="gap-2">
                <Server className="h-4 w-4" />
                MCP Servers
              </TabsTrigger>
              <TabsTrigger value="llm-models" className="gap-2">
                <Cpu className="h-4 w-4" />
                LLM Models
              </TabsTrigger>
              {showConversations && (
                <TabsTrigger value="conversations" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Conversations
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="agents" className="space-y-4">
              <DynamicAgentsTab />
            </TabsContent>

            <TabsContent value="mcp-servers" className="space-y-4">
              <MCPServersTab />
            </TabsContent>

            <TabsContent value="llm-models" className="space-y-4">
              <LLMProvidersTab />
            </TabsContent>

            {showConversations && (
              <TabsContent value="conversations" className="space-y-4">
                <ConversationsTab />
              </TabsContent>
            )}

          </Tabs>
        </div>
      </ScrollArea>

      <UnsavedChangesDialog
        open={pendingTab !== null}
        onCancel={handleCancelTabSwitch}
        onDiscard={handleConfirmTabSwitch}
        title="Unsaved changes"
        description="You have unsaved changes in the agent editor. They will be lost if you switch tabs."
      />
    </div>
  );
}

export default function DynamicAgentsPage() {
  return (
    <AuthGuard>
      <DynamicAgentsPageContent />
    </AuthGuard>
  );
}
