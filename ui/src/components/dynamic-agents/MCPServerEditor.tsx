"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import type {
  MCPServerConfig,
  MCPServerConfigCreate,
  MCPServerConfigUpdate,
  TransportType,
} from "@/types/dynamic-agent";

interface MCPServerEditorProps {
  server: MCPServerConfig | null; // null = creating new
  readOnly?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

const TRANSPORT_OPTIONS: { value: TransportType; label: string; description: string }[] = [
  { value: "stdio", label: "STDIO", description: "Local process via stdin/stdout" },
  { value: "sse", label: "SSE", description: "Server-Sent Events endpoint" },
  { value: "http", label: "HTTP", description: "HTTP/REST endpoint" },
];

export function MCPServerEditor({ server, readOnly, onSave, onCancel }: MCPServerEditorProps) {
  const isEditing = !!server;

  // Form state
  const [id, setId] = React.useState(server?._id || "");
  const [name, setName] = React.useState(server?.name || "");
  const [description, setDescription] = React.useState(server?.description || "");
  const [transport, setTransport] = React.useState<TransportType>(server?.transport || "sse");
  const [endpoint, setEndpoint] = React.useState(server?.endpoint || "");
  const [command, setCommand] = React.useState(server?.command || "");
  const [args, setArgs] = React.useState<string[]>(server?.args || []);
  const [envVars, setEnvVars] = React.useState<{ key: string; value: string }[]>(
    server?.env ? Object.entries(server.env).map(([key, value]) => ({ key, value })) : []
  );
  // HTTP headers for SSE/HTTP transports — stored encrypted just like env vars
  const [headerVars, setHeaderVars] = React.useState<{ key: string; value: string }[]>(
    server?.headers ? Object.entries(server.headers).map(([key, value]) => ({ key, value })) : []
  );

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Arg input state
  const [newArg, setNewArg] = React.useState("");

  const handleAddArg = () => {
    if (newArg.trim()) {
      setArgs([...args, newArg.trim()]);
      setNewArg("");
    }
  };

  const handleRemoveArg = (index: number) => {
    setArgs(args.filter((_, i) => i !== index));
  };

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const handleUpdateEnvVar = (index: number, field: "key" | "value", value: string) => {
    const updated = [...envVars];
    updated[index][field] = value;
    setEnvVars(updated);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleAddHeaderVar = () => {
    setHeaderVars([...headerVars, { key: "", value: "" }]);
  };

  const handleUpdateHeaderVar = (index: number, field: "key" | "value", value: string) => {
    const updated = [...headerVars];
    updated[index][field] = value;
    setHeaderVars(updated);
  };

  const handleRemoveHeaderVar = (index: number) => {
    setHeaderVars(headerVars.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Build env object from array (stdio only)
      const env: Record<string, string> = {};
      envVars.forEach((ev) => {
        if (ev.key.trim()) {
          env[ev.key.trim()] = ev.value;
        }
      });

      // Build headers object from array (sse/http only)
      const headers: Record<string, string> = {};
      headerVars.forEach((hv) => {
        if (hv.key.trim()) {
          headers[hv.key.trim()] = hv.value;
        }
      });

      if (isEditing) {
        // Update existing server
        const updateData: MCPServerConfigUpdate = {
          name,
          description: description || undefined,
          transport,
          endpoint: transport !== "stdio" ? endpoint : undefined,
          headers: transport !== "stdio" && Object.keys(headers).length > 0 ? headers : undefined,
          command: transport === "stdio" ? command : undefined,
          args: transport === "stdio" ? args : undefined,
          env: transport === "stdio" && Object.keys(env).length > 0 ? env : undefined,
        };

        const response = await fetch(`/api/mcp-servers?id=${server._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to update server");
        }
      } else {
        // Create new server
        const createData: MCPServerConfigCreate = {
          id: id.trim(),
          name,
          description: description || undefined,
          transport,
          endpoint: transport !== "stdio" ? endpoint : undefined,
          headers: transport !== "stdio" && Object.keys(headers).length > 0 ? headers : undefined,
          command: transport === "stdio" ? command : undefined,
          args: transport === "stdio" ? args : undefined,
          env: transport === "stdio" && Object.keys(env).length > 0 ? env : undefined,
        };

        const response = await fetch("/api/mcp-servers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createData),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to create server");
        }
      }

      onSave();
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const isValid =
    name.trim() &&
    (isEditing || id.trim()) &&
    (transport === "stdio" ? command.trim() : endpoint.trim());

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>{readOnly ? "View MCP Server" : isEditing ? "Edit MCP Server" : "Add MCP Server"}</CardTitle>
            <CardDescription>
              {readOnly
                ? "This server is managed by configuration and cannot be edited."
                : isEditing
                ? "Update the server configuration"
                : "Configure a new MCP server connection"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <fieldset disabled={readOnly} className={readOnly ? "opacity-70" : ""}>
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Basic Information</h3>

            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="id">
                  Server ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="id"
                  placeholder="e.g., github, filesystem, postgres"
                  value={id}
                  onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  disabled={loading}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Unique identifier for this server (lowercase, no spaces)
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">
                Display Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="e.g., GitHub MCP Server"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What does this server provide?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
                rows={2}
              />
            </div>
          </div>

          {/* Transport */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Transport Configuration</h3>

            <div className="space-y-2">
              <Label>Transport Type</Label>
              <div className="flex gap-2">
                {TRANSPORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTransport(opt.value)}
                    className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                      transport === opt.value
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-primary/50"
                    }`}
                    disabled={loading}
                  >
                    <div className="font-medium text-sm">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Transport-specific fields */}
            {transport === "stdio" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="command">
                    Command <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="command"
                    placeholder="e.g., npx, uvx, python"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    disabled={loading}
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Arguments</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add argument..."
                      value={newArg}
                      onChange={(e) => setNewArg(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddArg();
                        }
                      }}
                      disabled={loading}
                      className="font-mono"
                    />
                    <Button type="button" variant="outline" onClick={handleAddArg} disabled={loading}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {args.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {args.map((arg, i) => (
                        <Badge key={i} variant="secondary" className="font-mono gap-1">
                          {arg}
                          <button
                            type="button"
                            onClick={() => handleRemoveArg(i)}
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Environment Variables</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleAddEnvVar}
                      disabled={loading}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  {envVars.length > 0 && (
                    <div className="space-y-2">
                      {envVars.map((env, i) => (
                        <div key={i} className="flex gap-2">
                          <Input
                            placeholder="KEY"
                            value={env.key}
                            onChange={(e) => handleUpdateEnvVar(i, "key", e.target.value)}
                            disabled={loading}
                            className="font-mono flex-1"
                          />
                          <Input
                            placeholder="value"
                            value={env.value}
                            onChange={(e) => handleUpdateEnvVar(i, "value", e.target.value)}
                            disabled={loading}
                            className="font-mono flex-[2]"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveEnvVar(i)}
                            disabled={loading}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="endpoint">
                    Endpoint URL <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="endpoint"
                    placeholder={`e.g., https://my-mcp.example.com/${transport === "sse" ? "sse" : "mcp"}`}
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    disabled={loading}
                    className="font-mono"
                  />
                </div>

                {/* HTTP Headers — for API keys, Authorization, custom headers */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>HTTP Headers</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        e.g. <span className="font-mono">X-API-Key</span>, <span className="font-mono">Authorization</span> — values are encrypted at rest
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleAddHeaderVar}
                      disabled={loading}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  {headerVars.length > 0 && (
                    <div className="space-y-2">
                      {headerVars.map((hv, i) => (
                        <div key={i} className="flex gap-2">
                          <Input
                            placeholder="Header-Name"
                            value={hv.key}
                            onChange={(e) => handleUpdateHeaderVar(i, "key", e.target.value)}
                            disabled={loading}
                            className="font-mono flex-1"
                          />
                          <Input
                            placeholder="value"
                            type="password"
                            value={hv.value}
                            onChange={(e) => handleUpdateHeaderVar(i, "value", e.target.value)}
                            disabled={loading}
                            className="font-mono flex-[2]"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveHeaderVar(i)}
                            disabled={loading}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          </fieldset>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            {readOnly && (
              <span className="text-xs text-muted-foreground mr-auto">
                Config-driven — managed by configuration file
              </span>
            )}
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={loading || !isValid}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isEditing ? "Saving..." : "Creating..."}
                  </>
                ) : isEditing ? (
                  "Save Changes"
                ) : (
                  "Create Server"
                )}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
