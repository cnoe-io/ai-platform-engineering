"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Code,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/dynamic-agents/AgentAvatar";
import type { AgentAvatarAgent } from "@/components/dynamic-agents/AgentAvatar";
import { useTheme } from "next-themes";
import type { WorkflowStep } from "@/types/workflow-config";

// Lazy-load CodeMirror to avoid SSR issues
const CodeMirrorEditor = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="h-[200px] rounded-md border border-input bg-muted/30 animate-pulse" />,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarAgent {
  _id: string;
  name: string;
  description?: string;
  ui?: AgentAvatarAgent["ui"];
}

interface WorkflowStepSidebarProps {
  step: WorkflowStep | null;
  stepIndex: number;
  onChange: (updates: Partial<WorkflowStep>) => void;
  onDelete: (stepIndex: number) => void;
  agents: SidebarAgent[];
  agentsLoading: boolean;
  /** Total number of steps in the workflow (for template variable chips) */
  totalSteps: number;
}

// ---------------------------------------------------------------------------
// Template variable chips
// ---------------------------------------------------------------------------

const ALWAYS_CHIPS = [
  { label: "previous_output", template: "{{ previous_output }}" },
  { label: "user_context", template: "{{ user_context }}" },
];

function buildStepChips(totalSteps: number, currentIndex: number) {
  const chips: { label: string; template: string }[] = [];
  for (let i = 0; i < totalSteps; i++) {
    if (i === currentIndex) continue;
    chips.push({
      label: `steps[${i}].output`,
      template: `{{ steps[${i}].output }}`,
    });
  }
  return chips;
}

// ---------------------------------------------------------------------------
// Agent Picker Dropdown
// ---------------------------------------------------------------------------

