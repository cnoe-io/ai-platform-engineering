"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Globe, Users, Lock, ChevronLeft, ChevronRight, Check, Sparkles, Eye, Pencil, GripHorizontal, Bot } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getMarkdownComponents } from "@/lib/markdown-components";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

// Lazy-load CodeMirror to avoid SSR issues
const CodeMirrorEditor = React.lazy(() => import("@uiw/react-codemirror"));
import type {
  DynamicAgentConfig,
  DynamicAgentConfigCreate,
  DynamicAgentConfigUpdate,
  VisibilityType,
  SubAgentRef,
  BuiltinToolsConfig,
  AgentUIConfig,
  FeaturesConfig,
} from "@/types/dynamic-agent";
import { AllowedToolsPicker } from "./AllowedToolsPicker";
import { BuiltinToolsPicker } from "./BuiltinToolsPicker";
import { MiddlewarePicker } from "./MiddlewarePicker";
import { SubagentPicker } from "./SubagentPicker";
import { gradientThemes, getGradientStyle } from "@/lib/gradient-themes";

interface DynamicAgentEditorProps {
  agent: DynamicAgentConfig | null; // null = creating new
  cloneFrom?: DynamicAgentConfig | null; // Agent to clone from (for pre-filling)
  readOnly?: boolean; // true for config-driven agents (view only)
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
    <div className="flex items-center gap-0 ml-auto">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          {index > 0 && (
            <div className="w-5 h-0.5 bg-border mx-0.5" />
          )}
          <button
            type="button"
            onClick={() => onStepClick(step.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-md transition-colors min-w-[64px]",
              currentStep === step.id 
                ? "bg-primary/10 text-primary" 
                : "hover:bg-muted text-muted-foreground"
            )}
          >
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
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

export function DynamicAgentEditor({ agent, cloneFrom, readOnly, onSave, onCancel }: DynamicAgentEditorProps) {
  const isEditing = !!agent;
  const isCloning = !!cloneFrom;
  const { toast } = useToast();
  
  // Source for initial values: editing agent > cloning source > empty defaults
  const source = agent || cloneFrom;

  // Form state - when cloning, append " (New)" to name
  const [name, setName] = React.useState(
    isCloning && source ? `${source.name} (New)` : (source?.name || "")
  );
  const [description, setDescription] = React.useState(source?.description || "");
  const [systemPrompt, setSystemPrompt] = React.useState(source?.system_prompt || "");
  const [visibility, setVisibility] = React.useState<VisibilityType>(source?.visibility || "private");
  const [sharedWithTeams, setSharedWithTeams] = React.useState<string[]>(
    source?.shared_with_teams || []
  );
  const [allowedTools, setAllowedTools] = React.useState<Record<string, string[]>>(
    source?.allowed_tools || {}
  );
  const [builtinTools, setBuiltinTools] = React.useState<BuiltinToolsConfig | undefined>(
    source?.builtin_tools
  );
  const [subagents, setSubagents] = React.useState<SubAgentRef[]>(
    source?.subagents || []
  );
  const [features, setFeatures] = React.useState<FeaturesConfig | undefined>(
    source?.features
  );
  const [modelId, setModelId] = React.useState(source?.model_id || "");
  const [modelProvider, setModelProvider] = React.useState(source?.model_provider || "");
  const [gradientTheme, setGradientTheme] = React.useState<string>(
    source?.ui?.gradient_theme || "default"
  );

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [middlewareError, setMiddlewareError] = React.useState(false);
  const [availableModels, setAvailableModels] = React.useState<
    { model_id: string; name: string; provider: string; description: string }[]
  >([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [availableTeams, setAvailableTeams] = React.useState<
    { _id: string; name: string; description?: string }[]
  >([]);

  // AI suggestion state
  const [generatingField, setGeneratingField] = React.useState<string | null>(null);
  const [promptTab, setPromptTab] = React.useState<"edit" | "preview">("edit");
  const [editorHeight, setEditorHeight] = React.useState(480);
  const dragRef = React.useRef<{ startY: number; startHeight: number } | null>(null);
  const [showSuggestPromptInput, setShowSuggestPromptInput] = React.useState(false);
  const [suggestPromptInstruction, setSuggestPromptInstruction] = React.useState("");
  const [showSuggestBasicInput, setShowSuggestBasicInput] = React.useState(false);
  const [suggestBasicInstruction, setSuggestBasicInstruction] = React.useState("");
  const [enhanceExisting, setEnhanceExisting] = React.useState(false);
  const [enhanceExistingBasic, setEnhanceExistingBasic] = React.useState(false);
  const [promptStyle, setPromptStyle] = React.useState<"concise" | "comprehensive">("concise");

  // Editor resize drag handlers
  const handleDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: editorHeight };

    const handleDragMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientY - dragRef.current.startY;
      const newHeight = Math.max(200, Math.min(window.innerHeight * 0.85, dragRef.current.startHeight + delta));
      setEditorHeight(newHeight);
    };

    const handleDragEnd = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [editorHeight]);

