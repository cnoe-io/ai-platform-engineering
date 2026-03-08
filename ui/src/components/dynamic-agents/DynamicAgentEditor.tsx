"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Globe, Users, Lock, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DynamicAgentConfig,
  DynamicAgentConfigCreate,
  DynamicAgentConfigUpdate,
  VisibilityType,
  SubAgentRef,
  BuiltinToolsConfig,
} from "@/types/dynamic-agent";
import { AllowedToolsPicker } from "./AllowedToolsPicker";
import { BuiltinToolsPicker } from "./BuiltinToolsPicker";
import { SubagentPicker } from "./SubagentPicker";

interface DynamicAgentEditorProps {
  agent: DynamicAgentConfig | null; // null = creating new
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Generate a URL-safe slug from an agent name.
 * e.g., "Knowledge Agent" -> "knowledge_agent"
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "_")          // Replace spaces with underscores
    .replace(/-+/g, "_")           // Replace hyphens with underscores
    .replace(/_+/g, "_")           // Collapse multiple underscores
    .replace(/^_|_$/g, "");        // Trim leading/trailing underscores
}

const VISIBILITY_OPTIONS: { value: VisibilityType; label: string; icon: React.ReactNode; description: string }[] = [
  { 
    value: "private", 
    label: "Private", 
    icon: <Lock className="h-4 w-4" />,
    description: "Only you can use this agent" 
  },
  { 
    value: "team", 
    label: "Team", 
    icon: <Users className="h-4 w-4" />,
    description: "Share with specific teams" 
  },
  { 
    value: "global", 
    label: "Global", 
    icon: <Globe className="h-4 w-4" />,
    description: "Available to all users" 
  },
];

// Step definitions for the wizard
const STEPS = [
  { 
    id: "basic" as const, 
    label: "Basic Info", 
    hint: "Define your agent's identity and access level" 
  },
  { 
    id: "instructions" as const, 
    label: "Instructions", 
    hint: "Configure how your agent behaves" 
  },
  { 
    id: "tools" as const, 
    label: "Tools", 
    hint: "Select which tools your agent can use" 
  },
  { 
    id: "subagents" as const, 
    label: "Subagents", 
    hint: "Delegate tasks to other agents (optional)" 
  },
];

type StepId = typeof STEPS[number]["id"];

/**
 * Horizontal step indicator component
 */
