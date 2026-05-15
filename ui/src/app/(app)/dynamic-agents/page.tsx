"use client";

import React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useAdminRole } from "@/hooks/use-admin-role";
import { AuthGuard } from "@/components/auth-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Server, Loader2, ShieldAlert, MessageSquare, Cpu } from "lucide-react";
import { DynamicAgentsTab } from "@/components/dynamic-agents/DynamicAgentsTab";
import { MCPServersTab } from "@/components/dynamic-agents/MCPServersTab";
import { LLMModelsTab } from "@/components/dynamic-agents/LLMModelsTab";
import { ConversationsTab } from "@/components/dynamic-agents/ConversationsTab";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { UnsavedChangesDialog } from "@/components/task-builder/UnsavedChangesDialog";

function DynamicAgentsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isAdmin, loading } = useAdminRole();

  const activeTab = searchParams.get("tab") ?? "agents";

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

  // Show loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Redirect non-admins
  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-destructive" />
              <CardTitle>Access Denied</CardTitle>
            </div>
            <CardDescription>
              You need admin privileges to access the Agents configuration.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
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
            <TabsList className="grid w-full max-w-2xl grid-cols-4">
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
              <TabsTrigger value="conversations" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Conversations
              </TabsTrigger>
            </TabsList>

            <TabsContent value="agents" className="space-y-4">
              <DynamicAgentsTab />
            </TabsContent>

            <TabsContent value="mcp-servers" className="space-y-4">
              <MCPServersTab />
            </TabsContent>

            <TabsContent value="llm-models" className="space-y-4">
              <LLMModelsTab />
            </TabsContent>

            <TabsContent value="conversations" className="space-y-4">
              <ConversationsTab />
            </TabsContent>
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
