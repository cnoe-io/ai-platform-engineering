"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Server,
  Loader2,
  Zap,
  Check,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { MCPServerConfig, MCPToolInfo } from "@/types/dynamic-agent";

interface AllowedToolsPickerProps {
  value: Record<string, string[]>; // server_id -> tool names (empty = all)
  onChange: (value: Record<string, string[]>) => void;
  disabled?: boolean;
}

interface ProbeState {
  loading: boolean;
  tools?: MCPToolInfo[];
  error?: string;
}

export function AllowedToolsPicker({ value, onChange, disabled }: AllowedToolsPickerProps) {
  const [servers, setServers] = React.useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [probeStates, setProbeStates] = React.useState<Record<string, ProbeState>>({});
  const [expandedServers, setExpandedServers] = React.useState<Set<string>>(new Set());

  // Fetch available MCP servers
  React.useEffect(() => {
    const fetchServers = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/mcp-servers?page_size=100");
        const data = await response.json();
        if (data.success) {
          // Only show enabled servers
          setServers((data.data.items || []).filter((s: MCPServerConfig) => s.enabled));
        } else {
          setError(data.error || "Failed to fetch servers");
        }
      } catch (err: any) {
        setError(err.message || "Failed to fetch servers");
      } finally {
        setLoading(false);
      }
    };
    fetchServers();
  }, []);

  const handleProbe = async (serverId: string) => {
    setProbeStates((prev) => ({
      ...prev,
      [serverId]: { loading: true },
    }));

    try {
      const response = await fetch(`/api/mcp-servers/probe?id=${serverId}`, {
        method: "POST",
      });
      const data = await response.json();
      if (data.success) {
        setProbeStates((prev) => ({
          ...prev,
          [serverId]: { loading: false, tools: data.data.tools },
        }));
        // Auto-expand after successful probe
        setExpandedServers((prev) => new Set([...prev, serverId]));
      } else {
        setProbeStates((prev) => ({
          ...prev,
          [serverId]: { loading: false, error: data.error || "Probe failed" },
        }));
      }
    } catch (err: any) {
      setProbeStates((prev) => ({
        ...prev,
        [serverId]: { loading: false, error: err.message || "Probe failed" },
      }));
    }
  };

  const isServerSelected = (serverId: string) => {
    return serverId in value;
  };

  const isToolSelected = (serverId: string, toolName: string) => {
    if (!isServerSelected(serverId)) return false;
    const tools = value[serverId];
    // Empty array means all tools
    return tools.length === 0 || tools.includes(toolName);
  };

  const isAllToolsSelected = (serverId: string) => {
    return isServerSelected(serverId) && value[serverId].length === 0;
  };

  const toggleServer = (serverId: string) => {
    if (disabled) return;
    
    const newValue = { ...value };
    if (isServerSelected(serverId)) {
      delete newValue[serverId];
    } else {
      // Select server with all tools (empty array)
      newValue[serverId] = [];
    }
    onChange(newValue);
  };

  const toggleAllTools = (serverId: string) => {
    if (disabled || !isServerSelected(serverId)) return;
    
    const newValue = { ...value };
    // If currently has specific tools, switch to all tools (empty array)
    // If currently all tools, keep all tools
    newValue[serverId] = [];
    onChange(newValue);
  };

  const toggleTool = (serverId: string, toolName: string) => {
    if (disabled) return;
    
    const newValue = { ...value };
    const probe = probeStates[serverId];
    const allTools = probe?.tools?.map((t) => t.name) || [];

    if (!isServerSelected(serverId)) {
      // First select the server with just this tool
      newValue[serverId] = [toolName];
    } else if (isAllToolsSelected(serverId)) {
      // Currently all tools selected, switch to all except this one
      newValue[serverId] = allTools.filter((t) => t !== toolName);
    } else {
      // Currently specific tools selected
      const currentTools = [...value[serverId]];
      if (currentTools.includes(toolName)) {
        // Remove tool
        const filtered = currentTools.filter((t) => t !== toolName);
        if (filtered.length === 0) {
          // No tools left, remove server
          delete newValue[serverId];
        } else {
          newValue[serverId] = filtered;
        }
      } else {
        // Add tool
        currentTools.push(toolName);
        // If all tools are now selected, switch to empty array (all)
        if (allTools.length > 0 && currentTools.length === allTools.length) {
          newValue[serverId] = [];
        } else {
          newValue[serverId] = currentTools;
        }
      }
    }
    onChange(newValue);
  };

  const toggleExpanded = (serverId: string) => {
    setExpandedServers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
  };

  const getSelectedToolsCount = (serverId: string) => {
    if (!isServerSelected(serverId)) return 0;
    const tools = value[serverId];
    if (tools.length === 0) {
      // All tools
      const probe = probeStates[serverId];
      return probe?.tools?.length || "all";
    }
    return tools.length;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="text-center py-8 border rounded-lg bg-muted/20">
        <Server className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No MCP servers available</p>
        <p className="text-xs text-muted-foreground mt-1">
          Add MCP servers in the &quot;MCP Servers&quot; tab first
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Select MCP servers and tools this agent can access. Probe servers to discover available tools.
      </p>

      {servers.map((server) => {
        const probe = probeStates[server._id];
        const isSelected = isServerSelected(server._id);
        const isExpanded = expandedServers.has(server._id);
        const toolsCount = getSelectedToolsCount(server._id);

        return (
          <Card
            key={server._id}
            className={`transition-colors ${isSelected ? "border-primary bg-primary/5" : ""}`}
          >
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleServer(server._id)}
                    disabled={disabled}
                    className={`h-5 w-5 rounded border flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/30 hover:border-primary"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </button>
                  <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => toggleExpanded(server._id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="h-8 w-8 rounded bg-blue-500/10 flex items-center justify-center">
                      <Server className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">{server.name}</CardTitle>
                      <p className="text-xs text-muted-foreground font-mono">{server._id}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isSelected && (
                    <Badge variant="secondary" className="text-xs">
                      {toolsCount === "all" ? "All tools" : `${toolsCount} tool(s)`}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleProbe(server._id)}
                    disabled={disabled || probe?.loading}
                  >
                    {probe?.loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-1" />
                        Probe
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 pb-3 px-4">
                {probe?.error ? (
                  <p className="text-sm text-destructive">{probe.error}</p>
                ) : probe?.tools && probe.tools.length > 0 ? (
                  <div className="space-y-2">
                    {/* All tools toggle */}
                    <div className="flex items-center justify-between py-1 border-b">
                      <span className="text-xs font-medium text-muted-foreground">
                        {probe.tools.length} tools available
                      </span>
                      {isSelected && (
                        <button
                          type="button"
                          onClick={() => toggleAllTools(server._id)}
                          disabled={disabled}
                          className="text-xs text-primary hover:underline"
                        >
                          {isAllToolsSelected(server._id) ? "All selected" : "Select all"}
                        </button>
                      )}
                    </div>

                    {/* Tool list */}
                    <div className="grid gap-1.5">
                      {probe.tools.map((tool) => {
                        const selected = isToolSelected(server._id, tool.name);
                        return (
                          <button
                            key={tool.namespaced_name}
                            type="button"
                            onClick={() => toggleTool(server._id, tool.name)}
                            disabled={disabled}
                            className={`flex items-start gap-2 p-2 rounded text-left transition-colors ${
                              selected
                                ? "bg-primary/10 border border-primary/30"
                                : "bg-muted/30 hover:bg-muted/50 border border-transparent"
                            }`}
                          >
                            <div
                              className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                selected
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "border-muted-foreground/30"
                              }`}
                            >
                              {selected && <Check className="h-2.5 w-2.5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-xs font-medium truncate">
                                {tool.name}
                              </div>
                              {tool.description && (
                                <div className="text-xs text-muted-foreground line-clamp-2">
                                  {tool.description}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : probe?.tools && probe.tools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tools found on this server</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Click &quot;Probe&quot; to discover available tools
                  </p>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
