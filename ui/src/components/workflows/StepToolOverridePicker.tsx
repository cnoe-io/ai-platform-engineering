"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Shield,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BuiltinToolsConfig, DynamicAgentConfig } from "@/types/dynamic-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StepToolOverridePickerProps {
  agentId: string | undefined;
  configOverride: Record<string, unknown> | null;
  onConfigOverrideChange: (override: Record<string, unknown> | null) => void;
  readOnly?: boolean;
}

interface ProbeResult {
  loading: boolean;
  tools?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get enabled builtin tool IDs from an agent config's builtin_tools */
function getEnabledBuiltinTools(builtinTools?: BuiltinToolsConfig | null): string[] {
  if (!builtinTools) return [];
  const enabled: string[] = [];
  for (const [key, value] of Object.entries(builtinTools)) {
    if (key === "workflows") continue; // not a tool
    if (value && typeof value === "object" && "enabled" in value && value.enabled) {
      enabled.push(key);
    }
  }
  return enabled;
}

/** Count summary for the header */
function buildSummary(
  overrideAllowed: Record<string, string[] | boolean> | undefined,
  overrideBuiltin: string[] | undefined,
): string | null {
  if (!overrideAllowed && !overrideBuiltin) return null;

  let serverCount = 0;
  let toolCount = 0;

  if (overrideAllowed) {
    for (const [, val] of Object.entries(overrideAllowed)) {
      if (val === false) continue;
      serverCount++;
      if (val === true) {
        toolCount += 1; // count as "all" (1 indicator)
      } else if (Array.isArray(val)) {
        toolCount += val.length || 1;
      }
    }
  }

  const builtinCount = overrideBuiltin?.length ?? 0;

  const parts: string[] = [];
  if (serverCount > 0) parts.push(`${serverCount} server${serverCount !== 1 ? "s" : ""}`);
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  if (builtinCount > 0) parts.push(`${builtinCount} builtin`);
  return parts.length > 0 ? parts.join(", ") : null;
}

// Tool display names (best effort)
const BUILTIN_TOOL_LABELS: Record<string, string> = {
  fetch_url: "Fetch URL",
  curl: "Curl",
  current_datetime: "Current Date/Time",
  user_info: "User Info",
  wait: "Wait",
  request_user_input: "Request User Input",
  self_identity: "Self Identity",
  format_file: "Format File",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StepToolOverridePicker({
  agentId,
  configOverride,
  onConfigOverrideChange,
  readOnly,
}: StepToolOverridePickerProps) {
  // ── Section collapse state ──
  const [isExpanded, setIsExpanded] = useState(false);

  // ── Agent config (fetched when agentId changes) ──
  const [agentConfig, setAgentConfig] = useState<DynamicAgentConfig | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);

  // ── Server probe state (lazy) ──
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({});

  // ── Derived: base allowed tools & builtin tools from agent ──
  const baseAllowedTools = useMemo(
    () => agentConfig?.allowed_tools ?? {},
    [agentConfig],
  );
  const baseBuiltinTools = useMemo(
    () => getEnabledBuiltinTools(agentConfig?.builtin_tools),
    [agentConfig],
  );

  // ── Derived: current override values ──
  const overrideAllowedTools = useMemo(
    () => configOverride?.allowed_tools as Record<string, string[] | boolean> | undefined,
    [configOverride],
  );
  const overrideBuiltinDisabled = useMemo(
    () => configOverride?.disabled_builtin_tools as string[] | undefined,
    [configOverride],
  );

  const mode: "inherit" | "restrict" = overrideAllowedTools || overrideBuiltinDisabled ? "restrict" : "inherit";

  // ── Fetch agent config ──
  useEffect(() => {
    if (!agentId) {
      setAgentConfig(null);
      return;
    }
    let cancelled = false;
    setAgentLoading(true);
    fetch(`/api/dynamic-agents/agents/${encodeURIComponent(agentId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success) {
          setAgentConfig(json.data);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAgentLoading(false); });
    return () => { cancelled = true; };
  }, [agentId]);

  // ── Probe a server's tools (lazy, on expand) ──
  const probeServer = useCallback((serverId: string) => {
    if (probeResults[serverId]?.tools || probeResults[serverId]?.loading) return;
    setProbeResults((prev) => ({ ...prev, [serverId]: { loading: true } }));
    fetch(`/api/mcp-servers/probe?id=${serverId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data?.tools) {
          setProbeResults((prev) => ({
            ...prev,
            [serverId]: { loading: false, tools: json.data.tools.map((t: { name: string }) => t.name) },
          }));
        } else {
          setProbeResults((prev) => ({
            ...prev,
            [serverId]: { loading: false, error: json.error || "Probe failed" },
          }));
        }
      })
      .catch((err) => {
        setProbeResults((prev) => ({
          ...prev,
          [serverId]: { loading: false, error: err.message },
        }));
      });
  }, [probeResults]);

