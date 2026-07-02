"use client";

// assisted-by Codex Codex-sonnet-4-6

import { LastReviewBadge } from "@/components/ai-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { toYaml } from "@/lib/yaml-serializer";
import type { DynamicAgentConfigWithPermissions } from "@/types/dynamic-agent";
import {
Bot,
AlertCircle,
CopyPlus,
Download,
Globe,
Loader2,
Lock,
Plus,
RefreshCw,
ToggleLeft,
ToggleRight,
Trash2,
Users,
} from "lucide-react";
import React from "react";
import { AgentAvatar } from "./AgentAvatar";
import { DynamicAgentEditor } from "./DynamicAgentEditor";

const DEFAULT_ROW_PERMISSIONS = {
  can_manage: false,
  can_write: false,
  can_discover: false,
} as const;

function agentCanEdit(agent: DynamicAgentConfigWithPermissions | null | undefined): boolean {
  if (!agent) return true;
  return agent.permissions?.can_write === true || agent.permissions?.can_manage === true;
}

function agentCanManage(agent: DynamicAgentConfigWithPermissions | null | undefined): boolean {
  return agent?.permissions?.can_manage === true;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function DynamicAgentsTab() {
  const [agents, setAgents] = React.useState<DynamicAgentConfigWithPermissions[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editingAgent, setEditingAgent] = React.useState<DynamicAgentConfigWithPermissions | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [cloningAgent, setCloningAgent] = React.useState<DynamicAgentConfigWithPermissions | null>(null);
  const [pendingDeleteAgentId, setPendingDeleteAgentId] = React.useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = React.useState<string | null>(null);
  const [rowActionErrors, setRowActionErrors] = React.useState<Record<string, string>>({});

  const fetchAgents = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dynamic-agents?page_size=100");
      const data = await response.json();
      if (data.success) {
        setAgents(
          (data.data.items || []).map((agent: DynamicAgentConfigWithPermissions) => ({
            ...agent,
            permissions: agent.permissions ?? DEFAULT_ROW_PERMISSIONS,
          })),
        );
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

  const clearRowActionError = React.useCallback((agentId: string) => {
    setRowActionErrors((prev) => {
      if (!prev[agentId]) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, []);

  const handleDelete = async (agentId: string) => {
    setDeletingAgentId(agentId);
    clearRowActionError(agentId);
    try {
      const response = await fetch(`/api/dynamic-agents?id=${agentId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        setPendingDeleteAgentId(null);
        fetchAgents();
      } else {
        setRowActionErrors((prev) => ({
          ...prev,
          [agentId]: data.error || "Failed to delete agent",
        }));
      }
    } catch (err: unknown) {
      setRowActionErrors((prev) => ({
        ...prev,
        [agentId]: errorMessage(err, "Failed to delete agent"),
      }));
    } finally {
      setDeletingAgentId(null);
    }
  };

  const handleToggleEnabled = async (agent: DynamicAgentConfigWithPermissions) => {
    if (!agentCanManage(agent)) return;
    clearRowActionError(agent._id);
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
        setRowActionErrors((prev) => ({
          ...prev,
          [agent._id]: data.error || "Failed to update agent",
        }));
      }
    } catch (err: unknown) {
      setRowActionErrors((prev) => ({
        ...prev,
        [agent._id]: errorMessage(err, "Failed to update agent"),
      }));
    }
  };

  /**
   * Export agent configuration as YAML file.
   */
  const handleExportYaml = (agent: DynamicAgentConfigWithPermissions) => {
    // Build a complete config object for export (excluding only internal metadata)
    const agentRecord = agent as unknown as Record<string, unknown>;
    const exportConfig = {
      id: agent._id,
      name: agent.name,
      description: agent.description || undefined,
      system_prompt: agent.system_prompt,
      model: agent.model,
      visibility: agent.visibility,
      shared_with_teams: agent.shared_with_teams?.length ? agent.shared_with_teams : undefined,
      allowed_tools: Object.keys(agent.allowed_tools || {}).length ? agent.allowed_tools : undefined,
      builtin_tools: agent.builtin_tools,
      subagents: agent.subagents?.length ? agent.subagents : undefined,
      skills: agent.skills?.length ? agent.skills : undefined,
      features: agent.features,
      interrupt_on: agentRecord.interrupt_on || undefined,
      ui: agent.ui?.gradient_theme ? agent.ui : undefined,
      enabled: agent.enabled,
    };

    const yamlContent = toYaml(exportConfig);

    // Download the file
    const blob = new Blob([yamlContent], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${agent._id}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Clone an agent - opens the editor with pre-filled values
   */
  const handleClone = (agent: DynamicAgentConfigWithPermissions) => {
    setCloningAgent(agent);
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

  if (isCreating || editingAgent || cloningAgent) {
    return (
      <DynamicAgentEditor
        agent={editingAgent}
        cloneFrom={cloningAgent}
        readOnly={Boolean(editingAgent?.config_driven || (editingAgent && !agentCanEdit(editingAgent)))}
        readOnlyReason={editingAgent?.config_driven ? "config" : "permissions"}
        onSave={() => {
          setEditingAgent(null);
          setIsCreating(false);
          setCloningAgent(null);
          fetchAgents();
        }}
        onCancel={() => {
          setEditingAgent(null);
          setIsCreating(false);
          setCloningAgent(null);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Agents</CardTitle>
            <CardDescription>
              Build agents and choose the instructions, tools, and model they use.
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
            <h3 className="text-lg font-semibold mb-2">No agents yet</h3>
            <p className="text-muted-foreground mb-4">
              Create an agent when you are ready to give your team a tailored assistant.
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
              <div className="col-span-1">Tools</div>
              <div className="col-span-1">Grade</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Agent rows */}
            {agents.map((agent) => {
              const canManage = agentCanManage(agent);
              const rowActionError = rowActionErrors[agent._id];
              return (
              <div key={agent._id} className="space-y-2">
              <div
                className="grid grid-cols-12 gap-4 py-3 px-2 rounded-lg hover:bg-muted/50 items-center cursor-pointer"
                onClick={() => setEditingAgent(agent)}
              >
                <div className="col-span-4">
                    <div className="flex items-center gap-3">
                      <AgentAvatar
                        agent={agent}
                        rounded="rounded-lg"
                        size="h-9 w-9"
                        iconSize="h-5 w-5"
                      />
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

                <div className="col-span-1">
                  <span className="text-sm text-muted-foreground">
                    {Object.keys(agent.allowed_tools || {}).length}
                  </span>
                </div>

                <div className="col-span-1">
                  <LastReviewBadge review={agent.last_review} />
                </div>

                <div className="col-span-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canManage && !agent.config_driven) handleToggleEnabled(agent);
                    }}
                    className={`flex items-center gap-1.5 ${
                      agent.config_driven || !canManage ? "cursor-not-allowed opacity-60" : ""
                    }`}
                    disabled={agent.config_driven || !canManage}
                    title={
                      agent.config_driven
                        ? "Config-driven agents cannot be modified"
                        : !canManage
                          ? "You need manage access to enable or disable this agent"
                          : undefined
                    }
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

                <div className="col-span-2 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleExportYaml(agent)}
                    title="Export as YAML"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleClone(agent)}
                    title="Clone agent"
                  >
                    <CopyPlus className="h-4 w-4" />
                  </Button>
                  {agent.config_driven && (
                    <Badge
                      variant="outline"
                      className="gap-1 mr-1 bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30"
                      title="Loaded from config.yaml - cannot be edited"
                    >
                      Config
                    </Badge>
                  )}
                  {!agent.is_system && !agent.config_driven && canManage && (
                    pendingDeleteAgentId === agent._id ? (
                      <div className="flex items-center gap-1 rounded-full border border-destructive/20 bg-destructive/10 px-2 py-1">
                        <span className="max-w-[7rem] truncate text-xs font-medium text-destructive">
                          Delete {agent.name}?
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                          disabled={deletingAgentId === agent._id}
                          onClick={() => setPendingDeleteAgentId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          aria-label={`Confirm delete ${agent.name}`}
                          className="h-7 bg-destructive px-2 text-xs text-destructive-foreground hover:bg-destructive/90"
                          disabled={deletingAgentId === agent._id}
                          onClick={() => void handleDelete(agent._id)}
                        >
                          {deletingAgentId === agent._id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Delete"
                          )}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => {
                          setPendingDeleteAgentId(agent._id);
                          clearRowActionError(agent._id);
                        }}
                        aria-label={`Delete ${agent.name}`}
                        title="Delete agent"
                        disabled={deletingAgentId === agent._id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )
                  )}
                </div>
              </div>

              {rowActionError && (
                <div className="ml-12 pl-4 border-l-2 border-destructive/30">
                  <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="flex flex-1 items-start justify-between gap-3">
                      <p className="text-sm text-destructive">{rowActionError}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => clearRowActionError(agent._id)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              </div>
            );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
