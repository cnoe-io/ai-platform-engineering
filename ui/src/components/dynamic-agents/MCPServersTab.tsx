"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Zap,
  Terminal,
  Radio,
  Globe,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type { MCPServerConfig, MCPToolInfo } from "@/types/dynamic-agent";
import { MCPServerEditor } from "./MCPServerEditor";

interface ProbeResult {
  server_id: string;
  loading: boolean;
  tools?: MCPToolInfo[];
  error?: string;
}

export function MCPServersTab() {
  const [servers, setServers] = React.useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editingServer, setEditingServer] = React.useState<MCPServerConfig | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [probeResults, setProbeResults] = React.useState<Record<string, ProbeResult>>({});

  const fetchServers = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mcp-servers?page_size=100");
      const data = await response.json();
      if (data.success) {
        setServers(data.data.items || []);
      } else {
        setError(data.error || "Failed to fetch servers");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch servers");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleDelete = async (serverId: string) => {
    if (!confirm("Are you sure you want to delete this MCP server?")) return;

    try {
      const response = await fetch(`/api/mcp-servers?id=${serverId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        fetchServers();
      } else {
        alert(data.error || "Failed to delete server");
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete server");
    }
  };

  const handleToggleEnabled = async (server: MCPServerConfig) => {
    try {
      const response = await fetch(`/api/mcp-servers?id=${server._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      const data = await response.json();
      if (data.success) {
        fetchServers();
      } else {
        alert(data.error || "Failed to update server");
      }
    } catch (err: any) {
      alert(err.message || "Failed to update server");
    }
  };

  const handleProbe = async (serverId: string) => {
    setProbeResults((prev) => ({
      ...prev,
      [serverId]: { server_id: serverId, loading: true },
    }));

    try {
      const response = await fetch(`/api/mcp-servers/probe?id=${serverId}`, {
        method: "POST",
      });
      const data = await response.json();
      
      // Check outer success (API call succeeded)
      if (data.success) {
        // Check inner success (probe operation succeeded)
        const probeData = data.data;
        if (probeData.success === false) {
          // Probe failed (e.g., connection error to MCP server)
          setProbeResults((prev) => ({
            ...prev,
            [serverId]: {
              server_id: serverId,
              loading: false,
              error: probeData.error || "Probe failed",
            },
          }));
        } else {
          // Probe succeeded
          setProbeResults((prev) => ({
            ...prev,
            [serverId]: {
              server_id: serverId,
              loading: false,
              tools: probeData.tools,
            },
          }));
        }
      } else {
        // API call itself failed
        setProbeResults((prev) => ({
          ...prev,
          [serverId]: {
            server_id: serverId,
            loading: false,
            error: data.error || "Probe failed",
          },
        }));
      }
    } catch (err: any) {
      setProbeResults((prev) => ({
        ...prev,
        [serverId]: {
          server_id: serverId,
          loading: false,
          error: err.message || "Probe failed",
        },
      }));
    }
  };

  const getTransportIcon = (transport: string) => {
    switch (transport) {
      case "stdio":
        return <Terminal className="h-3 w-3" />;
      case "sse":
        return <Radio className="h-3 w-3" />;
      case "http":
        return <Globe className="h-3 w-3" />;
      default:
        return <Server className="h-3 w-3" />;
    }
  };

  const getTransportColor = (transport: string) => {
    switch (transport) {
      case "stdio":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30";
      case "sse":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30";
      case "http":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30";
    }
  };

  if (isCreating || editingServer) {
    return (
      <MCPServerEditor
        server={editingServer}
        onSave={() => {
          setEditingServer(null);
          setIsCreating(false);
          fetchServers();
        }}
        onCancel={() => {
          setEditingServer(null);
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
            <CardTitle>MCP Servers</CardTitle>
            <CardDescription>
              Configure MCP (Model Context Protocol) server connections for tool access.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchServers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Server
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
            <Button variant="outline" className="mt-4" onClick={fetchServers}>
              Retry
            </Button>
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No MCP Servers Yet</h3>
            <p className="text-muted-foreground mb-4">
              Add your first MCP server to enable tool access for agents.
            </p>
            <Button onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Server
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground px-2">
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Transport</div>
              <div className="col-span-3">Endpoint / Command</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Server rows */}
            {servers.map((server) => {
              const probe = probeResults[server._id];
              return (
                <div key={server._id} className="space-y-2">
                  <div className="grid grid-cols-12 gap-4 py-3 px-2 rounded-lg hover:bg-muted/50 items-center">
                    <div className="col-span-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                          <Server className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{server.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {server._id}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <Badge
                        variant="outline"
                        className={`gap-1 ${getTransportColor(server.transport)}`}
                      >
                        {getTransportIcon(server.transport)}
                        {server.transport}
                      </Badge>
                    </div>

                    <div className="col-span-3">
                      <span className="text-sm text-muted-foreground truncate block max-w-[200px]">
                        {server.transport === "stdio"
                          ? server.command
                          : server.endpoint}
                      </span>
                    </div>

                    <div className="col-span-2">
                      <button
                        onClick={() => handleToggleEnabled(server)}
                        className="flex items-center gap-1.5"
                      >
                        {server.enabled ? (
                          <>
                            <ToggleRight className="h-5 w-5 text-green-500" />
                            <span className="text-xs text-green-600 dark:text-green-400">
                              Active
                            </span>
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
                        onClick={() => handleProbe(server._id)}
                        disabled={probe?.loading}
                        title="Probe for tools"
                      >
                        {probe?.loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditingServer(server)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(server._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Probe results */}
                  {probe && !probe.loading && (
                    <div className="ml-12 pl-4 border-l-2 border-muted">
                      {probe.error ? (
                        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
                          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-destructive">Probe Failed</p>
                            <p className="text-sm text-destructive/80">{probe.error}</p>
                          </div>
                        </div>
                      ) : probe.tools && probe.tools.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                              {probe.tools.length} tool(s) available
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {probe.tools.map((tool) => (
                              <Badge
                                key={tool.namespaced_name}
                                variant="secondary"
                                className="text-xs font-mono"
                                title={tool.description || tool.name}
                              >
                                {tool.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <AlertCircle className="h-4 w-4" />
                          <p className="text-sm">No tools found on this server</p>
                        </div>
                      )}
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
