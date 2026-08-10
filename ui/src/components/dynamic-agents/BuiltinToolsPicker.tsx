"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
Tooltip,
TooltipContent,
TooltipProvider,
TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
BuiltinToolConfigField,
BuiltinToolDefinition,
BuiltinToolsConfig,
GenericToolConfig,
MCPServerConfig,
MCPToolInfo,
MemoryToolConfig,
NamespaceScopedToolsConfig,
} from "@/types/dynamic-agent";
import { ChevronDown,ChevronRight,Globe,Info,Loader2,Play,Settings } from "lucide-react";
import React from "react";
import YAML from "yaml";

interface BuiltinToolsPickerProps {
  value: BuiltinToolsConfig | undefined;
  onChange: (value: BuiltinToolsConfig) => void;
  disabled?: boolean;
}

/**
 * Hook to fetch builtin tool definitions from the API.
 */
function useBuiltinToolDefinitions() {
  const [definitions, setDefinitions] = React.useState<BuiltinToolDefinition[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchDefinitions() {
      try {
        const response = await fetch("/api/dynamic-agents/builtin-tools");
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        const data = await response.json();
        // Backend returns `{ success: true, data: { tools: [...] } }`.
        // Older proxy unwrapped to `{ success: true, data: [...] }`.
        // Accept both shapes for forward/backward compat.
        const tools = Array.isArray(data.data)
          ? data.data
          : (data.data?.tools ?? []);
        setDefinitions(tools);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        // Fallback to empty array - UI will still work, just without dynamic tools
        setDefinitions([]);
      } finally {
        setLoading(false);
      }
    }
    fetchDefinitions();
  }, []);

  return { definitions, loading, error };
}

/**
 * Get the default value for a config field.
 */
function getFieldDefault(field: BuiltinToolConfigField): string | number | boolean {
  if (field.default !== undefined) {
    return field.default;
  }
  switch (field.type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return "";
  }
}

/**
 * Individual tool configuration component.
 */
