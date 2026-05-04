"use client";

/**
 * ToolsTab — manage the skill's `allowed-tools` list.
 *
 * UI/UX is modeled on the Dynamic Agents pickers
 * (`BuiltinToolsPicker` + `AllowedToolsPicker`) so authors get the same
 * experience: a toggle list of known built-ins and a collapsible MCP
 * server list with on-demand tool probing. The on-disk shape is still a
 * flat `string[]` in SKILL.md frontmatter — the helpers in
 * `tools-strings.ts` translate between the two.
 *
 * Frontmatter remains the source of truth via `useSkillForm`'s
 * tools↔frontmatter sync; this component only mutates `allowedTools`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Info,
  Loader2,
  Plus,
  Search,
  Server,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UseSkillFormResult } from "@/components/skills/workspace/use-skill-form";
import type {
  BuiltinToolDefinition,
  MCPServerConfig,
  MCPToolInfo,
} from "@/types/dynamic-agent";
import {
  composeAllowedTools,
  encodeMcpTool,
  partitionAllowedTools,
} from "./tools-strings";

export interface ToolsTabProps {
  form: UseSkillFormResult;
}

interface ProbeState {
  loading: boolean;
  tools?: MCPToolInfo[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Built-ins fetch
// ---------------------------------------------------------------------------

function useBuiltinDefinitions(): {
  definitions: BuiltinToolDefinition[];
  loading: boolean;
  error: string | null;
} {
  const [definitions, setDefinitions] = useState<BuiltinToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dynamic-agents/builtin-tools");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setDefinitions(json.data || []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load built-in tools",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { definitions, loading, error };
}

// ---------------------------------------------------------------------------
// MCP servers fetch
// ---------------------------------------------------------------------------

function useMcpServers(): {
  servers: MCPServerConfig[];
  loading: boolean;
  error: string | null;
} {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mcp-servers?page_size=100");
        const json = await res.json();
        if (!cancelled) {
          if (json.success) {
            setServers(
              (json.data?.items || []).filter(
                (s: MCPServerConfig) => s.enabled,
              ),
            );
          } else {
            setError(json.error || "Failed to load MCP servers");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load MCP servers",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { servers, loading, error };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToolsTab({ form }: ToolsTabProps) {
  const { allowedTools, setAllowedTools } = form;
  const {
    definitions: builtinDefs,
    loading: builtinsLoading,
    error: builtinsError,
  } = useBuiltinDefinitions();
  const {
    servers,
    loading: serversLoading,
    error: serversError,
  } = useMcpServers();

  const knownBuiltinIds = useMemo(
    () => new Set(builtinDefs.map((d) => d.id)),
    [builtinDefs],
  );

  // Always re-derive partitions from the source of truth so external edits
  // (frontmatter resync, AI assist, undo) flow through naturally.
  const partition = useMemo(
    () => partitionAllowedTools(allowedTools, knownBuiltinIds),
    [allowedTools, knownBuiltinIds],
  );

  // ---- Mutators -----------------------------------------------------------

  const writePartition = useCallback(
    (
      builtins: string[],
      mcpByServer: Record<string, string[]>,
      custom: string[],
    ) => {
      const next = composeAllowedTools(builtins, mcpByServer, custom);
      const same =
        next.length === allowedTools.length &&
        next.every((t, i) => t === allowedTools[i]);
      if (!same) setAllowedTools(next);
    },
    [allowedTools, setAllowedTools],
  );

  const toggleBuiltin = useCallback(
    (id: string) => {
      const has = partition.builtins.includes(id);
      const builtins = has
        ? partition.builtins.filter((t) => t !== id)
        : [...partition.builtins, id];
      writePartition(builtins, partition.mcpByServer, partition.custom);
    },
    [partition, writePartition],
  );

  const setMcpForServer = useCallback(
    (serverId: string, tools: string[]) => {
      const next = { ...partition.mcpByServer };
      if (tools.length === 0) {
        delete next[serverId];
      } else {
        next[serverId] = tools;
      }
      writePartition(partition.builtins, next, partition.custom);
    },
    [partition, writePartition],
  );

  const removeCustom = useCallback(
    (entry: string) => {
      writePartition(
        partition.builtins,
        partition.mcpByServer,
        partition.custom.filter((c) => c !== entry),
      );
    },
    [partition, writePartition],
  );

  const addCustom = useCallback(
    (raw: string) => {
      const v = raw.trim();
      if (!v) return;
      if (allowedTools.includes(v)) return;
      writePartition(partition.builtins, partition.mcpByServer, [
        ...partition.custom,
        v,
      ]);
    },
    [allowedTools, partition, writePartition],
  );

  const clearAll = useCallback(() => {
    if (allowedTools.length === 0) return;
    setAllowedTools([]);
  }, [allowedTools.length, setAllowedTools]);

  // ---- Render -------------------------------------------------------------

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Wrench className="h-4 w-4" />
            Allowed tools
          </h2>
          <a
            href="https://code.claude.com/docs/en/skills#pre-approve-tools-for-a-skill"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            allowed-tools reference
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          Pre-approves the listed tools while this skill is active so the
          agent can use them without prompting. It does <em>not</em> hide
          other tools — every tool stays callable, governed by your
          permission settings. Saved into SKILL.md frontmatter as{" "}
          <code>allowed-tools</code> (space-separated). Argument scoping
          like <code>Bash(git add *)</code> is supported via custom strings
          below.
        </p>
      </header>

      <BuiltinToolsSection
        definitions={builtinDefs}
        loading={builtinsLoading}
        error={builtinsError}
        selected={partition.builtins}
        onToggle={toggleBuiltin}
      />

      <McpServersSection
        servers={servers}
        loading={serversLoading}
        error={serversError}
        mcpByServer={partition.mcpByServer}
        onChange={setMcpForServer}
      />

      <CustomToolsSection
        custom={partition.custom}
        onAdd={addCustom}
        onRemove={removeCustom}
      />

      <FooterSummary
        allowedTools={allowedTools}
        onClearAll={clearAll}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Built-in tools section
// ---------------------------------------------------------------------------

function BuiltinToolsSection({
  definitions,
  loading,
  error,
  selected,
  onToggle,
}: {
  definitions: BuiltinToolDefinition[];
  loading: boolean;
  error: string | null;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <section className="space-y-2" aria-label="Built-in tools">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Globe className="h-3.5 w-3.5 text-purple-400" />
        Built-in tools
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading built-in tool catalog…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Couldn’t load built-in tools ({error}). You can still add custom
          tool ids below.
        </div>
      )}

      {!loading && !error && definitions.length === 0 && (
        <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          No built-in tools available.
        </div>
      )}

      {!loading && definitions.length > 0 && (
        <div className="space-y-1.5">
          {definitions.map((def) => {
            const on = selected.includes(def.id);
            return (
              <div
                key={def.id}
                data-testid={`builtin-tool-${def.id}`}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-1.5 transition-colors",
                  on
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-muted/30",
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Toggle ${def.id}`}
                    onClick={() => onToggle(def.id)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                      on ? "bg-green-500" : "bg-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200",
                        on ? "translate-x-4" : "translate-x-0",
                      )}
                    />
                  </button>
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-medium">
                      {def.id}
                    </span>
                    {def.description && (
                      <span className="text-xs text-muted-foreground ml-2">
                        {def.description}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// MCP servers section (collapsible per-server tool probe)
// ---------------------------------------------------------------------------

function McpServersSection({
  servers,
  loading,
  error,
  mcpByServer,
  onChange,
}: {
  servers: MCPServerConfig[];
  loading: boolean;
  error: string | null;
  mcpByServer: Record<string, string[]>;
  onChange: (serverId: string, tools: string[]) => void;
}) {
  // Synthesize "phantom" servers for any serverId already referenced in
  // allowed-tools but not present in the live catalog (e.g. server was
  // removed). Keeps existing entries visible & removable.
  const knownIds = new Set(servers.map((s) => s._id));
  const phantomIds = Object.keys(mcpByServer).filter((id) => !knownIds.has(id));

  return (
    <section className="space-y-2" aria-label="MCP servers">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Server className="h-3.5 w-3.5 text-blue-400" />
        MCP servers & tools
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading MCP servers…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Couldn’t load MCP servers ({error}). You can still add custom MCP
          tool strings below.
        </div>
      )}

      {!loading && !error && servers.length === 0 && phantomIds.length === 0 && (
        <div className="rounded-lg border bg-muted/20 px-3 py-3 text-center text-xs text-muted-foreground space-y-2">
          <Server className="h-6 w-6 text-muted-foreground/70 mx-auto" />
          <p>
            No enabled MCP servers found. Skills share the same MCP catalog
            as Dynamic Agents.
          </p>
          <a
            href="/dynamic-agents?tab=mcp-servers"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Manage MCP servers →
          </a>
        </div>
      )}

      {servers.map((server) => (
        <McpServerRow
          key={server._id}
          server={server}
          selectedTools={mcpByServer[server._id] || []}
          onChange={(tools) => onChange(server._id, tools)}
        />
      ))}

      {phantomIds.map((id) => (
        <PhantomMcpServerRow
          key={id}
          serverId={id}
          tools={mcpByServer[id] || []}
          onChange={(tools) => onChange(id, tools)}
        />
      ))}
    </section>
  );
}

function McpServerRow({
  server,
  selectedTools,
  onChange,
}: {
  server: MCPServerConfig;
  selectedTools: string[];
  onChange: (tools: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(selectedTools.length > 0);
  const [probe, setProbe] = useState<ProbeState>({ loading: false });
  const [search, setSearch] = useState("");
  const probedRef = useRef(false);

  const runProbe = useCallback(async () => {
    setProbe({ loading: true });
    try {
      const res = await fetch(`/api/mcp-servers/probe?id=${server._id}`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        setProbe({ loading: false, tools: json.data?.tools ?? [] });
      } else {
        setProbe({ loading: false, error: json.error || "Probe failed" });
      }
    } catch (err) {
      setProbe({
        loading: false,
        error: err instanceof Error ? err.message : "Probe failed",
      });
    }
  }, [server._id]);

  const handleToggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && !probedRef.current && !probe.tools && !probe.loading) {
        probedRef.current = true;
        void runProbe();
      }
      return next;
    });
  };

  const toggleTool = (toolName: string) => {
    if (selectedTools.includes(toolName)) {
      onChange(selectedTools.filter((t) => t !== toolName));
    } else {
      onChange([...selectedTools, toolName]);
    }
  };

  const filteredTools = useMemo(() => {
    if (!probe.tools) return [];
    const q = search.trim().toLowerCase();
    if (!q) return probe.tools;
    return probe.tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q),
    );
  }, [probe.tools, search]);

  // Tools that were already configured but didn't come back from probe.
  const probeNames = new Set((probe.tools ?? []).map((t) => t.name));
  const orphanTools = probe.tools
    ? selectedTools.filter((t) => !probeNames.has(t))
    : [];

  const hasSelection = selectedTools.length > 0;
  const showSearch = (probe.tools?.length ?? 0) > 5;

  return (
    <div
      data-testid={`mcp-server-${server._id}`}
      className={cn(
        "rounded-lg border transition-colors",
        hasSelection ? "border-primary/50 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={handleToggleExpanded}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <Server className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="font-medium text-sm truncate">{server.name}</span>
          <span className="text-[11px] font-mono text-muted-foreground/70 truncate">
            {server._id}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {hasSelection && (
            <Badge variant="secondary" className="text-xs">
              {selectedTools.length}
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={runProbe}
            disabled={probe.loading}
            className="h-7 px-2"
            aria-label={`Probe ${server.name}`}
          >
            {probe.loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Zap className="h-3 w-3 mr-1" />
                <span className="text-xs">Probe</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          {probe.error && (
            <p className="text-xs text-destructive">{probe.error}</p>
          )}

          {!probe.error && !probe.tools && !probe.loading && (
            <p className="text-xs text-muted-foreground">
              Click <span className="font-medium">Probe</span> to discover
              tools on this server.
            </p>
          )}

          {showSearch && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tools…"
                className="h-7 text-xs pl-7"
              />
            </div>
          )}

          {probe.tools && probe.tools.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {filteredTools.map((tool) => {
                const on = selectedTools.includes(tool.name);
                return (
                  <ToolPickRow
                    key={tool.namespaced_name || tool.name}
                    name={tool.name}
                    description={tool.description}
                    selected={on}
                    onToggle={() => toggleTool(tool.name)}
                  />
                );
              })}
            </div>
          )}

          {probe.tools && filteredTools.length === 0 && search && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No tools match “{search}”.
            </p>
          )}

          {orphanTools.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-amber-600 dark:text-amber-400">
                These tools are saved on the skill but the server didn’t
                return them:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {orphanTools.map((t) => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="gap-1 text-xs font-mono"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => toggleTool(t)}
                      aria-label={`Remove ${t}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhantomMcpServerRow({
  serverId,
  tools,
  onChange,
}: {
  serverId: string;
  tools: string[];
  onChange: (tools: string[]) => void;
}) {
  return (
    <div
      data-testid={`mcp-server-phantom-${serverId}`}
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2"
    >
      <div className="flex items-center gap-2 text-xs">
        <Server className="h-3.5 w-3.5 text-amber-500" />
        <span className="font-medium">Unknown server</span>
        <span className="font-mono text-muted-foreground">{serverId}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        These tools reference an MCP server that isn’t registered here.
        Remove or re-add the server in “MCP Servers”.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <Badge
            key={t}
            variant="secondary"
            className="gap-1 text-xs font-mono"
          >
            {encodeMcpTool(serverId, t)}
            <button
              type="button"
              onClick={() => onChange(tools.filter((x) => x !== t))}
              aria-label={`Remove ${encodeMcpTool(serverId, t)}`}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ToolPickRow({
  name,
  description,
  selected,
  onToggle,
}: {
  name: string;
  description?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded p-1.5 text-left transition-colors text-xs",
        selected
          ? "bg-primary/10 border border-primary/30"
          : "bg-muted/30 hover:bg-muted/50 border border-transparent",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 mt-0.5",
          selected
            ? "bg-primary border-primary text-primary-foreground"
            : "border-muted-foreground/30",
        )}
        aria-pressed={selected}
        aria-label={`Toggle ${name}`}
      >
        {selected && <Check className="h-2.5 w-2.5" />}
      </button>
      <button
        type="button"
        onClick={onToggle}
        className="flex-1 min-w-0 text-left"
      >
        <span className="font-mono truncate block">{name}</span>
        {description && (
          <span className="text-[10px] text-muted-foreground truncate block">
            {description}
          </span>
        )}
      </button>
      {description && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
                aria-label={`More info about ${name}`}
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs whitespace-normal">
              <p className="text-xs">{description}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom tools section
// ---------------------------------------------------------------------------

function CustomToolsSection({
  custom,
  onAdd,
  onRemove,
}: {
  custom: string[];
  onAdd: (raw: string) => void;
  onRemove: (entry: string) => void;
}) {
  const [input, setInput] = useState("");

  const submit = () => {
    onAdd(input);
    setInput("");
  };

  return (
    <section className="space-y-1.5" aria-label="Custom tools">
      <div className="text-xs font-medium text-muted-foreground">
        Custom tool strings
      </div>
      <p className="text-[11px] text-muted-foreground">
        Free-form entries written verbatim into <code>allowed-tools</code> —
        useful for argument-scoped pre-approvals (
        <code>Bash(git add *)</code>, <code>Bash(gh *)</code>) or any tool
        not in the catalog above. See the{" "}
        <a
          href="https://code.claude.com/docs/en/skills#pre-approve-tools-for-a-skill"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Claude allowed-tools reference
        </a>
        .
      </p>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Bash(git add *) or mcp__server__tool"
          className="h-8 text-xs font-mono"
          aria-label="Custom tool entry"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={submit}
          disabled={!input.trim()}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>
      {custom.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {custom.map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="gap-1 text-xs font-mono"
            >
              {t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                aria-label={`Remove ${t}`}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer summary
// ---------------------------------------------------------------------------

function FooterSummary({
  allowedTools,
  onClearAll,
}: {
  allowedTools: string[];
  onClearAll: () => void;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {allowedTools.length === 0 ? (
        <>
          No pre-approvals — the agent will be prompted for permission on
          every tool call. Toggle a built-in or pick MCP tools above to
          pre-approve them while this skill is active.
        </>
      ) : (
        <>
          {allowedTools.length} tool{allowedTools.length === 1 ? "" : "s"}{" "}
          pre-approved:{" "}
          <span className="font-mono">{allowedTools.join(" ")}</span>
        </>
      )}
      {allowedTools.length > 0 && (
        <Button
          variant="link"
          size="sm"
          className="ml-2 h-auto p-0 text-xs"
          onClick={onClearAll}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Clear all
        </Button>
      )}
    </div>
  );
}
