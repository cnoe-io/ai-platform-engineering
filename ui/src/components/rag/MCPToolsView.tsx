"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Wrench,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  Search,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRagPermissions, Permission } from "@/hooks/useRagPermissions";
import {
  getMCPTools,
  createMCPTool,
  updateMCPTool,
  deleteMCPTool,
  getMCPBuiltinConfig,
  updateMCPBuiltinConfig,
  getDataSources,
  type MCPToolConfig,
  type MCPBuiltinToolsConfig,
  type ParallelSearch,
} from "@/lib/rag-api";
import { cn } from "@/lib/utils";

// ============================================================================
// Constants
// ============================================================================

const TOOL_ID_REGEX = /^[a-z0-9_]+$/;

const DEFAULT_PARALLEL_SEARCH: ParallelSearch = {
  label: "results",
  datasource_ids: [],
  is_graph_entity: null,
  extra_filters: {},
  semantic_weight: 0.5,
};

const DEFAULT_TOOL: Omit<MCPToolConfig, "created_at" | "updated_at"> = {
  tool_id: "",
  description: "",
  parallel_searches: [{ ...DEFAULT_PARALLEL_SEARCH }],
  allow_runtime_filters: false,
  enabled: true,
};

// ============================================================================
// DatasourceChipPicker — reusable chip picker for datasource IDs
// ============================================================================

interface DatasourceChipPickerProps {
  selected: string[];
  available: string[];
  onChange: (ids: string[]) => void;
}

