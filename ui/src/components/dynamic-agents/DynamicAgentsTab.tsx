"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Globe,
  Users,
  Lock,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
} from "lucide-react";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";
import { DynamicAgentEditor } from "./DynamicAgentEditor";

export function DynamicAgentsTab() {
  const [agents, setAgents] = React.useState<DynamicAgentConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editingAgent, setEditingAgent] = React.useState<DynamicAgentConfig | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);

  const fetchAgents = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dynamic-agents?page_size=100");
      const data = await response.json();
      if (data.success) {
        setAgents(data.data.items || []);
      } else {
        setError(data.error || "Failed to fetch agents");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch agents");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleDelete = async (agentId: string) => {
    if (!confirm("Are you sure you want to delete this agent?")) return;

    try {
      const response = await fetch(`/api/dynamic-agents?id=${agentId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        fetchAgents();
      } else {
        alert(data.error || "Failed to delete agent");
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete agent");
    }
  };

  const handleToggleEnabled = async (agent: DynamicAgentConfig) => {
    try {
      const response = await fetch(`/api/dynamic-agents?id=${agent._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !agent.enabled }),
      });
      const data = await response.json();
      if (data.success) {
        fetchAgents();
      } else {
        alert(data.error || "Failed to update agent");
      }
    } catch (err: any) {
      alert(err.message || "Failed to update agent");
    }
  };

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case "global":
        return <Globe className="h-3 w-3" />;
      case "team":
        return <Users className="h-3 w-3" />;
      default:
        return <Lock className="h-3 w-3" />;
    }
  };

  const getVisibilityColor = (visibility: string) => {
    switch (visibility) {
      case "global":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30";
      case "team":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30";
    }
  };

  if (isCreating || editingAgent) {
    return (
      <DynamicAgentEditor
        agent={editingAgent}
        onSave={() => {
          setEditingAgent(null);
          setIsCreating(false);
          fetchAgents();
        }}
        onCancel={() => {
          setEditingAgent(null);
          setIsCreating(false);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Custom Agents</CardTitle>
            <CardDescription>
              Configure AI agents with custom instructions and MCP tool access.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchAgents} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Agent
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" className="mt-4" onClick={fetchAgents}>
              Retry
            </Button>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Agents Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first dynamic agent to get started.
            </p>
            <Button onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground px-2">
              <div className="col-span-4">Name</div>
              <div className="col-span-2">Visibility</div>
              <div className="col-span-2">Tools</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Agent rows */}
            {agents.map((agent) => (
              <div
                key={agent._id}
                className="grid grid-cols-12 gap-4 py-3 px-2 rounded-lg hover:bg-muted/50 items-center"
              >
                <div className="col-span-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                        <Bot className="h-5 w-5 text-purple-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{agent.name}</div>
                        {agent.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {agent.description}
                          </div>
                        )}
                      </div>
                    </div>
                </div>

                <div className="col-span-2">
                  <Badge
                    variant="outline"
                    className={`gap-1 ${getVisibilityColor(agent.visibility)}`}
                  >
                    {getVisibilityIcon(agent.visibility)}
                    {agent.visibility}
                  </Badge>
                </div>

                <div className="col-span-2">
                  <span className="text-sm text-muted-foreground">
                    {Object.keys(agent.allowed_tools || {}).length} server(s)
                  </span>
                </div>

                <div className="col-span-2">
                  <button
                    onClick={() => handleToggleEnabled(agent)}
                    className="flex items-center gap-1.5"
                  >
                    {agent.enabled ? (
                      <>
                        <ToggleRight className="h-5 w-5 text-green-500" />
                        <span className="text-xs text-green-600 dark:text-green-400">Active</span>
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Disabled</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="col-span-2 flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setEditingAgent(agent)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!agent.is_system && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(agent._id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
