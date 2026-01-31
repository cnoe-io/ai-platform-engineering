"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  GripVertical,
  Upload,
  FileCode,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAgentConfigStore } from "@/store/agent-config-store";
import type {
  AgentConfig,
  AgentConfigTask,
  AgentConfigCategory,
  CreateAgentConfigInput,
  WorkflowDifficulty,
} from "@/types/agent-config";

interface AgentBuilderEditorProps {
  existingConfig?: AgentConfig;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const CATEGORIES: (AgentConfigCategory | string)[] = [
  "DevOps",
  "Development",
  "Operations",
  "Cloud",
  "Project Management",
  "Security",
  "Infrastructure",
  "Knowledge",
  "GitHub Operations",
  "AWS Operations",
  "ArgoCD Operations",
  "AI Gateway Operations",
  "Group Management",
  "Custom",
];

const DIFFICULTIES: { id: WorkflowDifficulty; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

const THUMBNAIL_OPTIONS = [
  "Zap", "GitBranch", "GitPullRequest", "Server", "Cloud", "Rocket",
  "Shield", "Database", "BarChart", "Users", "AlertTriangle", "CheckCircle",
  "Settings", "Key", "Workflow", "Bug", "Clock",
];

const SUBAGENTS = [
  { id: "caipe", label: "CAIPE (User Input)", description: "Collect user input via forms" },
  { id: "github", label: "GitHub", description: "GitHub operations via gh CLI" },
  { id: "aws", label: "AWS", description: "AWS resource provisioning" },
  { id: "argocd", label: "ArgoCD", description: "ArgoCD deployments" },
  { id: "aigateway", label: "AI Gateway", description: "LLM API key management" },
  { id: "webex", label: "Webex", description: "Webex notifications" },
  { id: "jira", label: "Jira", description: "Jira ticket operations" },
];

const emptyTask: AgentConfigTask = {
  display_text: "",
  llm_prompt: "",
  subagent: "caipe",
};

export function AgentBuilderEditor({
  existingConfig,
  onSuccess,
  onCancel,
}: AgentBuilderEditorProps) {
  const isEditMode = !!existingConfig;
  const { createConfig, updateConfig } = useAgentConfigStore();

  const [isQuickStart, setIsQuickStart] = useState(existingConfig?.is_quick_start ?? false);
  const [formData, setFormData] = useState({
    name: existingConfig?.name || "",
    description: existingConfig?.description || "",
    category: existingConfig?.category || "Custom",
    difficulty: existingConfig?.difficulty || "beginner" as WorkflowDifficulty,
    thumbnail: existingConfig?.thumbnail || "Zap",
    tags: existingConfig?.metadata?.tags?.join(", ") || "",
  });
  const [tasks, setTasks] = useState<AgentConfigTask[]>(
    existingConfig?.tasks || [{ ...emptyTask }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set([0]));

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleTaskChange = (index: number, field: keyof AgentConfigTask, value: string) => {
    setTasks((prev) => {
      const newTasks = [...prev];
      newTasks[index] = { ...newTasks[index], [field]: value };
      return newTasks;
    });
    
    // Clear task-specific errors
    const errorKey = `task_${index}_${field}`;
    if (errors[errorKey]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    }
  };

  const addTask = () => {
    setTasks((prev) => [...prev, { ...emptyTask }]);
    setExpandedTasks((prev) => new Set([...prev, tasks.length]));
  };

  const removeTask = (index: number) => {
    if (tasks.length <= 1) return;
    setTasks((prev) => prev.filter((_, i) => i !== index));
    setExpandedTasks((prev) => {
      const newSet = new Set(prev);
      newSet.delete(index);
      // Adjust indices for tasks after the removed one
      const adjusted = new Set<number>();
      newSet.forEach((i) => {
        if (i > index) {
          adjusted.add(i - 1);
        } else {
          adjusted.add(i);
        }
      });
      return adjusted;
    });
  };

  const toggleTaskExpanded = (index: number) => {
    setExpandedTasks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const moveTask = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= tasks.length) return;
    
    setTasks((prev) => {
      const newTasks = [...prev];
      [newTasks[index], newTasks[newIndex]] = [newTasks[newIndex], newTasks[index]];
      return newTasks;
    });
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }
    if (!formData.category) {
      newErrors.category = "Category is required";
    }
    if (tasks.length === 0) {
      newErrors.tasks = "At least one task is required";
    }

    tasks.forEach((task, index) => {
      if (!task.display_text.trim()) {
        newErrors[`task_${index}_display_text`] = "Display text is required";
      }
      if (!task.llm_prompt.trim()) {
        newErrors[`task_${index}_llm_prompt`] = "LLM prompt is required";
      }
      if (!task.subagent) {
        newErrors[`task_${index}_subagent`] = "Subagent is required";
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      // Parse tags from comma-separated string
      const tags = formData.tags
        .split(",")
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const configData: CreateAgentConfigInput = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        category: formData.category,
        tasks: isQuickStart ? [tasks[0]] : tasks, // Quick-start only uses first task
        is_quick_start: isQuickStart,
        difficulty: isQuickStart ? formData.difficulty : undefined,
        thumbnail: isQuickStart ? formData.thumbnail : undefined,
        metadata: {
          tags: tags.length > 0 ? tags : undefined,
        },
      };

      if (isEditMode && existingConfig) {
        await updateConfig(existingConfig.id, configData);
      } else {
        await createConfig(configData);
      }

      setSubmitStatus("success");

      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
    } catch (error) {
      console.error("Error saving agent config:", error);
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Workflow Type Toggle */}
      <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg border border-border/50">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-foreground">Workflow Type</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isQuickStart 
              ? "Quick-start: Single prompt that runs directly in chat"
              : "Multi-step: Sequential workflow with multiple tasks"}
          </p>
        </div>
        <div className="flex items-center bg-muted/50 rounded-full p-1">
          <button
            type="button"
            onClick={() => setIsQuickStart(false)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              !isQuickStart ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Multi-Step
          </button>
          <button
            type="button"
            onClick={() => setIsQuickStart(true)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              isQuickStart ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Quick Start
          </button>
        </div>
      </div>

      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Basic Information</h3>
        
        {/* Name */}
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">
            {isQuickStart ? "Template Name" : "Workflow Name"} <span className="text-red-400">*</span>
          </label>
          <Input
            value={formData.name}
            onChange={(e) => handleInputChange("name", e.target.value)}
            placeholder={isQuickStart ? "e.g., Check Deployment Status" : "e.g., Create GitHub Repo"}
            className={cn(
              "h-9 text-sm",
              errors.name && "border-red-500 focus-visible:ring-red-500"
            )}
          />
          {errors.name && (
            <p className="text-xs text-red-400 mt-1">{errors.name}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => handleInputChange("description", e.target.value)}
            placeholder="Brief description of what this workflow does..."
            rows={2}
            className={cn(
              "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            )}
          />
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">
            Tags
          </label>
          <Input
            value={formData.tags}
            onChange={(e) => handleInputChange("tags", e.target.value)}
            placeholder="e.g., GitHub, CI/CD, Monitoring (comma-separated)"
            className="h-9 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">Separate tags with commas</p>
        </div>

        {/* Category */}
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">
            Category <span className="text-red-400">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto">
            {CATEGORIES.map((cat) => (
              <label
                key={cat}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-sm",
                  formData.category === cat
                    ? "bg-primary/10 border-primary/30"
                    : "bg-muted/30 border-border/50 hover:bg-muted/50"
                )}
              >
                <input
                  type="radio"
                  name="category"
                  value={cat}
                  checked={formData.category === cat}
                  onChange={(e) => handleInputChange("category", e.target.value)}
                  className="h-3 w-3 border-border text-primary focus:ring-primary"
                />
                <span className="text-xs">{cat}</span>
              </label>
            ))}
          </div>
          {errors.category && (
            <p className="text-xs text-red-400 mt-1">{errors.category}</p>
          )}
        </div>

        {/* Quick-start specific fields */}
        {isQuickStart && (
          <>
            {/* Difficulty */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">
                Difficulty
              </label>
              <div className="flex gap-2">
                {DIFFICULTIES.map((diff) => (
                  <label
                    key={diff.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors",
                      formData.difficulty === diff.id
                        ? "bg-primary/10 border-primary/30"
                        : "bg-muted/30 border-border/50 hover:bg-muted/50"
                    )}
                  >
                    <input
                      type="radio"
                      name="difficulty"
                      value={diff.id}
                      checked={formData.difficulty === diff.id}
                      onChange={(e) => handleInputChange("difficulty", e.target.value)}
                      className="h-3 w-3 border-border text-primary focus:ring-primary"
                    />
                    <span className="text-xs">{diff.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Thumbnail Icon */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">
                Icon
              </label>
              <div className="flex flex-wrap gap-2">
                {THUMBNAIL_OPTIONS.map((icon) => (
                  <label
                    key={icon}
                    className={cn(
                      "flex items-center justify-center w-10 h-10 rounded-md border cursor-pointer transition-colors",
                      formData.thumbnail === icon
                        ? "bg-primary/10 border-primary/30"
                        : "bg-muted/30 border-border/50 hover:bg-muted/50"
                    )}
                    title={icon}
                  >
                    <input
                      type="radio"
                      name="thumbnail"
                      value={icon}
                      checked={formData.thumbnail === icon}
                      onChange={(e) => handleInputChange("thumbnail", e.target.value)}
                      className="sr-only"
                    />
                    <span className="text-xs">{icon.slice(0, 2)}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tasks */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            {isQuickStart ? "Prompt" : "Workflow Steps"} <span className="text-red-400">*</span>
          </h3>
          {!isQuickStart && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTask}
              className="gap-1 text-xs"
            >
              <Plus className="h-3 w-3" />
              Add Step
            </Button>
          )}
        </div>

        {errors.tasks && (
          <p className="text-xs text-red-400">{errors.tasks}</p>
        )}

        {isQuickStart ? (
          /* Quick-start: Single prompt input */
          <div className="space-y-4 p-4 border border-border/50 rounded-lg">
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">
                Prompt Template <span className="text-red-400">*</span>
              </label>
              <textarea
                value={tasks[0]?.llm_prompt || ""}
                onChange={(e) => handleTaskChange(0, "llm_prompt", e.target.value)}
                placeholder="Enter the prompt that will be sent to the AI. Use {{variable}} for user inputs..."
                rows={6}
                className={cn(
                  "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none font-mono",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  errors["task_0_llm_prompt"] && "border-red-500"
                )}
              />
              {errors["task_0_llm_prompt"] && (
                <p className="text-xs text-red-400 mt-1">{errors["task_0_llm_prompt"]}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Use {"{{variable_name}}"} for user inputs (e.g., {"{{prUrl}}"} for a PR URL)
              </p>
            </div>
          </div>
        ) : (
          /* Multi-step: Task list */
          <div className="space-y-3">
            {tasks.map((task, index) => {
            const isExpanded = expandedTasks.has(index);
            const hasErrors =
              errors[`task_${index}_display_text`] ||
              errors[`task_${index}_llm_prompt`] ||
              errors[`task_${index}_subagent`];

            return (
              <motion.div
                key={index}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={cn(
                  "border rounded-lg overflow-hidden",
                  hasErrors ? "border-red-500/50" : "border-border/50"
                )}
              >
                {/* Task Header */}
                <div
                  className={cn(
                    "flex items-center gap-2 p-3 cursor-pointer",
                    "bg-muted/30 hover:bg-muted/50 transition-colors"
                  )}
                  onClick={() => toggleTaskExpanded(index)}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="secondary" className="text-xs">
                    Step {index + 1}
                  </Badge>
                  <span className="flex-1 text-sm truncate">
                    {task.display_text || "Untitled step"}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {task.subagent}
                  </Badge>
                  
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveTask(index, "up");
                      }}
                      disabled={index === 0}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveTask(index, "down");
                      }}
                      disabled={index === tasks.length - 1}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-400 hover:text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTask(index);
                      }}
                      disabled={tasks.length <= 1}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Task Content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 space-y-4 border-t border-border/50">
                        {/* Display Text */}
                        <div>
                          <label className="text-xs font-medium text-foreground mb-1.5 block">
                            Display Text <span className="text-red-400">*</span>
                          </label>
                          <Input
                            value={task.display_text}
                            onChange={(e) =>
                              handleTaskChange(index, "display_text", e.target.value)
                            }
                            placeholder="e.g., Collect repository details from user"
                            className={cn(
                              "h-9 text-sm",
                              errors[`task_${index}_display_text`] &&
                                "border-red-500 focus-visible:ring-red-500"
                            )}
                          />
                          {errors[`task_${index}_display_text`] && (
                            <p className="text-xs text-red-400 mt-1">
                              {errors[`task_${index}_display_text`]}
                            </p>
                          )}
                        </div>

                        {/* Subagent */}
                        <div>
                          <label className="text-xs font-medium text-foreground mb-1.5 block">
                            Subagent <span className="text-red-400">*</span>
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {SUBAGENTS.map((agent) => (
                              <label
                                key={agent.id}
                                className={cn(
                                  "flex flex-col p-2 rounded-md border cursor-pointer transition-colors",
                                  task.subagent === agent.id
                                    ? "bg-primary/10 border-primary/30"
                                    : "bg-muted/30 border-border/50 hover:bg-muted/50"
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`subagent_${index}`}
                                    value={agent.id}
                                    checked={task.subagent === agent.id}
                                    onChange={(e) =>
                                      handleTaskChange(index, "subagent", e.target.value)
                                    }
                                    className="h-3 w-3 border-border text-primary focus:ring-primary"
                                  />
                                  <span className="text-xs font-medium">{agent.label}</span>
                                </div>
                                <span className="text-xs text-muted-foreground ml-5">
                                  {agent.description}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* LLM Prompt */}
                        <div>
                          <label className="text-xs font-medium text-foreground mb-1.5 block">
                            LLM Prompt <span className="text-red-400">*</span>
                          </label>
                          <textarea
                            value={task.llm_prompt}
                            onChange={(e) =>
                              handleTaskChange(index, "llm_prompt", e.target.value)
                            }
                            placeholder="Enter the prompt template. Use {variable_name} for placeholders..."
                            rows={6}
                            className={cn(
                              "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none font-mono",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              errors[`task_${index}_llm_prompt`] &&
                                "border-red-500 focus-visible:ring-red-500"
                            )}
                          />
                          {errors[`task_${index}_llm_prompt`] && (
                            <p className="text-xs text-red-400 mt-1">
                              {errors[`task_${index}_llm_prompt`]}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Use {"{variable_name}"} for user inputs and {"${ENV_VAR}"} for environment variables
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
          </div>
        )}
      </div>

      {/* Submit Status */}
      {submitStatus === "success" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-3 rounded-md bg-green-500/15 border border-green-500/30"
        >
          <CheckCircle className="h-4 w-4 text-green-400" />
          <p className="text-sm text-green-400">Workflow saved successfully!</p>
        </motion.div>
      )}

      {submitStatus === "error" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-3 rounded-md bg-red-500/15 border border-red-500/30"
        >
          <AlertCircle className="h-4 w-4 text-red-400" />
          <p className="text-sm text-red-400">Failed to save workflow. Please try again.</p>
        </motion.div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-border/50">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 gap-2 gradient-primary hover:opacity-90 text-white"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{isEditMode ? "Updating..." : "Saving..."}</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>{isEditMode ? "Update Workflow" : "Save Workflow"}</span>
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

/**
 * AgentBuilderEditorDialog - Wraps AgentBuilderEditor in a Dialog
 */
interface AgentBuilderEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  existingConfig?: AgentConfig;
}

export function AgentBuilderEditorDialog({
  open,
  onOpenChange,
  onSuccess,
  existingConfig,
}: AgentBuilderEditorDialogProps) {
  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    }
    setTimeout(() => {
      onOpenChange(false);
    }, 1500);
  };

  const isEditMode = !!existingConfig;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl p-0 overflow-hidden"
        style={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary-br flex items-center justify-center shadow-lg shadow-primary/30">
              <FileCode className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="gradient-text">
                {isEditMode ? "Edit Workflow" : "Create Workflow"}
              </DialogTitle>
              <DialogDescription>
                {isEditMode
                  ? "Update the workflow steps and configuration"
                  : "Define a multi-step agent workflow"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div
          className="flex-1 overflow-y-auto px-6 pb-6"
          style={{ minHeight: 0 }}
        >
          <AgentBuilderEditor
            onSuccess={handleSuccess}
            onCancel={() => onOpenChange(false)}
            existingConfig={existingConfig}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * YamlImportDialog - Dialog for importing YAML configurations
 */
interface YamlImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function YamlImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: YamlImportDialogProps) {
  const { importFromYaml } = useAgentConfigStore();
  const [yamlContent, setYamlContent] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState(0);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setYamlContent(content);
    };
    reader.readAsText(file);
  }, []);

  const handleImport = async () => {
    if (!yamlContent.trim()) return;

    setIsImporting(true);
    setImportStatus("idle");
    setImportError(null);

    try {
      const ids = await importFromYaml(yamlContent);
      setImportedCount(ids.length);
      setImportStatus("success");

      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
          onOpenChange(false);
        }, 1500);
      }
    } catch (error: any) {
      console.error("Failed to import YAML:", error);
      setImportError(error.message);
      setImportStatus("error");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center">
              <Upload className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle>Import from YAML</DialogTitle>
              <DialogDescription>
                Import workflow configurations from a task_config.yaml file
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Upload YAML File
            </label>
            <Input
              type="file"
              accept=".yaml,.yml"
              onChange={handleFileUpload}
              className="cursor-pointer"
            />
          </div>

          {/* Or paste */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or paste YAML content
              </span>
            </div>
          </div>

          {/* YAML Content */}
          <textarea
            value={yamlContent}
            onChange={(e) => setYamlContent(e.target.value)}
            placeholder="Paste your task_config.yaml content here..."
            rows={12}
            className={cn(
              "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none font-mono",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            )}
          />

          {/* Status Messages */}
          {importStatus === "success" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-md bg-green-500/15 border border-green-500/30"
            >
              <CheckCircle className="h-4 w-4 text-green-400" />
              <p className="text-sm text-green-400">
                Successfully imported {importedCount} workflow(s)!
              </p>
            </motion.div>
          )}

          {importStatus === "error" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-md bg-red-500/15 border border-red-500/30"
            >
              <AlertCircle className="h-4 w-4 text-red-400" />
              <p className="text-sm text-red-400">
                {importError || "Failed to import YAML"}
              </p>
            </motion.div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!yamlContent.trim() || isImporting}
            className="gap-2 gradient-primary text-white"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Import
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