  // CodeMirror extensions for markdown syntax highlighting
  const [cmExtensions, setCmExtensions] = React.useState<any[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("@codemirror/lang-markdown"),
      import("@codemirror/language-data"),
      import("@codemirror/view"),
      import("@/lib/codemirror/jinja2-highlight"),
      import("@/lib/codemirror/markdown-highlight"),
    ]).then(([mdMod, langDataMod, viewMod, jinja2Mod, mdHighlightMod]) => {
      if (!cancelled) {
        setCmExtensions([
          mdMod.markdown({ codeLanguages: langDataMod.languages }),
          viewMod.EditorView.lineWrapping,
          mdHighlightMod.markdownHighlight,
          jinja2Mod.jinja2Highlight,
        ]);
      }
    });
    return () => { cancelled = true; };
  }, []);

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
          
          if (source?.model_id) {
            // Editing or cloning existing agent - verify model exists using both model AND provider
            // (same model can exist for different providers, e.g., gpt-4o for openai and azure-openai)
            const existingModel = data.data.find(
              (m: { model_id: string; provider: string }) => 
                m.model_id === source.model_id && m.provider === source.model_provider
            );
            if (existingModel) {
              // Model exists - ensure provider is in sync with config
              setModelProvider(existingModel.provider);
            } else {
              // Model no longer available - reset to first available
              console.warn(`Agent model "${source.model_id}" no longer available, resetting to default`);
              if (data.data.length > 0) {
                setModelId(data.data[0].model_id);
                setModelProvider(data.data[0].provider);
              }
            }
          } else if (data.data.length > 0) {
            // Creating new agent - default to first model
            setModelId(data.data[0].model_id);
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

  // Fetch available teams for team visibility sharing
  React.useEffect(() => {
    async function fetchTeams() {
      try {
        const response = await fetch("/api/dynamic-agents/teams");
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
          setAvailableTeams(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch teams:", err);
      }
    }
    fetchTeams();
  }, []);

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

  /**
   * Call the AI suggest endpoint for a given field.
   * Accepts an optional instruction string for guidance.
   */
  const handleSuggest = async (
    field: "description" | "system_prompt" | "theme",
    instruction?: string
  ) => {
    if (!name.trim() || !modelId) return;

    setGeneratingField(field);
    try {
      const response = await fetch("/api/dynamic-agents/assistant/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          context: {
            name,
            description: description || undefined,
            system_prompt: systemPrompt || undefined,
            allowed_tools: Object.keys(allowedTools).length > 0 ? allowedTools : undefined,
            builtin_tools: builtinTools,
            subagents: subagents.length > 0
              ? subagents.map((s) => ({
                  agent_id: s.agent_id,
                  name: s.name || s.agent_id,
                  description: s.description,
                }))
              : undefined,
          },
          model_id: modelId,
          model_provider: modelProvider,
          ...(instruction ? { instruction } : {}),
          ...(field === "system_prompt" ? { prompt_style: promptStyle } : {}),
        }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to generate suggestion");
      }

      const content = (data.data?.content ?? "").trim();
      if (!content) {
        throw new Error("Empty response from AI");
      }

      switch (field) {
        case "description":
          setDescription(content);
          break;
        case "system_prompt":
          setSystemPrompt(content);
          // Switch to preview tab so user sees the rendered result
          setPromptTab("preview");
          break;
        case "theme": {
          // Try exact match first (after normalization)
          const normalized = content.toLowerCase().replace(/[^a-z_]/g, "");
          const exactMatch = gradientThemes.find((t) => t.id === normalized);
          if (exactMatch) {
            setGradientTheme(exactMatch.id);
          } else {
            // Fuzzy: find any valid theme ID contained in the response
            const fuzzyMatch = gradientThemes.find((t) =>
              content.toLowerCase().includes(t.id)
            );
            if (fuzzyMatch) {
              setGradientTheme(fuzzyMatch.id);
            } else {
              console.warn(`AI suggested unknown theme "${content}", ignoring`);
              toast("Could not determine theme from AI response", "error");
            }
          }
          break;
        }
      }
    } catch (err: any) {
      console.error(`AI suggest (${field}) failed:`, err);
      toast(err.message || "Failed to generate suggestion", "error");
    } finally {
      setGeneratingField(null);
    }
  };

  /**
   * Combined handler for Step 1: generates both description and theme in parallel.
   */
  const handleSuggestBasicInfo = async (instruction?: string) => {
    if (!name.trim() || !modelId) return;
    setShowSuggestBasicInput(false);
    setSuggestBasicInstruction("");
    // If enhancing existing description, pass it as context
    const existingHint = enhanceExistingBasic && description.trim()
      ? `The current description is: "${description}". Use it as a starting point and enhance/refine it.`
      : undefined;
    const fullInstruction = [existingHint, instruction].filter(Boolean).join("\n\n");
    setEnhanceExistingBasic(false);
    // Run both in parallel
    await Promise.all([
      handleSuggest("description", fullInstruction || undefined),
      handleSuggest("theme", instruction),
    ]);
  };

  /**
   * Handle system prompt suggestion via the popover.
   * If enhanceExisting is checked and content exists, pass it as context.
   */
  const handleSuggestSystemPrompt = (instruction?: string) => {
    setShowSuggestPromptInput(false);
    setSuggestPromptInstruction("");
    // If user wants to enhance existing content, pass it as context
    const existingHint = enhanceExisting && systemPrompt.trim()
      ? `The current system prompt is provided below — use it as a starting point and enhance/refine it based on the user's guidance.\n\n<current_prompt>\n${systemPrompt}\n</current_prompt>`
      : undefined;
    const fullInstruction = [existingHint, instruction].filter(Boolean).join("\n\n");
    setEnhanceExisting(false);
    handleSuggest("system_prompt", fullInstruction || undefined);
  };

  const canSuggest = name.trim() && modelId && !generatingField;
  const isGenerating = !!generatingField;

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
      // Build UI config if gradient theme is set
      const uiConfig: AgentUIConfig | undefined = gradientTheme
        ? { gradient_theme: gradientTheme }
        : undefined;

      if (isEditing) {
        // Update existing agent
        const updateData: DynamicAgentConfigUpdate = {
          name,
          description: description || undefined,
          system_prompt: systemPrompt,
          visibility,
          shared_with_teams: visibility === "team" ? sharedWithTeams : undefined,
          allowed_tools: allowedTools,
          builtin_tools: builtinTools,
          subagents: subagents.length > 0 ? subagents : undefined,
          model_id: modelId,
          model_provider: modelProvider,
          ui: uiConfig,
          features: features,
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
          shared_with_teams: visibility === "team" ? sharedWithTeams : undefined,
          allowed_tools: allowedTools,
          builtin_tools: builtinTools,
          subagents: subagents.length > 0 ? subagents : undefined,
          model_id: modelId,
          model_provider: modelProvider,
          ui: uiConfig,
          features: features,
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

  const isValid = name.trim() && systemPrompt.trim() && modelId && availableModels.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>
              {readOnly ? "View Agent" : isEditing ? "Edit Agent" : isCloning ? "Clone Agent" : "Create Agent"}
            </CardTitle>
            <CardDescription>
              {readOnly
                ? "This agent is managed by configuration and cannot be edited"
                : isEditing
                ? "Update the agent configuration"
                : isCloning
                ? `Creating a copy of "${cloneFrom?.name}"`
                : "Configure a new custom AI agent"}
            </CardDescription>
          </div>
          <div
            className="ml-auto h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-all"
            style={getGradientStyle(gradientTheme)}
          >
            <Bot className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Step Indicator + title inline */}
          <div className="flex items-center gap-4 border-b pb-3 mt-2">
            <div className="shrink-0">
              <h3 className="text-xl font-bold text-primary">Step {currentStepIndex + 1}: {currentStepConfig?.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{currentStepConfig?.hint}</p>
            </div>
            <StepIndicator 
              steps={STEPS} 
              currentStep={activeStep} 
              onStepClick={setActiveStep} 
            />
          </div>

          <fieldset disabled={readOnly} className={cn("space-y-4 min-w-0", readOnly && "opacity-70")}>

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

              {/* LLM Model - right after name so AI Suggest buttons can use it */}
              <div className="space-y-2">
                <Label htmlFor="modelId">
                  LLM Model <span className="text-destructive">*</span>
                </Label>
                <div className="p-3 rounded-lg border-2 border-primary/20 bg-primary/5">
                  <select
                    id="modelId"
                    value={`${modelId}::${modelProvider}`}
                    onChange={(e) => {
                      const lastDelimiter = e.target.value.lastIndexOf("::");
                      if (lastDelimiter > 0) {
                        const selectedId = e.target.value.slice(0, lastDelimiter);
                        const selectedProvider = e.target.value.slice(lastDelimiter + 2);
                        if (selectedId && selectedProvider) {
                          setModelId(selectedId);
                          setModelProvider(selectedProvider);
                        }
                      }
                    }}
                    disabled={loading || modelsLoading || availableModels.length === 0}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {modelsLoading ? (
                      <option value="">Loading models...</option>
                    ) : availableModels.length === 0 ? (
                      <option value="" disabled>No models available</option>
                    ) : (
                      availableModels.map((model) => (
                        <option key={`${model.model_id}::${model.provider}`} value={`${model.model_id}::${model.provider}`}>
                          {model.name}{model.provider && model.provider !== "default" ? ` (${model.provider})` : ""}
                        </option>
                      ))
                    )}
                  </select>
                  {!modelsLoading && availableModels.length === 0 ? (
                    <p className="text-xs text-destructive mt-2">
                      No LLM models available. Please check your deployment configuration.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">
                      The language model that powers this agent&apos;s reasoning.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between relative">
                  <Label htmlFor="description">Description</Label>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 px-2 border-primary/30 text-primary hover:bg-primary/10"
                      disabled={!canSuggest || loading}
                      onClick={() => { setShowSuggestBasicInput((v) => { if (!v) setEnhanceExistingBasic(!!description.trim()); return !v; }); setShowSuggestPromptInput(false); }}
                      title={!name.trim() ? "Enter a name first" : !modelId ? "Select a model first" : "AI-generate description and theme"}
                    >
                      {isGenerating && (generatingField === "description" || generatingField === "theme") ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      AI Suggest
                    </Button>
                    <AnimatePresence>
                      {showSuggestBasicInput && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute top-full right-0 mt-1 z-50 w-80 p-3 rounded-lg border border-border/50 bg-background shadow-xl"
                        >
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Describe what this agent does
                          </label>
                          <p className="text-[11px] text-muted-foreground/70 mb-2">
                            Generates a description and picks a matching theme.
                          </p>
                          <Input
                            autoFocus
                            value={suggestBasicInstruction}
                            onChange={(e) => setSuggestBasicInstruction(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSuggestBasicInfo(suggestBasicInstruction.trim() || undefined);
                              if (e.key === "Escape") setShowSuggestBasicInput(false);
                            }}
                            placeholder="e.g., Summarizes documents and answers questions..."
                            className="h-8 text-sm mb-2"
                          />
                          {description.trim() && (
                            <label className="flex items-center gap-2 mb-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={enhanceExistingBasic}
                                onChange={(e) => setEnhanceExistingBasic(e.target.checked)}
                                className="rounded border-muted"
                              />
                              <span className="text-xs text-muted-foreground">Enhance existing text</span>
                            </label>
                          )}
                          <div className="flex justify-end gap-1.5">
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowSuggestBasicInput(false)}>
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-xs gap-1 gradient-primary text-white"
                              onClick={() => handleSuggestBasicInfo(suggestBasicInstruction.trim() || undefined)}
                            >
                              <Sparkles className="h-3 w-3" />
                              Generate
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                <Textarea
                  id="description"
                  placeholder="What does this agent do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loading}
                  rows={2}
                />
              </div>

              {/* Agent Theme */}
              <div className="space-y-2">
                <Label>Agent Theme</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Choose a color theme for this agent&apos;s avatar.
                </p>
                <div className="grid grid-cols-6 gap-1.5">
                  {gradientThemes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setGradientTheme(theme.id)}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all text-left",
                        gradientTheme === theme.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      )}
                      disabled={loading}
                      title={theme.description}
                    >
                      <div
                        className="w-6 h-6 rounded-md shrink-0"
                        style={{
                          background: `linear-gradient(to bottom right, ${theme.from}, ${theme.to})`,
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-medium block truncate">{theme.label.split(' (')[0]}</span>
                        <span className="text-[10px] text-muted-foreground block truncate">
                          {theme.description}
                        </span>
                      </div>
                      {gradientTheme === theme.id && (
                        <Check className="h-3 w-3 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
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

                {/* Team selector - shown when visibility is "team" */}
                {visibility === "team" && (
                  <div className="mt-4 p-3 rounded-lg border bg-muted/30">
                    <Label className="text-sm">Share with Teams</Label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Select which teams can access this agent.
                    </p>
                    {availableTeams.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        You are not a member of any teams.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {availableTeams.map((team) => (
                          <label
                            key={team._id}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={sharedWithTeams.includes(team._id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSharedWithTeams([...sharedWithTeams, team._id]);
                                } else {
                                  setSharedWithTeams(sharedWithTeams.filter((id) => id !== team._id));
                                }
                              }}
                              disabled={loading}
                              className="rounded border-muted"
                            />
                            <span className="text-sm">{team.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Instructions Step */}
          {activeStep === "instructions" && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between relative">
                  <Label htmlFor="systemPrompt">
                    System Prompt <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 px-2 border-primary/30 text-primary hover:bg-primary/10"
                      disabled={!canSuggest || loading}
                      onClick={() => { setShowSuggestPromptInput((v) => { if (!v) setEnhanceExisting(!!systemPrompt.trim()); return !v; }); setShowSuggestBasicInput(false); }}
                      title={!name.trim() ? "Enter a name first" : !modelId ? "Select a model first" : "Generate system prompt with AI"}
                    >
                      {generatingField === "system_prompt" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      AI Suggest
                    </Button>

                    {/* Inline popover for instructions */}
                    <AnimatePresence>
                      {showSuggestPromptInput && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute top-full right-0 mt-1 z-50 w-80 p-3 rounded-lg border border-border/50 bg-background shadow-xl"
                        >
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            What should the system prompt cover?
                          </label>
                          <Input
                            autoFocus
                            value={suggestPromptInstruction}
                            onChange={(e) => setSuggestPromptInstruction(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSuggestSystemPrompt(suggestPromptInstruction.trim() || undefined);
                              if (e.key === "Escape") setShowSuggestPromptInput(false);
                            }}
                            placeholder="e.g., Focus on step-by-step reasoning..."
                            className="h-8 text-sm mb-2"
                          />
                          {systemPrompt.trim() && (
                            <label className="flex items-center gap-2 mb-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={enhanceExisting}
                                onChange={(e) => setEnhanceExisting(e.target.checked)}
                                className="rounded border-muted"
                              />
                              <span className="text-xs text-muted-foreground">Enhance existing text</span>
                            </label>
                          )}
                          <div className="flex items-center gap-1 mb-2">
                            <button
                              type="button"
                              className={cn(
                                "px-2 py-0.5 text-xs rounded-full border transition-colors",
                                promptStyle === "concise"
                                  ? "border-primary text-primary bg-primary/10"
                                  : "border-border text-muted-foreground hover:border-primary/30"
                              )}
                              onClick={() => setPromptStyle("concise")}
                            >
                              Concise
                            </button>
                            <button
                              type="button"
                              className={cn(
                                "px-2 py-0.5 text-xs rounded-full border transition-colors",
                                promptStyle === "comprehensive"
                                  ? "border-primary text-primary bg-primary/10"
                                  : "border-border text-muted-foreground hover:border-primary/30"
                              )}
                              onClick={() => setPromptStyle("comprehensive")}
                            >
                              Comprehensive
                            </button>
                          </div>
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setShowSuggestPromptInput(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-xs gap-1 gradient-primary text-white"
                              onClick={() => handleSuggestSystemPrompt(suggestPromptInstruction.trim() || undefined)}
                            >
                              <Sparkles className="h-3 w-3" />
                              Generate
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Edit / Preview tabs */}
                <div className="flex items-center gap-1 border-b border-border/30">
                  <button
                    type="button"
                    onClick={() => setPromptTab("edit")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px",
                      promptTab === "edit"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptTab("preview")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px",
                      promptTab === "preview"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                </div>

                {promptTab === "edit" ? (
                  <div className="rounded-lg overflow-hidden border border-border/30 bg-[#1e1e2e]" style={{ height: `${editorHeight}px` }}>
                    <React.Suspense
                      fallback={
                        <div className="flex items-center justify-center h-48 text-zinc-500">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          <span className="text-sm">Loading editor...</span>
                        </div>
                      }
                    >
                      <CodeMirrorEditor
                        value={systemPrompt}
                        onChange={(val: string) => setSystemPrompt(val)}
                        extensions={cmExtensions}
                        theme="dark"
                        height={`${editorHeight}px`}
                        style={{ fontSize: "15px" }}
                        basicSetup={{
                          lineNumbers: true,
                          foldGutter: true,
                          highlightActiveLine: true,
                          bracketMatching: true,
                          autocompletion: false,
                          indentOnInput: true,
                        }}
                        placeholder="You are a helpful AI assistant that specializes in..."
                        editable={!loading && generatingField !== "system_prompt"}
                      />
                    </React.Suspense>
                  </div>
                ) : (
                  <div className="rounded-lg border p-4 overflow-y-auto prose prose-sm dark:prose-invert max-w-none" style={{ height: `${editorHeight}px` }}>
                    {systemPrompt.trim() ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={getMarkdownComponents()}
                      >
                        {systemPrompt}
                      </ReactMarkdown>
                    ) : (
                      <p className="text-muted-foreground italic text-sm">
                        Nothing to preview. Switch to Edit to write your system prompt.
                      </p>
                    )}
                  </div>
                )}

                {/* Drag handle to resize editor */}
                <div
                  onMouseDown={handleDragStart}
                  className="flex items-center justify-center h-3 cursor-row-resize group hover:bg-muted/50 rounded-b-lg transition-colors"
                >
                  <GripHorizontal className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground" />
                </div>

                <p className="text-sm text-muted-foreground">
                  Define your agent&apos;s behavior, personality, and capabilities. 
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

              {/* Advanced: Middleware */}
              <div className="border-t pt-4">
                <MiddlewarePicker
                  value={features}
                  onChange={setFeatures}
                  disabled={loading}
                  availableModels={availableModels}
                  onError={setMiddlewareError}
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
          </fieldset>

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
          {readOnly ? (
            "This agent is config-driven and cannot be modified"
          ) : (
            <>
              {builtinTools?.fetch_url?.enabled ? "1 built-in, " : ""}
              {Object.keys(allowedTools).length} MCP server(s), {subagents.length} subagent(s)
            </>
          )}
        </div>
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button onClick={handleSubmit} disabled={loading || !isValid || middlewareError}>
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
        )}
      </div>
    </Card>
  );
}