  const toggleServerExpand = useCallback((serverId: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
        // Probe if needed (server has true/[] meaning "all tools" — need to know what they are)
        const baseVal = baseAllowedTools[serverId];
        if (baseVal === true || (Array.isArray(baseVal) && baseVal.length === 0)) {
          probeServer(serverId);
        }
      }
      return next;
    });
  }, [baseAllowedTools, probeServer]);

  // ── Update helpers ──
  const updateOverride = useCallback(
    (allowedTools: Record<string, string[] | boolean> | undefined, disabledBuiltin: string[] | undefined) => {
      const next = { ...(configOverride || {}) };
      if (allowedTools && Object.keys(allowedTools).length > 0) {
        next.allowed_tools = allowedTools;
      } else {
        delete next.allowed_tools;
      }
      if (disabledBuiltin && disabledBuiltin.length > 0) {
        next.disabled_builtin_tools = disabledBuiltin;
      } else {
        delete next.disabled_builtin_tools;
      }
      onConfigOverrideChange(Object.keys(next).length > 0 ? next : null);
    },
    [configOverride, onConfigOverrideChange],
  );

  const setMode = useCallback(
    (newMode: "inherit" | "restrict") => {
      if (newMode === "inherit") {
        // Remove tool overrides
        updateOverride(undefined, undefined);
      } else {
        // Initialize with base config (all enabled)
        const initial: Record<string, string[] | boolean> = {};
        for (const [sid, val] of Object.entries(baseAllowedTools)) {
          if (val !== false) initial[sid] = val;
        }
        updateOverride(
          Object.keys(initial).length > 0 ? initial : undefined,
          undefined,
        );
      }
    },
    [baseAllowedTools, updateOverride],
  );

  const toggleServer = useCallback(
    (serverId: string) => {
      if (readOnly) return;
      const current = { ...(overrideAllowedTools || {}) };
      if (current[serverId] === false) {
        // Re-enable with base value
        current[serverId] = baseAllowedTools[serverId] ?? true;
      } else {
        current[serverId] = false;
      }
      updateOverride(current, overrideBuiltinDisabled);
    },
    [readOnly, overrideAllowedTools, baseAllowedTools, overrideBuiltinDisabled, updateOverride],
  );

  const toggleServerTool = useCallback(
    (serverId: string, toolName: string) => {
      if (readOnly) return;
      const current = { ...(overrideAllowedTools || {}) };
      const currentVal = current[serverId];

      // Get all tools for this server
      const baseVal = baseAllowedTools[serverId];
      const allTools: string[] = Array.isArray(baseVal)
        ? baseVal
        : (probeResults[serverId]?.tools || []);

      if (currentVal === true || (Array.isArray(currentVal) && currentVal.length === 0)) {
        // Currently "all" — switch to all except this one
        current[serverId] = allTools.filter((t) => t !== toolName);
      } else if (Array.isArray(currentVal)) {
        if (currentVal.includes(toolName)) {
          const filtered = currentVal.filter((t) => t !== toolName);
          if (filtered.length === 0) {
            // No tools left — disable server
            current[serverId] = false;
          } else {
            current[serverId] = filtered;
          }
        } else {
          // Add tool back
          const updated = [...currentVal, toolName];
          // If all tools selected, switch to true
          if (allTools.length > 0 && updated.length === allTools.length) {
            current[serverId] = true;
          } else {
            current[serverId] = updated;
          }
        }
      }

      updateOverride(current, overrideBuiltinDisabled);
    },
    [readOnly, overrideAllowedTools, baseAllowedTools, probeResults, overrideBuiltinDisabled, updateOverride],
  );

  const toggleBuiltinTool = useCallback(
    (toolId: string) => {
      if (readOnly) return;
      const current = [...(overrideBuiltinDisabled || [])];
      const idx = current.indexOf(toolId);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(toolId);
      }
      updateOverride(overrideAllowedTools, current.length > 0 ? current : undefined);
    },
    [readOnly, overrideBuiltinDisabled, overrideAllowedTools, updateOverride],
  );

  // ── Summary for header ──
  const summary = buildSummary(overrideAllowedTools, overrideBuiltinDisabled);

  // ── Don't render if no agent selected ──
  if (!agentId) return null;

  // ── Active servers from base (exclude false) ──
  const activeBaseServers = Object.entries(baseAllowedTools).filter(([, v]) => v !== false);

  return (
    <div className="space-y-2">
      {/* Collapsible header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Shield className="h-3 w-3" />
        <span>Tool Access</span>
        {summary && (
          <span className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
            {summary}
          </span>
        )}
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-3 pl-1">
          {agentLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading agent config...
            </div>
          ) : !agentConfig ? (
            <p className="text-xs text-muted-foreground">Select an agent to configure tool access.</p>
          ) : (
            <>
              {/* Mode toggle */}
              <fieldset disabled={!!readOnly} className="space-y-3">
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="tool-override-mode"
                      checked={mode === "inherit"}
                      onChange={() => setMode("inherit")}
                      className="h-3 w-3"
                    />
                    Inherit from agent (default)
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="tool-override-mode"
                      checked={mode === "restrict"}
                      onChange={() => setMode("restrict")}
                      className="h-3 w-3"
                    />
                    Restrict for this step
                  </label>
                </div>

                {mode === "restrict" && (
                  <div className="space-y-2 border border-border rounded-md p-2">
                    {/* MCP Servers */}
                    {activeBaseServers.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          MCP Servers
                        </p>
                        {activeBaseServers.map(([serverId, baseVal]) => {
                          const overrideVal = overrideAllowedTools?.[serverId];
                          const isEnabled = overrideVal !== false;
                          const isServerExpanded = expandedServers.has(serverId);
                          const probe = probeResults[serverId];

                          // Determine available tools
                          const knownTools: string[] = Array.isArray(baseVal) && baseVal.length > 0
                            ? baseVal
                            : (probe?.tools || []);
                          const needsProbe = (baseVal === true || (Array.isArray(baseVal) && baseVal.length === 0)) && !probe?.tools;

                          // Determine which tools are selected in override
                          const selectedTools: Set<string> | "all" = (() => {
                            if (!isEnabled) return new Set<string>();
                            if (overrideVal === true || (Array.isArray(overrideVal) && overrideVal.length === 0)) return "all";
                            if (Array.isArray(overrideVal)) return new Set(overrideVal);
                            // Fallback: use base
                            if (baseVal === true || (Array.isArray(baseVal) && baseVal.length === 0)) return "all";
                            if (Array.isArray(baseVal)) return new Set(baseVal);
                            return "all";
                          })();

                          return (
                            <div key={serverId} className="border border-border/50 rounded p-1.5">
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={() => toggleServer(serverId)}
                                  className="h-3 w-3"
                                />
                                <button
                                  onClick={() => toggleServerExpand(serverId)}
                                  className="flex items-center gap-1 flex-1 text-left text-xs font-medium text-foreground hover:text-primary transition-colors"
                                >
                                  {isServerExpanded ? (
                                    <ChevronDown className="h-2.5 w-2.5" />
                                  ) : (
                                    <ChevronRight className="h-2.5 w-2.5" />
                                  )}
                                  <span className="truncate">{serverId}</span>
                                </button>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {!isEnabled
                                    ? "disabled"
                                    : selectedTools === "all"
                                    ? "all tools"
                                    : `${selectedTools.size} tool${selectedTools.size !== 1 ? "s" : ""}`}
                                </span>
                              </div>

                              {isServerExpanded && isEnabled && (
                                <div className="mt-1.5 ml-5 space-y-0.5">
                                  {probe?.loading ? (
                                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      Probing tools...
                                    </div>
                                  ) : probe?.error ? (
                                    <p className="text-[10px] text-destructive">{probe.error}</p>
                                  ) : needsProbe ? (
                                    <p className="text-[10px] text-muted-foreground">Expand to probe tools</p>
                                  ) : knownTools.length === 0 ? (
                                    <p className="text-[10px] text-muted-foreground">No tools discovered</p>
                                  ) : (
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                      {knownTools.map((tool) => (
                                        <label
                                          key={tool}
                                          className="flex items-center gap-1.5 text-[10px] cursor-pointer"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selectedTools === "all" || selectedTools.has(tool)}
                                            onChange={() => toggleServerTool(serverId, tool)}
                                            className="h-2.5 w-2.5"
                                          />
                                          <span className="font-mono truncate max-w-[140px]">{tool}</span>
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Builtin Tools */}
                    {baseBuiltinTools.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Builtin Tools
                        </p>
                        <div className="border border-border/50 rounded p-1.5 space-y-0.5">
                          {baseBuiltinTools.map((toolId) => {
                            const isDisabled = overrideBuiltinDisabled?.includes(toolId) ?? false;
                            return (
                              <div key={toolId} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={!isDisabled}
                                  onChange={() => toggleBuiltinTool(toolId)}
                                  className="h-3 w-3"
                                />
                                <span className="text-xs">
                                  {BUILTIN_TOOL_LABELS[toolId] || toolId}
                                </span>
                                {toolId === "request_user_input" && isDisabled && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    Agent cannot ask questions
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeBaseServers.length === 0 && baseBuiltinTools.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        This agent has no tools configured.
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
            </>
          )}
        </div>
      )}
    </div>
  );
}