function AgentPickerDropdown({
  agents,
  selectedAgentId,
  onSelect,
  loading,
}: {
  agents: SidebarAgent[];
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedAgent = agents.find((a) => a._id === selectedAgentId);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 0);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Auto-focus search on open
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);

  const query = searchQuery.toLowerCase();
  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(query) ||
      (a.description?.toLowerCase().includes(query) ?? false),
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading agents...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setSearchQuery("");
        }}
        className={cn(
          "flex items-center gap-2 w-full h-9 px-3 rounded-md border border-input bg-transparent text-sm",
          "transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {selectedAgent ? (
          <>
            <AgentAvatar
              agent={selectedAgent}
              rounded="rounded-full"
              size="w-5 h-5"
              iconSize="h-2.5 w-2.5"
            />
            <span className="flex-1 text-left truncate">{selectedAgent.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-muted-foreground">Select an agent...</span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md bg-popover border border-border shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
          {/* Search */}
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 border border-border/50">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-64 py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {searchQuery ? `No agents match "${searchQuery}"` : "No agents available"}
              </div>
            )}
            {filtered.map((agent) => {
              const isSelected = agent._id === selectedAgentId;
              return (
                <button
                  key={agent._id}
                  onClick={() => {
                    onSelect(agent._id);
                    setOpen(false);
                    setSearchQuery("");
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors",
                    isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent",
                  )}
                >
                  <AgentAvatar
                    agent={agent}
                    rounded="rounded-full"
                    size="w-7 h-7"
                    iconSize="h-3.5 w-3.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{agent.name}</div>
                    {agent.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {agent.description}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkflowStepSidebar({
  step,
  stepIndex,
  onChange,
  onDelete,
  agents,
  agentsLoading,
  totalSteps,
}: WorkflowStepSidebarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [configOverrideJson, setConfigOverrideJson] = useState(
    step?.config_override ? JSON.stringify(step.config_override, null, 2) : "",
  );
  const [configOverrideError, setConfigOverrideError] = useState<string | null>(null);

  // CodeMirror extensions (loaded async to avoid SSR)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cmExtensions, setCmExtensions] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("@codemirror/lang-markdown"),
      import("@codemirror/language-data"),
      import("@codemirror/view"),
      import("@/lib/codemirror/jinja2-highlight"),
    ]).then(([mdMod, langDataMod, viewMod, jinja2Mod]) => {
      if (!cancelled) {
        setCmExtensions([
          mdMod.markdown({ codeLanguages: langDataMod.languages }),
          viewMod.EditorView.lineWrapping,
          jinja2Mod.jinja2Highlight,
        ]);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Reset local JSON state when step changes
  const lastStepIndexRef = useRef(stepIndex);
  if (stepIndex !== lastStepIndexRef.current) {
    lastStepIndexRef.current = stepIndex;
    setConfigOverrideJson(step?.config_override ? JSON.stringify(step.config_override, null, 2) : "");
    setConfigOverrideError(null);
  }

  const insertTemplate = useCallback(
    (template: string) => {
      if (!step) return;
      // Append template at end of prompt (with space if needed)
      const newPrompt = step.prompt
        ? step.prompt.trimEnd() + " " + template
        : template;
      onChange({ prompt: newPrompt });
    },
    [step, onChange],
  );

  const handleConfigOverrideChange = useCallback(
    (value: string) => {
      setConfigOverrideJson(value);
      if (!value.trim()) {
        setConfigOverrideError(null);
        onChange({ config_override: null });
        return;
      }
      try {
        const parsed = JSON.parse(value);
        setConfigOverrideError(null);
        onChange({ config_override: parsed });
      } catch {
        setConfigOverrideError("Invalid JSON");
      }
    },
    [onChange],
  );

  if (!step) {
    return (
      <div className="w-[624px] border-l border-border bg-card/50 flex items-center justify-center">
        <p className="text-sm text-muted-foreground text-center px-6">
          Select a step on the canvas to edit its properties
        </p>
      </div>
    );
  }

  const stepChips = buildStepChips(totalSteps, stepIndex);

  return (
    <div className="w-[624px] border-l border-border bg-card/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border shrink-0 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">Step #{stepIndex + 1}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Edit step properties</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => onDelete(stepIndex)}
          title="Delete step"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Agent */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Agent</Label>
          <AgentPickerDropdown
            agents={agents}
            selectedAgentId={step.agent_id}
            onSelect={(agentId) => onChange({ agent_id: agentId })}
            loading={agentsLoading}
          />
        </div>

        {/* Prompt */}
        <div className="space-y-2">
          <Label htmlFor="prompt" className="text-xs font-semibold">
            Prompt
          </Label>
          <div className="rounded-md border border-input overflow-hidden">
            <CodeMirrorEditor
              value={step.prompt}
              onChange={(val: string) => onChange({ prompt: val })}
              extensions={cmExtensions}
              theme="dark"
              height="200px"
              style={{ fontSize: "13px" }}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: true,
                bracketMatching: true,
                autocompletion: false,
                indentOnInput: true,
              }}
              placeholder="e.g. Create a GitHub repo.&#10;Context: {{ previous_output }}"
            />
          </div>

          {/* Template variable chips */}
          <div className="flex flex-wrap gap-1">
            {ALWAYS_CHIPS.map((chip) => (
              <button
                key={chip.label}
                onClick={() => insertTemplate(chip.template)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {chip.template}
              </button>
            ))}
            {stepChips.map((chip) => (
              <button
                key={chip.label}
                onClick={() => insertTemplate(chip.template)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                {chip.template}
              </button>
            ))}
          </div>
        </div>

        {/* Display Text */}
        <div className="space-y-2">
          <Label htmlFor="display_text" className="text-xs font-semibold">
            Step Name
          </Label>
          <Input
            id="display_text"
            value={step.display_text}
            onChange={(e) => onChange({ display_text: e.target.value })}
            placeholder="e.g., Create the repository"
            className="text-sm"
          />
        </div>

        {/* On Error + Retry */}
        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <Label htmlFor="on_error" className="text-xs font-semibold">
              On Error
            </Label>
            <select
              id="on_error"
              value={step.on_error}
              onChange={(e) => {
                const v = e.target.value as "abort" | "skip" | "retry";
                onChange({
                  on_error: v,
                  retry: v === "retry" ? { max_attempts: 3 } : null,
                });
              }}
              className={cn(
                "flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              <option value="abort">Abort workflow</option>
              <option value="skip">Skip step</option>
              <option value="retry">Retry step</option>
            </select>
          </div>
          {step.on_error === "retry" && (
            <div className="w-24 space-y-2">
              <Label htmlFor="max_attempts" className="text-xs font-semibold">
                Retries
              </Label>
              <Input
                id="max_attempts"
                type="number"
                min={1}
                max={10}
                value={step.retry?.max_attempts || 3}
                onChange={(e) =>
                  onChange({ retry: { max_attempts: parseInt(e.target.value) || 3 } })
                }
                className="text-sm"
              />
            </div>
          )}
        </div>

        {/* Advanced (collapsible) */}
        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Code className="h-3 w-3" />
            Advanced
            {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-2">
              <Label className="text-xs font-semibold">Config Override (JSON)</Label>
              <Textarea
                value={configOverrideJson}
                onChange={(e) => handleConfigOverrideChange(e.target.value)}
                placeholder='{"system_prompt": "...", "allowed_tools": {...}}'
                className={cn(
                  "text-xs font-mono min-h-[100px] resize-y",
                  configOverrideError && "border-destructive focus-visible:ring-destructive",
                )}
              />
              {configOverrideError && (
                <p className="text-[10px] text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {configOverrideError}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Override system_prompt, allowed_tools, model for this step.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
