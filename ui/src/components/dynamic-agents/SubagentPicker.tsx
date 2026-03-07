"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Loader2, AlertCircle, Bot } from "lucide-react";
import type { SubAgentRef, AvailableSubagent } from "@/types/dynamic-agent";

interface SubagentPickerProps {
  agentId: string | null; // null when creating new agent
  value: SubAgentRef[];
  onChange: (subagents: SubAgentRef[]) => void;
  disabled?: boolean;
}

export function SubagentPicker({ agentId, value, onChange, disabled }: SubagentPickerProps) {
  const [availableAgents, setAvailableAgents] = React.useState<AvailableSubagent[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch available subagents when agentId changes
  React.useEffect(() => {
    if (!agentId) {
      // For new agents, fetch all agents (they can be filtered later)
      fetchAllAgents();
    } else {
      fetchAvailableSubagents(agentId);
    }
  }, [agentId]);

  const fetchAllAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dynamic-agents");
      const data = await response.json();
      if (data.success && data.data?.items) {
        setAvailableAgents(
          data.data.items.map((agent: any) => ({
            id: agent._id,
            name: agent.name,
            description: agent.description,
          }))
        );
      }
    } catch (err: any) {
      setError("Failed to load available agents");
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableSubagents = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/dynamic-agents/available-subagents?id=${id}`);
      const data = await response.json();
      if (data.success && data.data?.agents) {
        setAvailableAgents(data.data.agents);
      } else {
        setError(data.error || "Failed to load available subagents");
      }
    } catch (err: any) {
      setError("Failed to load available subagents");
    } finally {
      setLoading(false);
    }
  };

  const addSubagent = (agent: AvailableSubagent) => {
    // Check if already added
    if (value.some((s) => s.agent_id === agent.id)) {
      return;
    }

    // Generate a default routing name from the agent name
    const routingName = agent.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const newSubagent: SubAgentRef = {
      agent_id: agent.id,
      name: routingName,
      description: agent.description || `Delegate tasks to ${agent.name}`,
    };

    onChange([...value, newSubagent]);
  };

  const removeSubagent = (agentId: string) => {
    onChange(value.filter((s) => s.agent_id !== agentId));
  };

  const updateSubagent = (agentId: string, field: "name" | "description", newValue: string) => {
    onChange(
      value.map((s) => (s.agent_id === agentId ? { ...s, [field]: newValue } : s))
    );
  };

  // Get agent name by ID for display
  const getAgentName = (agentId: string): string => {
    const agent = availableAgents.find((a) => a.id === agentId);
    return agent?.name || agentId;
  };

  // Filter out already-added agents
  const selectableAgents = availableAgents.filter(
    (agent) => !value.some((s) => s.agent_id === agent.id)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading available agents...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-destructive bg-destructive/10 rounded-lg">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Currently configured subagents */}
      {value.length > 0 && (
        <div className="space-y-3">
          <Label>Configured Subagents</Label>
          {value.map((subagent) => (
            <Card key={subagent.agent_id} className="border-primary/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-1">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-grow space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">
                        {getAgentName(subagent.agent_id)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeSubagent(subagent.agent_id)}
                        disabled={disabled}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Routing Name
                        </Label>
                        <Input
                          value={subagent.name}
                          onChange={(e) =>
                            updateSubagent(subagent.agent_id, "name", e.target.value)
                          }
                          placeholder="e.g., code-reviewer"
                          disabled={disabled}
                          className="h-8 text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          Identifier used when delegating tasks (e.g., &quot;code-reviewer&quot;)
                        </p>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Description for LLM
                        </Label>
                        <Input
                          value={subagent.description}
                          onChange={(e) =>
                            updateSubagent(subagent.agent_id, "description", e.target.value)
                          }
                          placeholder="e.g., Reviews code for bugs and best practices"
                          disabled={disabled}
                          className="h-8 text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          The LLM uses this to decide when to delegate
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add subagent dropdown */}
      {selectableAgents.length > 0 && (
        <div className="space-y-2">
          <Label>Add Subagent</Label>
          <div className="grid gap-2 max-h-48 overflow-y-auto border rounded-lg p-2">
            {selectableAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => addSubagent(agent)}
                disabled={disabled}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-muted text-left transition-colors"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <div className="flex-grow min-w-0">
                  <div className="font-medium text-sm truncate">{agent.name}</div>
                  {agent.description && (
                    <div className="text-xs text-muted-foreground truncate">
                      {agent.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {value.length === 0 && selectableAgents.length === 0 && (
        <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
          <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">
            {agentId
              ? "No other agents available for delegation"
              : "Create the agent first to configure subagents"}
          </p>
        </div>
      )}

      {/* Help text */}
      {value.length > 0 && (
        <p className="text-xs text-muted-foreground">
          When this agent runs, the LLM can delegate tasks to these subagents using the{" "}
          <code className="bg-muted px-1 py-0.5 rounded">task</code> tool.
        </p>
      )}
    </div>
  );
}