function ToolConfig({
  definition,
  config,
  onChange,
  disabled,
}: {
  definition: BuiltinToolDefinition;
  config: GenericToolConfig | undefined;
  onChange: (config: GenericToolConfig) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const isEnabled = config?.enabled ?? definition.enabled_by_default;
  const hasConfigFields = definition.config_fields.length > 0;

  const handleEnabledChange = (enabled: boolean) => {
    // Build default config with field defaults when enabling
    const defaults: Record<string, unknown> = {};
    for (const field of definition.config_fields) {
      defaults[field.name] = config?.[field.name] ?? getFieldDefault(field);
    }
    onChange({
      ...defaults,
      ...config,
      enabled,
    });
    // Auto-expand when enabling if there are config fields
    if (enabled && hasConfigFields) {
      setExpanded(true);
    }
  };

  const handleFieldChange = (fieldName: string, value: unknown) => {
    onChange({
      ...config,
      enabled: isEnabled,
      [fieldName]: value,
    });
  };

  return (
    <div
      className={cn(
        "border rounded-lg transition-colors",
        isEnabled ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      {/* Tool Header Row */}
      <div className="flex items-center justify-between px-3 py-1">
        <div className="flex items-center gap-2">
          {/* Toggle Switch */}
          <button
            type="button"
            onClick={() => handleEnabledChange(!isEnabled)}
            disabled={disabled}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              isEnabled ? "bg-green-500" : "bg-muted-foreground/30",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            role="switch"
            aria-checked={isEnabled}
            aria-label={`Enable ${definition.name}`}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                isEnabled ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>

          <div>
            <span className="font-mono text-sm font-medium">{definition.id}</span>
            <span className="text-xs text-muted-foreground ml-2">
              {definition.description}
            </span>
          </div>
        </div>

        {isEnabled && hasConfigFields && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-7 px-2"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 mr-1" />
            ) : (
              <ChevronRight className="h-3 w-3 mr-1" />
            )}
            <Settings className="h-3 w-3 mr-1" />
            <span className="text-xs">Configure</span>
          </Button>
        )}
      </div>

      {/* Expanded Configuration */}
      {isEnabled && hasConfigFields && expanded && (
        <div className="border-t px-3 py-1 bg-muted/30 space-y-2">
          {definition.config_fields.map((field) => (
            <ConfigField
              key={field.name}
              field={field}
              value={config?.[field.name] ?? getFieldDefault(field)}
              onChange={(value) => handleFieldChange(field.name, value)}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {definition.id === "memory" && isEnabled && (
        <MemoryToolSection
          value={(config || { enabled: true }) as MemoryToolConfig}
          onChange={(next) => onChange(next as unknown as GenericToolConfig)}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function schemaProperties(tool: MCPToolInfo): string[] {
  const schema = tool.inputSchema ?? tool.input_schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const properties = (schema as { properties?: unknown }).properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? Object.keys(properties)
    : [];
}

export function suggestNamespaceBindings(
  server: string,
  tools: MCPToolInfo[],
  bindArg: string,
  sourceTool?: string,
): NamespaceScopedToolsConfig[] {
  const matches = tools
    .filter((tool) => tool.name !== sourceTool && schemaProperties(tool).includes(bindArg))
    .map((tool) => tool.name);
  return matches.length > 0
    ? [{ server, tools: matches, bind_arg: bindArg, require_namespace: true }]
    : [];
}

function decodeSample(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = (value as { result?: unknown }).result ?? value;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length !== 1) return result;
  const text = (content[0] as { text?: unknown } | undefined)?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sampleLeafPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.length > 0 ? sampleLeafPaths(value[0], `${prefix}[]`) : [];
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      sampleLeafPaths(child, prefix ? `${prefix}.${key}` : key)
    );
  }
  return prefix ? [prefix] : [];
}

function MemoryToolSection({
  value,
  onChange,
  disabled,
}: {
  value: MemoryToolConfig;
  onChange: (value: MemoryToolConfig) => void;
  disabled?: boolean;
}) {
  const [servers, setServers] = React.useState<MCPServerConfig[]>([]);
  const [tools, setTools] = React.useState<MCPToolInfo[]>([]);
  const [loadingTools, setLoadingTools] = React.useState(false);
  const [argsText, setArgsText] = React.useState(() =>
    JSON.stringify(value.namespace_source?.args || {}, null, 2)
  );
  const [sample, setSample] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);
  const source = value.namespace_source;

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/mcp-servers?page_size=100")
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setServers(Array.isArray(payload.data?.items) ? payload.data.items : []);
      })
      .catch(() => {
        if (!cancelled) setServers([]);
      });
    return () => { cancelled = true; };
  }, []);

  const updateSource = (patch: Partial<NonNullable<MemoryToolConfig["namespace_source"]>>) => {
    const next = {
      server: source?.server || "",
      tool: source?.tool || "",
      args: source?.args || {},
      key_path: source?.key_path || "",
      label_path: source?.label_path || "",
      ...patch,
    };
    onChange({ ...value, namespace_source: next });
  };

  const probe = async (serverId: string) => {
    setLoadingTools(true);
    setError(null);
    setTools([]);
    try {
      const response = await fetch(`/api/mcp-servers/probe?id=${encodeURIComponent(serverId)}`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success || payload.data?.success === false) {
        throw new Error(payload.data?.error || payload.error || "Could not load tools");
      }
      setTools(Array.isArray(payload.data?.tools) ? payload.data.tools : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tools");
    } finally {
      setLoadingTools(false);
    }
  };

  const runSample = async () => {
    if (!source?.server || !source.tool) return;
    setError(null);
    try {
      const args = JSON.parse(argsText || "{}") as unknown;
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("Arguments must be a JSON object");
      }
      const response = await fetch("/api/mcp-servers/test-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: source.server, toolName: source.tool, params: args }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Tool call failed");
      setSample(decodeSample(payload.data));
      updateSource({ args: args as Record<string, unknown> });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tool call failed");
    }
  };

  const bindArg = source?.key_path?.replace(/\[\]/g, "").split(".").at(-1) || "";
  const suggested = source?.server && bindArg
    ? suggestNamespaceBindings(source.server, tools, bindArg, source.tool)
    : [];
  const sourceBindings = new Map<string, boolean>();
  for (const binding of value.namespace_scoped_tools || []) {
    if (binding.server !== source?.server || binding.bind_arg !== bindArg) continue;
    for (const toolName of binding.tools) {
      sourceBindings.set(toolName, binding.require_namespace);
    }
  }
  const selected = new Set(sourceBindings.keys());

  const writeSourceBindings = (next: Map<string, boolean>) => {
    const other = (value.namespace_scoped_tools || []).filter(
      (item) => item.server !== source?.server || item.bind_arg !== bindArg,
    );
    onChange({
      ...value,
      namespace_scoped_tools: [
        ...other,
        ...Array.from(next, ([toolName, requireNamespace]) => ({
          server: source?.server || "",
          tools: [toolName],
          bind_arg: bindArg,
          require_namespace: requireNamespace,
        })),
      ],
    });
  };

  const toggleSuggested = (toolName: string) => {
    if (!source?.server || !bindArg) return;
    const next = new Map(sourceBindings);
    if (next.has(toolName)) next.delete(toolName); else next.set(toolName, true);
    writeSourceBindings(next);
  };

  const toggleRequired = (toolName: string) => {
    const next = new Map(sourceBindings);
    next.set(toolName, !(next.get(toolName) ?? true));
    writeSourceBindings(next);
  };

  return (
    <div className="space-y-3 border-t bg-muted/20 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium">Memory namespaces</p>
          <p className="text-xs text-muted-foreground">Choose a list tool, sample its response, then select key and label fields.</p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={value.allow_custom ?? false}
            onChange={(event) => onChange({ ...value, allow_custom: event.target.checked })}
            disabled={disabled}
          />
          Allow custom
        </label>
      </div>

      <div className="space-y-2 rounded-md border bg-background/50 p-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">Static contexts</p>
            <p className="text-xs text-muted-foreground">Optional contexts that do not come from the MCP list tool.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const namespaces = [...(value.namespaces || [])];
              let index = namespaces.length + 1;
              while (namespaces.some((item) => item.key === `context-${index}`)) index += 1;
              namespaces.push({ key: `context-${index}`, label: `Context ${index}` });
              onChange({ ...value, namespaces });
            }}
          >
            Add static
          </Button>
        </div>
        {(value.namespaces || []).map((namespace, index) => (
          <div key={`${namespace.key}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input
              aria-label={`Static context ${index + 1} key`}
              value={namespace.key}
              disabled={disabled}
              className="h-8 font-mono text-xs"
              onChange={(event) => {
                const namespaces = [...(value.namespaces || [])];
                namespaces[index] = { ...namespace, key: event.target.value.toLowerCase() };
                onChange({ ...value, namespaces });
              }}
            />
            <Input
              aria-label={`Static context ${index + 1} label`}
              value={namespace.label}
              disabled={disabled}
              className="h-8 text-xs"
              onChange={(event) => {
                const namespaces = [...(value.namespaces || [])];
                namespaces[index] = { ...namespace, label: event.target.value };
                onChange({ ...value, namespaces });
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange({
                ...value,
                namespaces: (value.namespaces || []).filter((_, itemIndex) => itemIndex !== index),
              })}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={source?.server || ""}
          disabled={disabled}
          onChange={(event) => {
            if (!event.target.value) {
              onChange({ ...value, namespace_source: undefined });
              setTools([]);
              setSample(null);
              return;
            }
            updateSource({ server: event.target.value, tool: "", key_path: "", label_path: "" });
            setSample(null);
            void probe(event.target.value);
          }}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="">Select MCP server…</option>
          {servers.map((server) => <option key={server._id} value={server._id}>{server.name}</option>)}
        </select>
        <select
          value={source?.tool || ""}
          disabled={disabled || loadingTools || !source?.server}
          onChange={(event) => updateSource({ tool: event.target.value })}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="">{loadingTools ? "Loading tools…" : "Select list tool…"}</option>
          {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
        </select>
      </div>

      <div className="flex gap-2">
        <Input
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
          aria-label="Namespace source arguments"
          className="h-8 font-mono text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => void runSample()} disabled={disabled || !source?.tool}>
          <Play className="h-3 w-3" /> Sample
        </Button>
      </div>

      {sample !== null && (
        <div className="rounded-md border bg-background p-2">
          <p className="mb-1 text-xs text-muted-foreground">Click once for the key, then for the label:</p>
          <div className="flex flex-wrap gap-1">
            {sampleLeafPaths(sample).map((path) => (
              <Button
                key={path}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 font-mono text-xs"
                onClick={() => updateSource(source?.key_path ? { label_path: path } : { key_path: path })}
              >
                {path}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={source?.key_path || ""} onChange={(event) => updateSource({ key_path: event.target.value })} placeholder="Key path, e.g. pods[].pod_id" className="h-8 font-mono text-xs" />
        <Input value={source?.label_path || ""} onChange={(event) => updateSource({ label_path: event.target.value })} placeholder="Label path, e.g. pods[].pod_name" className="h-8 font-mono text-xs" />
      </div>

      {suggested.flatMap((group) => group.tools).length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium">Suggested trusted bindings for <code>{bindArg}</code></p>
          <div className="space-y-1.5">
            {suggested.flatMap((group) => group.tools).map((toolName) => (
              <div key={toolName} className="flex items-center justify-between gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={selected.has(toolName)} onChange={() => toggleSuggested(toolName)} disabled={disabled} />
                  {toolName}
                </label>
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={sourceBindings.get(toolName) ?? true}
                    onChange={() => toggleRequired(toolName)}
                    disabled={disabled || !selected.has(toolName)}
                  />
                  Require context
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Generated YAML</summary>
        <pre className="mt-1 overflow-auto rounded-md bg-background p-2 text-xs">{YAML.stringify({ builtin_tools: { memory: value } })}</pre>
      </details>
    </div>
  );
}

/**
 * Individual config field renderer.
 */
function ConfigField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: BuiltinToolConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  // Render based on field type
  if (field.type === "string") {
    const stringValue = typeof value === "string" ? value : String(value ?? "");
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor={field.name} className="text-xs">
            {field.label}
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">{field.description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Input
          id={field.name}
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default !== undefined ? String(field.default) : undefined}
          disabled={disabled}
          className="font-mono text-xs h-8"
        />
        {field.name === "allowed_domains" && (
          <p className="text-xs text-muted-foreground">
            {stringValue === "*" ? (
              <span className="text-amber-500">All domains allowed</span>
            ) : stringValue.trim() === "" ? (
              <span className="text-red-500">No domains allowed</span>
            ) : (
              <span>
                {stringValue.split(",").filter((d) => d.trim()).length} pattern(s)
              </span>
            )}
          </p>
        )}
      </div>
    );
  }

  if (field.type === "number") {
    const numValue = typeof value === "number" ? value : Number(value ?? field.default ?? 0);
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor={field.name} className="text-xs">
            {field.label}
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">{field.description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Input
          id={field.name}
          type="number"
          value={numValue}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="font-mono text-xs h-8 w-32"
        />
      </div>
    );
  }

  if (field.type === "boolean") {
    const boolValue = typeof value === "boolean" ? value : Boolean(value);
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(!boolValue)}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
            boolValue ? "bg-green-500" : "bg-muted-foreground/30",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          role="switch"
          aria-checked={boolValue}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              boolValue ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
        <Label htmlFor={field.name} className="text-xs">
          {field.label}
        </Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <p className="text-xs">{field.description}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return null;
}

export function BuiltinToolsPicker({ value, onChange, disabled }: BuiltinToolsPickerProps) {
  const { definitions, loading, error } = useBuiltinToolDefinitions();

  // Track whether we've initialized defaults for the current definitions.
  // This prevents infinite loops since onChange updates value.
  const initializedRef = React.useRef(false);
  const definitionsKey = definitions.map((d) => d.id).join(",");

  // Reset initialization flag when definitions change
  React.useEffect(() => {
    initializedRef.current = false;
  }, [definitionsKey]);

  // Initialize default-enabled tools in the config when definitions load.
  // This ensures tools with enabled_by_default: true get persisted to MongoDB
  // even if the user never explicitly toggles them.
  React.useEffect(() => {
    if (definitions.length === 0 || initializedRef.current) return;

    // Check if any default-enabled tools are missing from the config
    const missingDefaults: Record<string, GenericToolConfig> = {};

    for (const definition of definitions) {
      // Cast to access config by dynamic key
      const toolConfig = (value as Record<string, GenericToolConfig | undefined>)?.[definition.id];
      if (definition.enabled_by_default && !toolConfig) {
        // Build default config with field defaults
        const defaults: Record<string, unknown> = {};
        for (const field of definition.config_fields) {
          defaults[field.name] = getFieldDefault(field);
        }
        missingDefaults[definition.id] = {
          ...defaults,
          enabled: true,
        };
      }
    }

    // Mark as initialized regardless of whether we needed to add defaults
    initializedRef.current = true;

    // Only call onChange if there are missing defaults to add
    if (Object.keys(missingDefaults).length > 0) {
      onChange({
        ...value,
        ...missingDefaults,
      } as BuiltinToolsConfig);
    }
  }, [definitions, value, onChange]);

  const handleToolChange = (
    toolId: string,
    config: GenericToolConfig
  ) => {
    onChange({
      ...value,
      [toolId]: config,
    } as BuiltinToolsConfig);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4 text-purple-400" />
          Built-in Tools
        </Label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tools...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4 text-purple-400" />
          Built-in Tools
        </Label>
        <div className="text-sm text-red-500 p-3 border border-red-500/30 rounded-lg">
          Failed to load tools: {error}
        </div>
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4 text-purple-400" />
          Built-in Tools
        </Label>
        <div className="text-sm text-muted-foreground p-3 border rounded-lg">
          No built-in tools available.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-sm">
        <Globe className="h-4 w-4 text-purple-400" />
        Built-in Tools
      </Label>

      <div className="space-y-1.5">
        {definitions.map((definition) => (
          <ToolConfig
            key={definition.id}
            definition={definition}
            config={(value as Record<string, GenericToolConfig | undefined>)?.[definition.id]}
            onChange={(config) => handleToolChange(definition.id, config)}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
