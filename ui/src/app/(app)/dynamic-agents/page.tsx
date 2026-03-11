"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useAdminRole } from "@/hooks/use-admin-role";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Server, Loader2, ShieldAlert } from "lucide-react";
import { DynamicAgentsTab } from "@/components/dynamic-agents/DynamicAgentsTab";
import { MCPServersTab } from "@/components/dynamic-agents/MCPServersTab";

export default function DynamicAgentsPage() {
  const router = useRouter();
  const { isAdmin, loading } = useAdminRole();
  const [activeTab, setActiveTab] = React.useState("agents");

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
              You need admin privileges to access the Custom Agents configuration.
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
            <h1 className="text-2xl font-bold tracking-tight">Custom Agents</h1>
            <p className="text-muted-foreground">
              Create and configure custom AI agents with MCP tool integrations.
            </p>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="agents" className="gap-2">
                <Bot className="h-4 w-4" />
                Agents
              </TabsTrigger>
              <TabsTrigger value="mcp-servers" className="gap-2">
                <Server className="h-4 w-4" />
                MCP Servers
              </TabsTrigger>
            </TabsList>

            <TabsContent value="agents" className="space-y-4">
              <DynamicAgentsTab />
            </TabsContent>

            <TabsContent value="mcp-servers" className="space-y-4">
              <MCPServersTab />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