function StepIndicator({ 
  steps, 
  currentStep, 
  onStepClick 
}: { 
  steps: typeof STEPS; 
  currentStep: StepId; 
  onStepClick: (stepId: StepId) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0 py-4">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          {index > 0 && (
            <div className="w-8 h-0.5 bg-border mx-1" />
          )}
          <button
            type="button"
            onClick={() => onStepClick(step.id)}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[80px]",
              currentStep === step.id 
                ? "bg-primary/10 text-primary" 
                : "hover:bg-muted text-muted-foreground"
            )}
          >
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium",
              currentStep === step.id 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted"
            )}>
              {index + 1}
            </div>
            <span className="text-xs font-medium">{step.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export function DynamicAgentEditor({ agent, onSave, onCancel }: DynamicAgentEditorProps) {
  const isEditing = !!agent;

  // Form state
  const [name, setName] = React.useState(agent?.name || "");
  const [description, setDescription] = React.useState(agent?.description || "");
  const [systemPrompt, setSystemPrompt] = React.useState(agent?.system_prompt || "");
  const [visibility, setVisibility] = React.useState<VisibilityType>(agent?.visibility || "private");
  const [allowedTools, setAllowedTools] = React.useState<Record<string, string[]>>(
    agent?.allowed_tools || {}
  );
  const [builtinTools, setBuiltinTools] = React.useState<BuiltinToolsConfig | undefined>(
    agent?.builtin_tools
  );
  const [subagents, setSubagents] = React.useState<SubAgentRef[]>(
    agent?.subagents || []
  );
  const [modelId, setModelId] = React.useState(agent?.model_id || "");
  const [modelProvider, setModelProvider] = React.useState(agent?.model_provider || "");

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [availableModels, setAvailableModels] = React.useState<
    { id: string; name: string; provider: string; description: string }[]
  >([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);

  // ID generation and validation
  const generatedId = React.useMemo(() => generateSlug(name), [name]);
  const [existingIds, setExistingIds] = React.useState<Set<string>>(new Set());

  // Check if the generated ID clashes with existing agents
  const idClash = React.useMemo(() => {
    if (isEditing) return false; // When editing, ID doesn't change
    if (!generatedId) return false;
    return existingIds.has(generatedId);
  }, [isEditing, generatedId, existingIds]);

  // Fetch existing agent IDs for clash detection
  React.useEffect(() => {
    if (isEditing) return; // No need to check when editing

    async function fetchExistingIds() {
      try {
        const response = await fetch("/api/dynamic-agents");
        const data = await response.json();
        // API returns paginated response: {success, data: {items: [...], ...}}
        if (data.success && data.data?.items && Array.isArray(data.data.items)) {
          const ids = new Set<string>(data.data.items.map((a: DynamicAgentConfig) => a._id));
          setExistingIds(ids);
        }
      } catch (err) {
        console.error("Failed to fetch existing agent IDs:", err);
      }
    }
    fetchExistingIds();
  }, [isEditing]);

  // Fetch available models on mount
  React.useEffect(() => {
    async function fetchModels() {
      setModelsLoading(true);
      try {
        const response = await fetch("/api/dynamic-agents/models");
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
          setAvailableModels(data.data);
          
          if (agent?.model_id) {
            // Editing existing agent - verify model exists and sync provider
            const existingModel = data.data.find((m: { id: string; provider: string }) => m.id === agent.model_id);
            if (existingModel) {
              // Model exists - ensure provider is in sync with config
              setModelProvider(existingModel.provider);
            } else {
              // Model no longer available - reset to first available
              console.warn(`Agent model "${agent.model_id}" no longer available, resetting to default`);
              if (data.data.length > 0) {
                setModelId(data.data[0].id);
                setModelProvider(data.data[0].provider);
              }
            }
          } else if (data.data.length > 0) {
            // Creating new agent - default to first model
            setModelId(data.data[0].id);
            setModelProvider(data.data[0].provider);
          }
        }
      } catch (err) {
        console.error("Failed to fetch models:", err);
      } finally {
        setModelsLoading(false);
      }
    }
    fetchModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount - agent prop is stable

  // Step wizard state
  const [activeStep, setActiveStep] = React.useState<StepId>("basic");
  const currentStepIndex = STEPS.findIndex((s) => s.id === activeStep);
  const currentStepConfig = STEPS.find((s) => s.id === activeStep);

  const goToPreviousStep = () => {
    if (currentStepIndex > 0) {
      setActiveStep(STEPS[currentStepIndex - 1].id);
    }
  };

  const goToNextStep = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setActiveStep(STEPS[currentStepIndex + 1].id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate required fields
    if (!modelId || !modelProvider) {
      setError("Model selection is required");
      setLoading(false);
      return;
    }

    // Validate ID for new agents
    if (!isEditing) {
      if (!generatedId) {
        setError("Agent name is required to generate ID");
        setLoading(false);
        return;
      }
      if (idClash) {
        setError(`Agent ID "${generatedId}" already exists. Please use a different name.`);
        setLoading(false);
        return;
      }
    }

    try {
      if (isEditing) {
        // Update existing agent
        const updateData: DynamicAgentConfigUpdate = {
          name,
          description: description || undefined,
          system_prompt: systemPrompt,
          visibility,
          allowed_tools: allowedTools,
          builtin_tools: builtinTools,
          subagents: subagents.length > 0 ? subagents : undefined,
          model_id: modelId,
          model_provider: modelProvider,
        };

        const response = await fetch(`/api/dynamic-agents?id=${agent._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to update agent");
        }
      } else {
        // Create new agent
        const createData: DynamicAgentConfigCreate = {
          id: generatedId,
          name,
          description: description || undefined,
          system_prompt: systemPrompt,
          visibility,
          allowed_tools: allowedTools,
          builtin_tools: builtinTools,
          subagents: subagents.length > 0 ? subagents : undefined,
          model_id: modelId,
          model_provider: modelProvider,
        };

        const response = await fetch("/api/dynamic-agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createData),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to create agent");
        }
      }

      onSave();
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const isValid = name.trim() && systemPrompt.trim() && modelId;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>{isEditing ? "Edit Custom Agent" : "Create Custom Agent"}</CardTitle>
            <CardDescription>
              {isEditing
                ? "Update the agent configuration"
                : "Configure a new custom AI agent"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Step Indicator */}
          <StepIndicator 
            steps={STEPS} 
            currentStep={activeStep} 
            onStepClick={setActiveStep} 
          />

          {/* Step hint */}
          <div className="text-center pb-2 border-b">
            <h3 className="font-medium">Step {currentStepIndex + 1}: {currentStepConfig?.label}</h3>
            <p className="text-sm text-muted-foreground">{currentStepConfig?.hint}</p>
          </div>

          {/* Basic Info Step */}
          {activeStep === "basic" && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Agent Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g., Code Review Agent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
                {/* Show generated ID */}
                {isEditing ? (
                  <p className="text-xs text-muted-foreground">
                    id: <code className="bg-muted px-1 py-0.5 rounded">{agent._id}</code>
                  </p>
                ) : generatedId ? (
                  <p className={`text-xs ${idClash ? "text-destructive" : "text-muted-foreground"}`}>
                    id: <code className={`px-1 py-0.5 rounded ${idClash ? "bg-destructive/10" : "bg-muted"}`}>
                      {generatedId}
                    </code>
                    {idClash && <span className="ml-1 font-medium">- already exists, choose a different name</span>}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="What does this agent do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loading}
                  rows={2}
                />
              </div>

              {/* LLM Model - Prominent selection */}
              <div className="space-y-2">
                <Label htmlFor="modelId">
                  LLM Model <span className="text-destructive">*</span>
                </Label>
                <div className="p-3 rounded-lg border-2 border-primary/20 bg-primary/5">
                  <select
                    id="modelId"
                    value={modelId}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const selectedModel = availableModels.find((m) => m.id === selectedId);
                      if (selectedModel) {
                        setModelId(selectedModel.id);
                        setModelProvider(selectedModel.provider);
                      }
                    }}
                    disabled={loading || modelsLoading}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {modelsLoading ? (
                      <option value="">Loading models...</option>
                    ) : availableModels.length === 0 ? (
                      <option value="">Platform Default</option>
                    ) : (
                      availableModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}{model.provider && model.provider !== "default" ? ` (${model.provider})` : ""}
                        </option>
                      ))
                    )}
                  </select>
                  <p className="text-xs text-muted-foreground mt-2">
                    The language model that powers this agent&apos;s reasoning.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Visibility</Label>
                <div className="grid grid-cols-3 gap-2">
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVisibility(opt.value)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        visibility === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-muted hover:border-primary/50"
                      }`}
                      disabled={loading}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {opt.icon}
                        <span className="font-medium text-sm">{opt.label}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{opt.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Instructions Step */}
          {activeStep === "instructions" && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="systemPrompt">
                  System Prompt <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="systemPrompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={16}
                  className="font-mono text-sm"
                  placeholder="You are a helpful AI assistant that specializes in..."
                  disabled={loading}
                />
                <p className="text-sm text-muted-foreground">
                  Define your agent's behavior, personality, and capabilities. 
                  You can paste content from an AGENTS.md file here.
                </p>
              </div>
            </div>
          )}

          {/* Tools Step */}
          {activeStep === "tools" && (
            <div className="space-y-6 pt-2">
              {/* Built-in Tools */}
              <BuiltinToolsPicker
                value={builtinTools}
                onChange={setBuiltinTools}
                disabled={loading}
              />

              {/* MCP Tools */}
              <div className="space-y-4">
                <div>
                  <Label>MCP Tool Access</Label>
                  <p className="text-xs text-muted-foreground mb-4">
                    Select which MCP servers and tools this agent can use. If no servers are selected,
                    the agent will have no external tool access.
                  </p>
                </div>

                <AllowedToolsPicker
                  value={allowedTools}
                  onChange={setAllowedTools}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {/* Subagents Step */}
          {activeStep === "subagents" && (
            <div className="space-y-4 pt-2">
              <div>
                <Label>Subagent Delegation</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Configure other custom agents that this agent can delegate tasks to.
                  The LLM will automatically decide when to use each subagent based on the description you provide.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                  Note: Subagents cannot be nested. The agents you add here will not have access to their own subagents when invoked.
                </p>
              </div>

              <SubagentPicker
                agentId={agent?._id || null}
                value={subagents}
                onChange={setSubagents}
                disabled={loading}
                parentVisibility={visibility}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Step Navigation - Right aligned */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button 
              type="button" 
              variant="outline" 
              onClick={goToPreviousStep}
              disabled={currentStepIndex === 0 || loading}
              size="sm"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              onClick={goToNextStep}
              disabled={currentStepIndex === STEPS.length - 1 || loading}
              size="sm"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </form>
      </CardContent>

      {/* Action Buttons - Outside the card content */}
      <div className="flex items-center gap-2 px-6 py-4 border-t bg-muted/30">
        <div className="text-xs text-muted-foreground mr-auto hidden sm:block">
          {builtinTools?.fetch_url?.enabled ? "1 built-in, " : ""}
          {Object.keys(allowedTools).length} MCP server(s), {subagents.length} subagent(s)
        </div>
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={loading || !isValid}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {isEditing ? "Saving..." : "Creating..."}
            </>
          ) : isEditing ? (
            "Save Changes"
          ) : (
            "Create Agent"
          )}
        </Button>
      </div>
    </Card>
  );
}
