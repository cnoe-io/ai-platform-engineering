"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  GripVertical,
  Info,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  MiddlewareEntry,
  FeaturesConfig,
  MiddlewareDefinition,
} from "@/types/dynamic-agent";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MiddlewarePickerProps {
  value: FeaturesConfig | undefined;
  onChange: (value: FeaturesConfig) => void;
  disabled?: boolean;
  /** Available models for middleware that need model selection. */
  availableModels?: { model_id: string; name: string; provider: string }[];
  /** Called when the middleware definitions fetch error state changes. */
  onError?: (hasError: boolean) => void;
}

// ---------------------------------------------------------------------------
// Fetch hook
// ---------------------------------------------------------------------------

function useMiddlewareDefinitions(): {
  definitions: MiddlewareDefinition[];
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [definitions, setDefinitions] = React.useState<MiddlewareDefinition[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchDefinitions() {
      try {
        const response = await fetch("/api/dynamic-agents/middleware");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        if (!cancelled) {
          // API returns { success: true, data: [...] }
          setDefinitions(json.data || []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load middleware definitions");
          setLoading(false);
        }
      }
    }

    fetchDefinitions();
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);

  return { definitions, loading, error, retry };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert snake_case to Title Case for param labels. */
function snakeToTitle(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Parse a param_schema value into a type and optional options. */
function parseParamSchema(schema: string): { type: "number" | "boolean" | "string" | "select"; options?: string[] } {
  if (schema === "number") return { type: "number" };
  if (schema === "boolean") return { type: "boolean" };
  if (schema === "string") return { type: "string" };
  if (schema.includes("|")) return { type: "select", options: schema.split("|") };
  return { type: "string" };
}

/** Build the default middleware list (all default-enabled entries). */
function getDefaultEntries(definitions: MiddlewareDefinition[]): MiddlewareEntry[] {
  return definitions
    .filter((d) => d.enabled_by_default)
    .map((d) => ({
      type: d.key,
      enabled: true,
      params: { ...d.default_params },
    }));
}

/** Get the definition for a middleware type key. */
function getDefinition(definitions: MiddlewareDefinition[], type: string): MiddlewareDefinition | undefined {
  return definitions.find((d) => d.key === type);
}

/** Check if a singleton middleware is already in the list. */
function isSingletonPresent(
  definitions: MiddlewareDefinition[],
  entries: MiddlewareEntry[],
  key: string,
): boolean {
  const def = getDefinition(definitions, key);
  if (!def || def.allow_multiple) return false;
  return entries.some((e) => e.type === key);
}

// ---------------------------------------------------------------------------
// MiddlewareEntryCard
// ---------------------------------------------------------------------------

function MiddlewareEntryCard({
  entry,
  index,
  definition,
  disabled,
  availableModels,
  onUpdate,
  onRemove,
  onToggle,
  defaultExpanded,
}: {
  entry: MiddlewareEntry;
  index: number;
  definition: MiddlewareDefinition | undefined;
  disabled?: boolean;
  availableModels?: { model_id: string; name: string; provider: string }[];
  onUpdate: (index: number, params: Record<string, unknown>) => void;
  onRemove: (index: number) => void;
  onToggle: (index: number) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const label = definition?.label ?? entry.type;
  const description = definition?.description ?? "";

  const handleParamChange = (key: string, value: unknown) => {
    onUpdate(index, { ...entry.params, [key]: value });
  };

  // Determine which params to render (exclude model_id/model_provider — handled separately)
  const paramKeys = Object.keys(entry.params).filter(
    (k) => k !== "model_id" && k !== "model_provider"
  );

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        entry.enabled ? "border-border" : "border-border/50 opacity-60",
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          disabled={disabled}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Toggle */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={() => onToggle(index)}
            disabled={disabled}
            className="sr-only peer"
          />
          <div className="w-8 h-4 bg-muted rounded-full peer peer-checked:bg-primary transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
            <div
              className={cn(
                "w-3 h-3 bg-background rounded-full transition-transform mt-0.5 ml-0.5",
                entry.enabled && "translate-x-4"
              )}
            />
          </div>
        </label>

        <span className="text-sm font-medium flex-1 min-w-0 truncate">
          {label}
        </span>

        {description && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => onRemove(index)}
          disabled={disabled}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Expanded params */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t space-y-2">
          {/* Model selection for middleware that need it */}
          {definition?.model_params && availableModels && (
            <div className="space-y-1">
              <Label className="text-xs">Model</Label>
              <select
                value={`${entry.params.model_id ?? ""}::${entry.params.model_provider ?? ""}`}
                onChange={(e) => {
                  const lastDelim = e.target.value.lastIndexOf("::");
                  if (lastDelim > 0) {
                    const mid = e.target.value.slice(0, lastDelim);
                    const mprov = e.target.value.slice(lastDelim + 2);
                    onUpdate(index, {
                      ...entry.params,
                      model_id: mid,
                      model_provider: mprov,
                    });
                  }
                }}
                disabled={disabled}
                className={cn(
                  "flex h-8 w-full rounded-md border bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
                  !entry.params.model_id ? "border-destructive" : "border-input",
                )}
              >
                <option value="::">Select a model...</option>
                {availableModels.map((m) => (
                  <option
                    key={`${m.model_id}::${m.provider}`}
                    value={`${m.model_id}::${m.provider}`}
                  >
                    {m.name}
                    {m.provider && m.provider !== "default"
                      ? ` (${m.provider})`
                      : ""}
                  </option>
                ))}
              </select>
              {!entry.params.model_id && (
                <p className="text-xs text-destructive">
                  A model is required for this middleware to function.
                </p>
              )}
            </div>
          )}

          {/* Regular params — rendered based on param_schema from backend */}
          {paramKeys.map((key) => {
            const schemaHint = definition?.param_schema?.[key];
            const parsed = schemaHint ? parseParamSchema(schemaHint) : null;
            const paramType = parsed?.type ?? (typeof entry.params[key] === "number" ? "number" : "string");
            const paramLabel = snakeToTitle(key);
            const val = entry.params[key];

            if (paramType === "select" && parsed?.options) {
              return (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{paramLabel}</Label>
                  <select
                    value={String(val ?? "")}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    disabled={disabled}
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {parsed.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            if (paramType === "number") {
              return (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{paramLabel}</Label>
                  <Input
                    type="number"
                    value={val !== undefined ? String(val) : ""}
                    onChange={(e) =>
                      handleParamChange(
                        key,
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                    disabled={disabled}
                    className="h-8 text-xs"
                  />
                </div>
              );
            }

            if (paramType === "boolean") {
              return (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!val}
                    onChange={(e) => handleParamChange(key, e.target.checked)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  <Label className="text-xs">{paramLabel}</Label>
                </div>
              );
            }

            return (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{paramLabel}</Label>
                <Input
                  type="text"
                  value={String(val ?? "")}
                  onChange={(e) => handleParamChange(key, e.target.value)}
                  disabled={disabled}
                  className="h-8 text-xs"
                />
              </div>
            );
          })}

          {paramKeys.length === 0 && !definition?.model_params && (
            <p className="text-xs text-muted-foreground italic">
              No configurable parameters
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MiddlewarePicker (main export)
// ---------------------------------------------------------------------------

export function MiddlewarePicker({
  value,
  onChange,
  disabled,
  availableModels,
  onError,
}: MiddlewarePickerProps) {
  const { definitions, loading, error, retry } = useMiddlewareDefinitions();

  // Notify parent of error state changes
  React.useEffect(() => {
    onError?.(!!error);
  }, [error, onError]);

  // If no features config, show the defaults (once loaded)
  const entries: MiddlewareEntry[] =
    value?.middleware && value.middleware.length > 0
      ? value.middleware
      : loading ? [] : getDefaultEntries(definitions);

  const [showAddMenu, setShowAddMenu] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [lastAddedIndex, setLastAddedIndex] = React.useState<number | null>(null);

  // Clear lastAddedIndex after it's been consumed by the render
  React.useEffect(() => {
    if (lastAddedIndex !== null) {
      setLastAddedIndex(null);
    }
  }, [lastAddedIndex]);

  const updateEntries = (newEntries: MiddlewareEntry[]) => {
    onChange({ middleware: newEntries });
  };

  const handleToggle = (index: number) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    updateEntries(updated);
  };

  const handleUpdateParams = (
    index: number,
    params: Record<string, unknown>
  ) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], params };
    updateEntries(updated);
  };

  const handleRemove = (index: number) => {
    const updated = entries.filter((_, i) => i !== index);
    updateEntries(updated);
  };

  const handleAdd = (key: string) => {
    const def = getDefinition(definitions, key);
    if (!def) return;
    const newEntry: MiddlewareEntry = {
      type: key,
      enabled: true,
      params: { ...def.default_params },
    };
    const newEntries = [...entries, newEntry];
    setLastAddedIndex(newEntries.length - 1);
    updateEntries(newEntries);
    setShowAddMenu(false);
  };

  // Determine which middleware types can be added
  const addableTypes = definitions.filter((def) => {
    if (def.allow_multiple) return true;
    return !isSingletonPresent(definitions, entries, def.key);
  });

  return (
    <div className="space-y-3">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 -mx-2 hover:bg-muted transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <div>
          <Label className="cursor-pointer">Advanced Configuration</Label>
          <p className="text-xs text-muted-foreground">
            Retries, limits, and preprocessing
          </p>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 pl-6">
          {/* Loading / error states */}
          {loading && (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading middleware definitions...
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
              <p className="font-medium">Unable to connect to the agents backend</p>
              <p className="mt-1 text-destructive/80">
                Middleware definitions could not be loaded. Saving is disabled until this is resolved.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={retry}
              >
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Middleware</Label>
                  <p className="text-xs text-muted-foreground">
                    Configure the middleware pipeline for this agent. Order matters.
                  </p>
                </div>
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    disabled={disabled || addableTypes.length === 0}
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                  {showAddMenu && (
                    <div className="absolute top-full right-0 mt-1 z-50 w-64 rounded-lg border bg-background shadow-xl py-1">
                      {addableTypes.map((def) => (
                        <button
                          key={def.key}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                          onClick={() => handleAdd(def.key)}
                        >
                          <span className="font-medium">{def.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {def.description}
                          </span>
                        </button>
                      ))}
                      {addableTypes.length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground italic">
                          All singleton middleware already added
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Middleware entries list */}
              <div className="space-y-2">
                {entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-4 text-center">
                    No middleware configured. The agent will run without any middleware.
                  </p>
                ) : (
                  entries.map((entry, index) => (
                    <MiddlewareEntryCard
                      key={`${entry.type}-${index}`}
                      entry={entry}
                      index={index}
                      definition={getDefinition(definitions, entry.type)}
                      disabled={disabled}
                      availableModels={availableModels}
                      onUpdate={handleUpdateParams}
                      onRemove={handleRemove}
                      onToggle={handleToggle}
                      defaultExpanded={index === lastAddedIndex}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
