"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Settings2, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InterruptOn, InterruptToolConfig, DecisionType, BuiltinToolsConfig } from "@/types/dynamic-agent";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface InterruptRow {
  id: string;
  namespace: string;
  tool: string;
  mode: "default" | "custom";
  allowed_decisions: DecisionType[];
}

interface InterruptConfigPickerProps {
  value: InterruptOn;
  onChange: (value: InterruptOn) => void;
  allowedTools: Record<string, string[]>;
  builtinTools?: BuiltinToolsConfig;
  disabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ALL_DECISIONS: DecisionType[] = ["approve", "edit", "reject"];

let rowIdCounter = 0;
function nextRowId(): string {
  return `interrupt-row-${++rowIdCounter}`;
}

/** Convert InterruptOn config to flat rows for editing. */
function configToRows(config: InterruptOn): InterruptRow[] {
  const rows: InterruptRow[] = [];
  for (const [namespace, tools] of Object.entries(config)) {
    for (const [tool, cfg] of Object.entries(tools)) {
      const isCustom = typeof cfg === "object" && cfg !== null;
      rows.push({
        id: nextRowId(),
        namespace,
        tool,
        mode: isCustom ? "custom" : "default",
        allowed_decisions: isCustom
          ? (cfg as InterruptToolConfig).allowed_decisions
          : [...ALL_DECISIONS],
      });
    }
  }
  return rows;
}

/** Convert rows back to InterruptOn config. */
function rowsToConfig(rows: InterruptRow[]): InterruptOn {
  const config: InterruptOn = {};
  for (const row of rows) {
    if (!config[row.namespace]) {
      config[row.namespace] = {};
    }
    if (row.mode === "default") {
      config[row.namespace][row.tool] = true;
    } else {
      config[row.namespace][row.tool] = { allowed_decisions: row.allowed_decisions };
    }
  }
  return config;
}

/** Get available tool names for a namespace. */
function getToolOptions(
  namespace: string,
  allowedTools: Record<string, string[]>,
  builtinTools?: BuiltinToolsConfig,
): string[] {
  if (namespace === "builtin") {
    if (!builtinTools) return [];
    // Return enabled builtin tool names
    return Object.entries(builtinTools)
      .filter(([, cfg]) => cfg && typeof cfg === "object" && "enabled" in cfg && cfg.enabled)
      .map(([name]) => name);
  }
  // MCP server: return tool names from allowedTools
  const tools = allowedTools[namespace];
  if (!tools) return [];
  // Empty array means "all tools" — we can't enumerate them without probing
  // Just show "*" option in that case
  return tools;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function InterruptConfigPicker({
  value,
  onChange,
  allowedTools,
  builtinTools,
  disabled = false,
}: InterruptConfigPickerProps) {
  const [rows, setRows] = React.useState<InterruptRow[]>(() => configToRows(value));
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  // Sync rows → parent on change
  const updateRows = React.useCallback(
    (newRows: InterruptRow[]) => {
      setRows(newRows);
      onChange(rowsToConfig(newRows));
    },
    [onChange],
  );

  // Available namespaces: "builtin" + MCP server IDs
  const namespaces = React.useMemo(() => {
    const ns = ["builtin"];
    for (const serverId of Object.keys(allowedTools)) {
      ns.push(serverId);
    }
    return ns;
  }, [allowedTools]);

  // Check if a row's tool still exists in the current config
  const isStaleRow = React.useCallback(
    (row: InterruptRow): boolean => {
      if (row.tool === "*") return false;
      const available = getToolOptions(row.namespace, allowedTools, builtinTools);
      // If namespace doesn't exist at all, it's stale
      if (row.namespace !== "builtin" && !allowedTools[row.namespace]) return true;
      // If tools list is empty for MCP (meaning "all"), we can't validate — assume ok
      if (row.namespace !== "builtin" && allowedTools[row.namespace]?.length === 0) return false;
      return !available.includes(row.tool);
    },
    [allowedTools, builtinTools],
  );

  const addRow = () => {
    const newRow: InterruptRow = {
      id: nextRowId(),
      namespace: "builtin",
      tool: "request_user_input",
      mode: "default",
      allowed_decisions: [...ALL_DECISIONS],
    };
    updateRows([...rows, newRow]);
  };

  const removeRow = (id: string) => {
    updateRows(rows.filter((r) => r.id !== id));
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateRow = (id: string, patch: Partial<InterruptRow>) => {
    updateRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleNamespaceChange = (rowId: string, namespace: string) => {
    // Reset tool when namespace changes
    const tools = getToolOptions(namespace, allowedTools, builtinTools);
    const defaultTool = tools.length > 0 ? tools[0] : "*";
    updateRow(rowId, { namespace, tool: defaultTool });
  };

  const handleToolChange = (rowId: string, tool: string) => {
    updateRow(rowId, { tool });
  };

  const handleDecisionToggle = (rowId: string, decision: DecisionType) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;

    const current = row.allowed_decisions;
    // Don't allow unchecking the last decision
    if (current.includes(decision) && current.length <= 1) return;

    const next = current.includes(decision)
      ? current.filter((d) => d !== decision)
      : [...current, decision];

    updateRow(rowId, { allowed_decisions: next, mode: "custom" });
  };

  const handleModeToggle = (rowId: string) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;

    if (row.mode === "default") {
      // Switch to custom — expand to show checkboxes
      updateRow(rowId, { mode: "custom" });
      setExpandedRows((prev) => new Set(prev).add(rowId));
    } else {
      // Switch back to default — reset to all decisions
      updateRow(rowId, { mode: "default", allowed_decisions: [...ALL_DECISIONS] });
      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.delete(rowId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-2">
          No interrupt rules configured. The agent will execute all tools without approval.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const isExpanded = expandedRows.has(row.id);
          const stale = isStaleRow(row);
          const toolOptions = getToolOptions(row.namespace, allowedTools, builtinTools);

          return (
            <div
              key={row.id}
              className={cn(
                "border rounded-md p-3 space-y-2",
                stale && "border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20",
              )}
            >
              {/* Main row */}
              <div className="flex items-center gap-2">
                {/* Namespace dropdown */}
                <select
                  value={row.namespace}
                  onChange={(e) => handleNamespaceChange(row.id, e.target.value)}
                  disabled={disabled}
                  className="h-8 rounded-md border bg-background px-2 text-xs font-mono min-w-[100px]"
                >
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>
                      {ns === "builtin" ? "Built-in" : ns}
                    </option>
                  ))}
                </select>

                {/* Tool dropdown */}
                <select
                  value={row.tool}
                  onChange={(e) => handleToolChange(row.id, e.target.value)}
                  disabled={disabled}
                  className="h-8 rounded-md border bg-background px-2 text-xs font-mono min-w-[140px] flex-1"
                >
                  <option value="*">All tools</option>
                  {toolOptions.map((tool) => (
                    <option key={tool} value={tool}>
                      {tool}
                    </option>
                  ))}
                </select>

                {/* Stale warning */}
                {stale && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">
                          This tool is no longer in the agent&apos;s tool set.
                          It will be ignored at runtime.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {/* Configure button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleExpanded(row.id)}
                  disabled={disabled}
                  className={cn("h-8 w-8 p-0", isExpanded && "text-primary")}
                  title="Configure allowed decisions"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>

                {/* Remove button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(row.id)}
                  disabled={disabled}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  title="Remove rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Expanded: decision checkboxes */}
              {isExpanded && (
                <div className="pl-2 pt-1 flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">Allowed decisions:</span>
                  {ALL_DECISIONS.map((decision) => {
                    const checked = row.allowed_decisions.includes(decision);
                    const isLast = row.allowed_decisions.length <= 1 && checked;
                    return (
                      <label
                        key={decision}
                        className={cn(
                          "flex items-center gap-1.5 text-xs cursor-pointer",
                          isLast && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled || isLast}
                          onChange={() => handleDecisionToggle(row.id, decision)}
                          className="h-3.5 w-3.5 rounded border-gray-300"
                        />
                        <span className="capitalize">{decision}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add rule button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={disabled}
        className="w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Add interrupt rule
      </Button>
    </div>
  );
}
