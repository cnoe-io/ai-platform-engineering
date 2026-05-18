"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Save,
  AlertCircle,
  Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  WorkflowConfig,
  WorkflowStep,
  CreateWorkflowConfigInput,
  UpdateWorkflowConfigInput,
} from "@/types/workflow-config";
import { createBlankStep } from "@/types/workflow-config";
import { useWorkflowConfigStore } from "@/store/workflow-config-store";

// ---------------------------------------------------------------------------
// Agent selector hook — fetches available dynamic agents
// ---------------------------------------------------------------------------

interface DAOption {
  value: string;
  label: string;
}

function useDynamicAgents() {
  const [agents, setAgents] = useState<DAOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dynamic-agents");
        if (!res.ok) throw new Error("Failed to fetch agents");
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
          ? data.data
          : [];
        if (!cancelled) {
          setAgents(
            list.map((a: any) => ({
              value: a._id || a.id,
              label: a.name || a._id || a.id,
            }))
          );
        }
      } catch {
        if (!cancelled) setAgents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { agents, loading };
}

// ---------------------------------------------------------------------------
// Step editor row
// ---------------------------------------------------------------------------

interface StepRowProps {
  step: WorkflowStep;
  index: number;
  total: number;
  agents: DAOption[];
  agentsLoading: boolean;
  onChange: (index: number, step: WorkflowStep) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

function StepRow({
  step,
  index,
  total,
  agents,
  agentsLoading,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: StepRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [showConfigOverride, setShowConfigOverride] = useState(
    !!step.config_override && Object.keys(step.config_override).length > 0
  );
  const [configOverrideJson, setConfigOverrideJson] = useState(
    step.config_override ? JSON.stringify(step.config_override, null, 2) : ""
  );
  const [configOverrideError, setConfigOverrideError] = useState<string | null>(null);

  const update = (patch: Partial<WorkflowStep>) => {
    onChange(index, { ...step, ...patch });
  };

  const handleConfigOverrideChange = (value: string) => {
    setConfigOverrideJson(value);
    if (!value.trim()) {
      setConfigOverrideError(null);
      update({ config_override: null });
      return;
    }
    try {
      const parsed = JSON.parse(value);
      setConfigOverrideError(null);
      update({ config_override: parsed });
    } catch {
      setConfigOverrideError("Invalid JSON");
    }
  };

  return (
    <div className="border rounded-lg bg-card/50 border-border">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        <span className="text-xs font-mono text-muted-foreground w-6">
          #{index + 1}
        </span>
        <span className="text-sm font-medium text-foreground truncate flex-1">
          {step.display_text || "Untitled Step"}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {step.agent_id || "no agent"}
        </span>
        <span
          className={cn(
            "text-[10px] font-mono px-1.5 py-0.5 rounded",
            step.on_error === "abort"
              ? "bg-red-500/10 text-red-500"
              : step.on_error === "skip"
              ? "bg-yellow-500/10 text-yellow-600"
              : "bg-blue-500/10 text-blue-500"
          )}
        >
          {step.on_error}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(index); }}
            disabled={index === 0}
            className="p-1 rounded hover:bg-muted disabled:opacity-30"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(index); }}
            disabled={index === total - 1}
            className="p-1 rounded hover:bg-muted disabled:opacity-30"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(index); }}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3">
          {/* Display text */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Display Text
            </label>
            <input
              type="text"
              value={step.display_text}
              onChange={(e) => update({ display_text: e.target.value })}
              placeholder="e.g. Create the repository"
              className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Agent */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Agent
            </label>
            {agentsLoading ? (
              <div className="text-xs text-muted-foreground h-8 flex items-center">
                Loading agents...
              </div>
            ) : agents.length > 0 ? (
              <select
                value={step.agent_id}
                onChange={(e) => update({ agent_id: e.target.value })}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select an agent...</option>
                {agents.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={step.agent_id}
                onChange={(e) => update({ agent_id: e.target.value })}
                placeholder="e.g. agent-abc123"
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
          </div>

          {/* Prompt */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Prompt (Jinja2 template)
            </label>
            <textarea
              value={step.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder={"e.g. Create a GitHub repo.\nContext: {{ previous_output }}"}
              rows={4}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono text-xs resize-y"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Available: {"{{ previous_output }}"}, {"{{ steps[0].output }}"}, {"{{ user_context }}"}
            </p>
          </div>

          {/* On Error + Retry */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                On Error
              </label>
              <select
                value={step.on_error}
                onChange={(e) => {
                  const v = e.target.value as "abort" | "skip" | "retry";
                  update({
                    on_error: v,
                    retry: v === "retry" ? { max_attempts: 3 } : null,
                  });
                }}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="abort">Abort workflow</option>
                <option value="skip">Skip step</option>
                <option value="retry">Retry step</option>
              </select>
            </div>
            {step.on_error === "retry" && (
              <div className="w-32">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Max Attempts
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={step.retry?.max_attempts || 3}
                  onChange={(e) =>
                    update({ retry: { max_attempts: parseInt(e.target.value) || 3 } })
                  }
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            )}
          </div>

          {/* Config Override (collapsible) */}
          <div>
            <button
              onClick={() => setShowConfigOverride(!showConfigOverride)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Code className="h-3 w-3" />
              Config Override (JSON)
              {showConfigOverride ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            {showConfigOverride && (
              <div className="mt-2">
                <textarea
                  value={configOverrideJson}
                  onChange={(e) => handleConfigOverrideChange(e.target.value)}
                  placeholder='{"system_prompt": "...", "allowed_tools": {...}, "model": "..."}'
                  rows={4}
                  className={cn(
                    "flex w-full rounded-md border bg-transparent px-3 py-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono resize-y",
                    configOverrideError
                      ? "border-destructive focus-visible:ring-destructive"
                      : "border-input"
                  )}
                />
                {configOverrideError && (
                  <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {configOverrideError}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Optional. Override system_prompt, allowed_tools, model for this step.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow Editor
// ---------------------------------------------------------------------------

interface WorkflowEditorProps {
  /** Existing config to edit, or undefined for create */
  existingConfig?: WorkflowConfig;
  /** Pre-populated values for new config (e.g. from clone) */
  initialName?: string;
  initialDescription?: string;
  initialSteps?: WorkflowStep[];
  /** Called when user clicks Back */
  onBack: () => void;
}

export function WorkflowEditor({
  existingConfig,
  initialName,
  initialDescription,
  initialSteps,
  onBack,
}: WorkflowEditorProps) {
  const { createConfig, updateConfig } = useWorkflowConfigStore();
  const { agents, loading: agentsLoading } = useDynamicAgents();

  const [name, setName] = useState(existingConfig?.name || initialName || "");
  const [description, setDescription] = useState(existingConfig?.description || initialDescription || "");
  const [steps, setSteps] = useState<WorkflowStep[]>(
    existingConfig
      ? (existingConfig.steps.filter((s) => s.type === "step") as WorkflowStep[])
      : initialSteps && initialSteps.length > 0
      ? initialSteps
      : [createBlankStep()]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStepChange = useCallback((index: number, step: WorkflowStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  }, []);

  const handleStepRemove = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setSteps((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleAddStep = () => {
    setSteps((prev) => [...prev, createBlankStep()]);
  };

  const handleSave = async () => {
    setError(null);

    if (!name.trim()) {
      setError("Workflow name is required");
      return;
    }
    if (steps.length === 0) {
      setError("At least one step is required");
      return;
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.display_text.trim() || !s.agent_id.trim() || !s.prompt.trim()) {
        setError(`Step #${i + 1}: display_text, agent, and prompt are all required`);
        return;
      }
    }

    setSaving(true);
    try {
      if (existingConfig) {
        const updates: UpdateWorkflowConfigInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          steps,
        };
        await updateConfig(existingConfig._id, updates);
      } else {
        const input: CreateWorkflowConfigInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          steps,
        };
        await createConfig(input);
      }
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-card/30 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="text-sm font-medium text-foreground">
            {existingConfig ? "Edit Workflow" : "New Workflow"}
          </span>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5 gradient-primary text-white"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Create GitHub Repo with CI"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this workflow do?"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                Steps ({steps.length})
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddStep}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Step
              </Button>
            </div>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <StepRow
                  key={i}
                  step={step}
                  index={i}
                  total={steps.length}
                  agents={agents}
                  agentsLoading={agentsLoading}
                  onChange={handleStepChange}
                  onRemove={handleStepRemove}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                />
              ))}
              {steps.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No steps yet. Click &quot;Add Step&quot; to get started.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