function DatasourceChipPicker({ selected, available, onChange }: DatasourceChipPickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = available.filter(
    (id) => !selected.includes(id) && id.toLowerCase().includes(search.toLowerCase())
  );

  const add = (id: string) => {
    onChange([...selected, id]);
    setSearch("");
    inputRef.current?.focus();
  };

  const remove = (id: string) => onChange(selected.filter((x) => x !== id));

  return (
    <div className="space-y-1.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs max-w-[200px]",
                id.endsWith("*")
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-primary/10 text-primary"
              )}
              title={id}
            >
              <span className="truncate font-mono">{id}</span>
              <button type="button" onClick={() => remove(id)} className="hover:opacity-70">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search or type prefix* to match by prefix…"
          className="pl-8 text-xs h-8"
        />
      </div>

      {open && (
        <div
          ref={dropdownRef}
          className="relative z-50 w-full rounded-md border border-border bg-popover shadow-md"
        >
          {search.endsWith("*") && !selected.includes(search) && (
            <div className="border-b border-border/50">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(search); }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted flex items-center gap-2"
                title={search}
              >
                <span className="shrink-0 font-mono text-[10px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">prefix</span>
                <span className="break-all font-mono">{search}</span>
              </button>
            </div>
          )}
          {filtered.length === 0 && !search.endsWith("*") ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {available.length === 0
                ? "No datasources found"
                : search
                ? "No matches — type prefix* to match by prefix"
                : "All datasources already added"}
            </p>
          ) : (
            <ul className="max-h-36 overflow-y-auto py-1">
              {filtered.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); add(id); }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                    title={id}
                  >
                    <span className="break-all font-mono">{id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ParallelSearchRow
// ============================================================================

interface ParallelSearchRowProps {
  value: ParallelSearch;
  index: number;
  canRemove: boolean;
  availableDatasources: string[];
  onChange: (updated: ParallelSearch) => void;
  onRemove: () => void;
}

function ParallelSearchRow({ value, index, canRemove, availableDatasources, onChange, onRemove }: ParallelSearchRowProps) {
  const [extraJson, setExtraJson] = useState(
    Object.keys(value.extra_filters).length > 0
      ? JSON.stringify(value.extra_filters, null, 2)
      : ""
  );
  const [jsonError, setJsonError] = useState("");

  const handleExtraChange = (raw: string) => {
    setExtraJson(raw);
    setJsonError("");
    if (!raw.trim()) {
      onChange({ ...value, extra_filters: {} });
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      onChange({ ...value, extra_filters: parsed });
    } catch {
      setJsonError("Invalid JSON");
    }
  };

  const isGraphEntityOptions: { label: string; value: boolean | null; hint: string }[] = [
    { label: "All", value: null, hint: "No filter on entity type" },
    { label: "Docs", value: false, hint: "Regular documents only" },
    { label: "Graph", value: true, hint: "Graph entities only" },
  ];

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      {/* Header: index + label + remove */}
      <div className="flex items-start gap-2">
        <span className="text-xs text-muted-foreground font-mono shrink-0 w-4 mt-1.5">{index + 1}.</span>
        <div className="flex-1 space-y-0.5">
          <Input
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            placeholder="e.g. results, graph_docs"
            className="h-7 text-xs font-mono"
          />
          <p className="text-[11px] text-muted-foreground whitespace-nowrap overflow-hidden">
            Key in the response dict: <span className="font-mono">{value.label || "results"}</span>: [...]
          </p>
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
            onClick={onRemove}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Datasource IDs */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium">Datasources</p>
        <DatasourceChipPicker
          selected={value.datasource_ids}
          available={availableDatasources}
          onChange={(ids) => onChange({ ...value, datasource_ids: ids })}
        />
        <p className="text-[11px] text-muted-foreground">Leave empty to search all datasources.</p>
      </div>

      {/* is_graph_entity selector */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium">Entity type filter</p>
        <div className="flex gap-1">
          {isGraphEntityOptions.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              title={opt.hint}
              onClick={() => onChange({ ...value, is_graph_entity: opt.value })}
              className={cn(
                "px-3 py-1 rounded text-xs font-medium border transition-colors",
                value.is_graph_entity === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {value.is_graph_entity === null && "No filter — returns both documents and graph entities."}
          {value.is_graph_entity === false && "Regular documents only (is_graph_entity=false)."}
          {value.is_graph_entity === true && "Graph entity documents only (is_graph_entity=true)."}
        </p>
      </div>

      {/* Semantic weight */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground font-medium">
            Semantic weight: <span className="font-mono text-foreground">{value.semantic_weight.toFixed(2)}</span>
          </p>
          <span className="text-[11px] text-muted-foreground">
            Keyword: {(1 - value.semantic_weight).toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.semantic_weight}
          onChange={(e) => onChange({ ...value, semantic_weight: parseFloat(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>Keyword (0.0)</span>
          <span>Balanced (0.5)</span>
          <span>Semantic (1.0)</span>
        </div>
      </div>

      {/* Extra filters */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium">Additional filters (JSON)</p>
        <Textarea
          value={extraJson}
          onChange={(e) => handleExtraChange(e.target.value)}
          placeholder={'{\n  "document_type": "runbook"\n}'}
          rows={2}
          className={cn("font-mono text-xs resize-none", jsonError && "border-destructive")}
        />
        {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
        <p className="text-[11px] text-muted-foreground">
          Valid filter keys can be found in the Search tab results under <code className="bg-muted px-1 rounded">metadata</code>.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// ToolFormDialog
// ============================================================================

interface ToolFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: MCPToolConfig) => Promise<void>;
  initial?: MCPToolConfig | null;
  isEdit: boolean;
}

function ToolFormDialog({ open, onClose, onSave, initial, isEdit }: ToolFormDialogProps) {
  const [toolId, setToolId] = useState(initial?.tool_id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [parallelSearches, setParallelSearches] = useState<ParallelSearch[]>(
    initial?.parallel_searches ?? [{ ...DEFAULT_PARALLEL_SEARCH }]
  );
  const [allowRuntimeFilters, setAllowRuntimeFilters] = useState(
    initial?.allow_runtime_filters ?? false
  );
  const [saving, setSaving] = useState(false);

  const [availableDatasources, setAvailableDatasources] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setToolId(initial?.tool_id ?? "");
      setDescription(initial?.description ?? "");
      setParallelSearches(
        initial?.parallel_searches?.length
          ? initial.parallel_searches
          : [{ ...DEFAULT_PARALLEL_SEARCH }]
      );
      setAllowRuntimeFilters(initial?.allow_runtime_filters ?? false);
      setSaving(false);

      getDataSources().then((res) => {
        setAvailableDatasources(res.datasources.map((ds) => ds.datasource_id));
      }).catch(() => {});
    }
  }, [open, initial]);

  const handleSave = async () => {
    const config: MCPToolConfig = {
      tool_id: toolId.trim(),
      description,
      parallel_searches: parallelSearches,
      allow_runtime_filters: allowRuntimeFilters,
      enabled: initial?.enabled ?? true,
      created_at: initial?.created_at ?? 0,
      updated_at: initial?.updated_at ?? 0,
    };
    setSaving(true);
    try {
      await onSave(config);
    } finally {
      setSaving(false);
    }
  };

  const toolIdValid = isEdit || (toolId.length > 0 && TOOL_ID_REGEX.test(toolId));
  const canSave = toolIdValid && parallelSearches.length > 0 && parallelSearches.every((ps) => ps.label.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit MCP Tool" : "Create MCP Tool"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Tool ID */}
          <div className="space-y-1.5">
            <Label htmlFor="tool-id">
              Tool ID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tool-id"
              value={toolId}
              onChange={(e) => setToolId(e.target.value)}
              disabled={isEdit}
              placeholder="e.g. infra_search"
              className={cn(!toolIdValid && toolId.length > 0 && "border-destructive")}
            />
            {!toolIdValid && toolId.length > 0 && (
              <p className="text-xs text-destructive">Only lowercase letters, digits, and underscores allowed.</p>
            )}
            {!isEdit && (
              <p className="text-xs text-muted-foreground">
                Becomes the MCP tool name exposed to the LLM agent. Cannot be changed after creation.
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this tool searches for, shown to the LLM agent…"
              rows={3}
            />
          </div>

          {/* Parallel Searches */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Searches <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 gap-1 text-xs"
                onClick={() =>
                  setParallelSearches((prev) => [
                    ...prev,
                    { ...DEFAULT_PARALLEL_SEARCH, label: "" },
                  ])
                }
              >
                <Plus className="h-3 w-3" />
                Add Search
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Each search runs concurrently. Results are returned as a dict keyed by label.
            </p>
            <div className="space-y-2">
              {parallelSearches.map((ps, i) => (
                <ParallelSearchRow
                  key={i}
                  index={i}
                  value={ps}
                  canRemove={parallelSearches.length > 1}
                  availableDatasources={availableDatasources}
                  onChange={(updated) =>
                    setParallelSearches((prev) =>
                      prev.map((x, idx) => (idx === i ? updated : x))
                    )
                  }
                  onRemove={() =>
                    setParallelSearches((prev) => prev.filter((_, idx) => idx !== i))
                  }
                />
              ))}
            </div>
          </div>

          {/* Options */}
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border/50 p-3">
            <input
              type="checkbox"
              checked={allowRuntimeFilters}
              onChange={(e) => setAllowRuntimeFilters(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Allow agents to change filters during search</p>
              <p className="text-xs text-muted-foreground">
                Exposes a <code className="text-xs bg-muted px-1 rounded">filters</code> parameter so the agent can apply additional metadata filters per-call.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Tool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// BuiltinConfigSection
// ============================================================================

interface BuiltinConfigSectionProps {
  config: MCPBuiltinToolsConfig;
  canEdit: boolean;
  onUpdate: (config: MCPBuiltinToolsConfig) => Promise<void>;
}

function BuiltinConfigSection({ config, canEdit, onUpdate }: BuiltinConfigSectionProps) {
  const [local, setLocal] = useState(config);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocal(config);
  }, [config]);

  const toggle = async (key: keyof MCPBuiltinToolsConfig) => {
    if (!canEdit) return;
    const updated = { ...local, [key]: !local[key] };
    setLocal(updated);
    setSaving(true);
    try {
      await onUpdate(updated);
    } finally {
      setSaving(false);
    }
  };

  type ToolItem = { key: keyof MCPBuiltinToolsConfig; label: string; description: string };

  const generalTools: ToolItem[] = [
    {
      key: "search_enabled",
      label: "search",
      description: "Semantic and keyword search across documents and graph entities",
    },
    {
      key: "fetch_document_enabled",
      label: "fetch_document",
      description: "Fetch the full content of a document by its ID",
    },
    {
      key: "fetch_datasources_enabled",
      label: "list_datasources_and_entity_types",
      description: "List available datasources and graph entity types",
    },
  ];

  const graphTools: ToolItem[] = [
    {
      key: "graph_explore_ontology_entity_enabled",
      label: "graph_explore_ontology_entity",
      description: "Explore an ontology entity and its neighborhood",
    },
    {
      key: "graph_explore_data_entity_enabled",
      label: "graph_explore_data_entity",
      description: "Explore a data entity and its neighborhood",
    },
    {
      key: "graph_fetch_data_entity_details_enabled",
      label: "graph_fetch_data_entity_details",
      description: "Fetch details of a single data entity with all properties and relations",
    },
    {
      key: "graph_shortest_path_between_entity_types_enabled",
      label: "graph_shortest_path_between_entity_types",
      description: "Find shortest relationship paths between two entity types",
    },
    {
      key: "graph_raw_query_data_enabled",
      label: "graph_raw_query_data",
      description: "Execute a raw read-only query on the data graph",
    },
    {
      key: "graph_raw_query_ontology_enabled",
      label: "graph_raw_query_ontology",
      description: "Execute a raw read-only query on the ontology graph",
    },
  ];

  const renderToggleRow = ({ key, label, description }: ToolItem) => (
    <div key={key} className="flex items-center justify-between gap-4 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>
      <button
        onClick={() => toggle(key)}
        disabled={!canEdit || saving}
        className={cn(
          "relative w-10 rounded-full transition-colors shrink-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          local[key] ? "bg-primary" : "bg-muted"
        )}
        style={{ height: "22px" }}
        title={canEdit ? undefined : "Admin access required"}
      >
        <span
          className={cn(
            "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
            local[key] ? "left-[calc(100%-18px)]" : "left-0.5"
          )}
        />
      </button>
    </div>
  );

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Built-in Tools</p>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-2">
        {generalTools.map(renderToggleRow)}
      </div>
      <div className="border-t border-border/40 pt-3 space-y-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Graph RAG Tools</p>
          <p className="text-xs text-muted-foreground/70">Requires Graph RAG to be enabled</p>
        </div>
        {graphTools.map(renderToggleRow)}
      </div>
    </div>
  );
}

// ============================================================================
// ToolCard
// ============================================================================

interface ToolCardProps {
  tool: MCPToolConfig;
  canEdit: boolean;
  onEdit: (tool: MCPToolConfig) => void;
  onDelete: (toolId: string) => void;
  onToggleEnabled: (tool: MCPToolConfig) => void;
}

function ToolCard({ tool, canEdit, onEdit, onDelete, onToggleEnabled }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-card/50 overflow-hidden",
        !tool.enabled && "opacity-60"
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="font-mono text-sm font-medium truncate">{tool.tool_id}</span>
          <Badge variant="outline" className="text-xs shrink-0 font-mono">
            {tool.parallel_searches.length} search{tool.parallel_searches.length !== 1 ? "es" : ""}
          </Badge>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {/* Enabled toggle */}
          {canEdit && (
            <button
              onClick={() => onToggleEnabled(tool)}
              title={tool.enabled ? "Disable tool" : "Enable tool"}
              className={cn(
                "relative w-9 rounded-full transition-colors",
                tool.enabled ? "bg-primary" : "bg-muted"
              )}
              style={{ height: "20px" }}
            >
              <span
                className={cn(
                  "absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all",
                  tool.enabled ? "left-[calc(100%-16px)]" : "left-0.5"
                )}
              />
            </button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(tool)}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(tool.tool_id)}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      {tool.description && (
        <div className="px-4 pb-2">
          <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
        </div>
      )}

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 border-t border-border/50 space-y-2">
              {tool.parallel_searches.map((ps, i) => (
                <div key={i} className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">{i + 1}.</span>
                    <Badge variant="outline" className="text-xs font-mono">{ps.label}</Badge>
                    {ps.is_graph_entity === false && (
                      <Badge variant="secondary" className="text-xs">docs</Badge>
                    )}
                    {ps.is_graph_entity === true && (
                      <Badge variant="secondary" className="text-xs">graph</Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto font-mono">
                      s={ps.semantic_weight.toFixed(2)} k={(1 - ps.semantic_weight).toFixed(2)}
                    </span>
                  </div>
                  {ps.datasource_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {ps.datasource_ids.map((id) => (
                        <span
                          key={id}
                          className={cn(
                            "text-[11px] font-mono px-1.5 py-0.5 rounded",
                            id.endsWith("*")
                              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              : "bg-primary/10 text-primary"
                          )}
                          title={id}
                        >
                          {id.length > 30 ? id.slice(0, 28) + "…" : id}
                        </span>
                      ))}
                    </div>
                  )}
                  {Object.keys(ps.extra_filters).length > 0 && (
                    <code className="text-[11px] bg-muted rounded px-1.5 py-0.5 break-all block">
                      {JSON.stringify(ps.extra_filters)}
                    </code>
                  )}
                </div>
              ))}

              {tool.allow_runtime_filters && (
                <Badge variant="outline" className="text-xs">runtime filters</Badge>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// MCPToolsView
// ============================================================================

export default function MCPToolsView() {
  const { hasPermission } = useRagPermissions();
  const canEdit = hasPermission(Permission.DELETE);
  const { toast } = useToast();

  const [tools, setTools] = useState<MCPToolConfig[]>([]);
  const [builtinConfig, setBuiltinConfig] = useState<MCPBuiltinToolsConfig>({
    search_enabled: true,
    fetch_document_enabled: true,
    fetch_datasources_enabled: true,
    graph_explore_ontology_entity_enabled: true,
    graph_explore_data_entity_enabled: true,
    graph_fetch_data_entity_details_enabled: true,
    graph_shortest_path_between_entity_types_enabled: true,
    graph_raw_query_data_enabled: true,
    graph_raw_query_ontology_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<MCPToolConfig | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedTools, fetchedBuiltin] = await Promise.all([
        getMCPTools(),
        getMCPBuiltinConfig(),
      ]);
      setTools(fetchedTools);
      setBuiltinConfig(fetchedBuiltin);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleSaveTool = async (config: MCPToolConfig) => {
    try {
      if (editingTool) {
        await updateMCPTool(config.tool_id, config);
        toast(`Tool "${config.tool_id}" updated.`, "success");
      } else {
        await createMCPTool(config);
        toast(`Tool "${config.tool_id}" created and active.`, "success");
      }
      setDialogOpen(false);
      setEditingTool(null);
      await fetchAll();
    } catch (err) {
      toast(`Error: ${String(err)}`, "error");
      throw err;
    }
  };

  const handleToggleEnabled = async (tool: MCPToolConfig) => {
    const updated = { ...tool, enabled: !tool.enabled };
    setTools((prev) => prev.map((t) => (t.tool_id === tool.tool_id ? updated : t)));
    try {
      await updateMCPTool(tool.tool_id, updated);
    } catch (err) {
      // Revert on failure
      setTools((prev) => prev.map((t) => (t.tool_id === tool.tool_id ? tool : t)));
      toast(`Error: ${String(err)}`, "error");
    }
  };

  const handleDelete = async (toolId: string) => {
    if (!window.confirm(`Delete MCP tool "${toolId}"? This cannot be undone.`)) return;
    try {
      await deleteMCPTool(toolId);
      toast(`Tool "${toolId}" deleted.`, "success");
      await fetchAll();
    } catch (err) {
      toast(`Error: ${String(err)}`, "error");
    }
  };

  const handleUpdateBuiltin = async (config: MCPBuiltinToolsConfig) => {
    try {
      await updateMCPBuiltinConfig(config);
      setBuiltinConfig(config);
      toast("Built-in tools configuration updated.", "success");
    } catch (err) {
      toast(`Error: ${String(err)}`, "error");
      throw err;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg gradient-primary-br flex items-center justify-center shadow-md shadow-primary/20">
            <Wrench className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">MCP Tools</h1>
            <p className="text-xs text-muted-foreground">Configure search tools exposed to the MCP client</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAll}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-6 max-w-2xl">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Built-in tools toggles */}
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Built-in Tools</h2>
                <BuiltinConfigSection
                  config={builtinConfig}
                  canEdit={canEdit}
                  onUpdate={handleUpdateBuiltin}
                />
              </section>

              {/* Custom tools */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Custom Search Tools</h2>
                    <Badge variant="secondary" className="text-xs">{tools.length}</Badge>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 gap-1 text-xs"
                      onClick={() => {
                        setEditingTool(null);
                        setDialogOpen(true);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                      Add Tool
                    </Button>
                  )}
                </div>
                {tools.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 py-8 text-center">
                    <Wrench className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No custom tools yet</p>
                    {canEdit && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Click <strong>Add Tool</strong> to create a custom search tool.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tools.map((tool) => (
                      <ToolCard
                        key={tool.tool_id}
                        tool={tool}
                        canEdit={canEdit}
                        onEdit={(t) => {
                          setEditingTool(t);
                          setDialogOpen(true);
                        }}
                        onDelete={handleDelete}
                        onToggleEnabled={handleToggleEnabled}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Create / Edit dialog */}
      <ToolFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingTool(null);
        }}
        onSave={handleSaveTool}
        initial={editingTool ?? undefined}
        isEdit={editingTool !== null}
      />
    </div>
  );
}
