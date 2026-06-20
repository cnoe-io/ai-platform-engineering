"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
MCPCredentialSource,
MCPServerConfig,
MCPServerConfigCreate,
MCPServerConfigUpdate,
TransportType,
} from "@/types/dynamic-agent";
import { ArrowLeft,Loader2,Plus,X } from "lucide-react";
import React from "react";

interface MCPServerEditorProps {
  server: MCPServerConfig | null; // null = creating new
  readOnly?: boolean;
  managedByAgentGateway?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

const TRANSPORT_OPTIONS: { value: TransportType; label: string; description: string }[] = [
  { value: "stdio", label: "STDIO", description: "Local process via stdin/stdout" },
  { value: "sse", label: "SSE", description: "Server-Sent Events endpoint" },
  { value: "http", label: "HTTP", description: "HTTP/REST endpoint" },
];

export function MCPServerEditor({
  server,
  readOnly,
  managedByAgentGateway,
  onSave,
  onCancel,
}: MCPServerEditorProps) {
  const isEditing = !!server;
  // assisted-by Codex Codex-sonnet-4-6
  const credentialOnly = Boolean(isEditing && managedByAgentGateway && !readOnly);
  const metadataReadOnly = Boolean(readOnly || credentialOnly);
  const credentialReadOnly = Boolean(readOnly);

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
  const [credentialSources, setCredentialSources] = React.useState<MCPCredentialSource[]>(
    server?.credential_sources || []
  );

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Arg input state
  const [newArg, setNewArg] = React.useState("");

  // AgentGateway target picker. Discovery is best-effort: when the
  // backend isn't reachable or AgentGateway isn't configured we just
  // hide the helper UI. Failing closed here would force the admin back
  // to typing endpoints by hand, which is what got us into the bare
  // `http://agentgateway:4000/mcp` (no `/<id>` suffix) → 404 mess.
  type AgentGatewayTarget = {
    id: string;
    name?: string;
    endpoint: string;
    target_endpoint?: string;
  };
  const [agentGatewayTargets, setAgentGatewayTargets] = React.useState<AgentGatewayTarget[]>([]);
  const [gatewayDiscoveryLoaded, setGatewayDiscoveryLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function loadDiscovery() {
      try {
        const res = await fetch("/api/mcp-servers/agentgateway/discover");
        if (!res.ok) {
          if (!cancelled) setGatewayDiscoveryLoaded(true);
          return;
        }
        const payload = (await res.json()) as {
          success?: boolean;
          data?: { targets?: AgentGatewayTarget[] };
        };
        if (!cancelled && payload?.success && Array.isArray(payload.data?.targets)) {
          setAgentGatewayTargets(payload.data.targets);
        }
      } catch {
        // best-effort; the dropdown just won't appear
      } finally {
        if (!cancelled) setGatewayDiscoveryLoaded(true);
      }
    }
    void loadDiscovery();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleAddCredentialSource = () => {
    setCredentialSources([
      ...credentialSources,
      { kind: "secret_ref", target: transport === "stdio" ? "env" : "header", name: "", secret_ref: "" },
    ]);
  };

  const handleUpdateCredentialSource = (
    index: number,
    field: keyof MCPCredentialSource,
    value: string,
  ) => {
    const updated = [...credentialSources];
    updated[index] = { ...updated[index], [field]: value };
    setCredentialSources(updated);
  };

  const handleRemoveCredentialSource = (index: number) => {
    setCredentialSources(credentialSources.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Build env object from array
      const env: Record<string, string> = {};
      envVars.forEach((ev) => {
        if (ev.key.trim()) {
          env[ev.key.trim()] = ev.value;
        }
      });

      if (isEditing) {
        // Update existing server
        const shouldSendCredentialSources =
          credentialOnly || credentialSources.length > 0 || Boolean(server.credential_sources?.length);
        const updateData: MCPServerConfigUpdate = credentialOnly
          ? {
              credential_sources: credentialSources,
            }
          : {
              name,
              description: description || undefined,
              transport,
              endpoint: transport !== "stdio" ? endpoint : undefined,
              command: transport === "stdio" ? command : undefined,
              args: transport === "stdio" ? args : undefined,
              env: transport === "stdio" && Object.keys(env).length > 0 ? env : undefined,
              credential_sources: shouldSendCredentialSources ? credentialSources : undefined,
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
          command: transport === "stdio" ? command : undefined,
          args: transport === "stdio" ? args : undefined,
          env: transport === "stdio" && Object.keys(env).length > 0 ? env : undefined,
          credential_sources: credentialSources.length > 0 ? credentialSources : undefined,
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const isValid =
    credentialOnly ||
    (name.trim() &&
      (isEditing || id.trim()) &&
      (transport === "stdio" ? command.trim() : endpoint.trim()));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>
              {readOnly
                ? "View MCP Server"
                : credentialOnly
                ? "Manage AgentGateway MCP Server"
                : isEditing
                ? "Edit MCP Server"
                : "Add MCP Server"}
            </CardTitle>
            <CardDescription>
              {readOnly
                ? "This server is managed by configuration and cannot be edited."
                : credentialOnly
                ? "AgentGateway manages routing metadata. Credential references can be rotated here."
                : isEditing
                ? "Update the server configuration"
                : "Configure a new MCP server connection"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <fieldset className={readOnly ? "opacity-70" : ""}>
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
                  disabled={loading || metadataReadOnly}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Unique identifier for this server (lowercase, no spaces).
                  {id && !id.startsWith("mcp-") && (
                    <> Stored as: <code className="text-xs font-mono text-primary">mcp-{id}</code></>
                  )}
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
                disabled={loading || metadataReadOnly}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What does this server provide?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading || metadataReadOnly}
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
                    disabled={loading || metadataReadOnly}
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
                    disabled={loading || metadataReadOnly}
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
                      disabled={loading || metadataReadOnly}
                      className="font-mono"
                    />
                    <Button type="button" variant="outline" onClick={handleAddArg} disabled={loading || metadataReadOnly}>
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
                            disabled={metadataReadOnly}
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
                      disabled={loading || metadataReadOnly}
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
                            disabled={loading || metadataReadOnly}
                            className="font-mono flex-1"
                          />
                          <Input
                            placeholder="value"
                            value={env.value}
                            onChange={(e) => handleUpdateEnvVar(i, "value", e.target.value)}
                            disabled={loading || metadataReadOnly}
                            className="font-mono flex-[2]"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveEnvVar(i)}
                            disabled={loading || metadataReadOnly}
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
              <div className="space-y-2">
                <Label htmlFor="endpoint">
                  Endpoint URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="endpoint"
                  placeholder={`e.g., http://localhost:3000/${transport === "sse" ? "sse" : "mcp"}`}
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  disabled={loading || metadataReadOnly}
                  className="font-mono"
                />
                {gatewayDiscoveryLoaded && agentGatewayTargets.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Or pick an AgentGateway target — this fills the endpoint with the
                      target-qualified URL (<code className="font-mono">/mcp/&lt;target&gt;</code>) so the
                      gateway can route this server correctly.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {agentGatewayTargets.map((target) => (
                        <Button
                          key={target.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={loading || metadataReadOnly}
                          onClick={() => setEndpoint(target.endpoint)}
                          title={
                            target.target_endpoint
                              ? `${target.endpoint} → ${target.target_endpoint}`
                              : target.endpoint
                          }
                          className="font-mono"
                        >
                          {target.id}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Credential Sources</h3>
                <p className="text-xs text-muted-foreground">
                  Resolve Connections &amp; Secrets refs server-side when impersonation tokens are enabled.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddCredentialSource}
                disabled={loading || credentialReadOnly}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Credential
              </Button>
            </div>
            {credentialSources.length > 0 && (
              <div className="space-y-2">
                {credentialSources.map((source, i) => (
                  <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_2fr_auto]">
                    <select
                      aria-label="Credential kind"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={source.kind}
                      onChange={(event) => handleUpdateCredentialSource(i, "kind", event.target.value)}
                      disabled={credentialReadOnly}
                    >
                      <option value="secret_ref">Secret ref</option>
                      <option value="provider_connection">Provider connection</option>
                    </select>
                    <select
                      aria-label="Credential target"
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={source.target}
                      onChange={(event) => handleUpdateCredentialSource(i, "target", event.target.value)}
                      disabled={credentialReadOnly}
                    >
                      <option value="env">Environment</option>
                      <option value="header">Header</option>
                    </select>
                    <Input
                      aria-label="Credential name"
                      placeholder={source.target === "env" ? "GITHUB_TOKEN" : "Authorization"}
                      value={source.name}
                      onChange={(event) => handleUpdateCredentialSource(i, "name", event.target.value)}
                      disabled={credentialReadOnly}
                    />
                    <Input
                      aria-label="Credential reference"
                      placeholder={source.kind === "secret_ref" ? "secret_ref id" : "provider_connection id"}
                      value={source.kind === "secret_ref" ? source.secret_ref ?? "" : source.provider_connection_id ?? ""}
                      onChange={(event) =>
                        handleUpdateCredentialSource(
                          i,
                          source.kind === "secret_ref" ? "secret_ref" : "provider_connection_id",
                          event.target.value,
                        )
                      }
                      disabled={credentialReadOnly}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCredentialSource(i)}
                      disabled={loading || credentialReadOnly}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
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
            {credentialOnly && (
              <span className="text-xs text-muted-foreground mr-auto">
                AgentGateway-managed — route changes must be made in AgentGateway
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
                ) : credentialOnly ? (
                  "Save Credential Sources"
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
