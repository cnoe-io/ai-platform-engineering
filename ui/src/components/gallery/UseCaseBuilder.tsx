"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Save, Loader2, CheckCircle, AlertCircle } from "lucide-react";
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
import { DEFAULT_AGENTS } from "@/components/chat/CustomCallButtons";
import { cn } from "@/lib/utils";

interface UseCaseBuilderProps {
  onSuccess?: () => void;
  existingUseCase?: {
    id: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    prompt: string;
    expectedAgents: string[];
    difficulty: "beginner" | "intermediate" | "advanced";
  };
}

const CATEGORIES = [
  "DevOps & Operations",
  "Development",
  "Cloud & Security",
  "Project Management",
];

const DIFFICULTY_LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

export function UseCaseBuilder({ onSuccess, existingUseCase }: UseCaseBuilderProps) {
  const isEditMode = !!existingUseCase;
  
  const [formData, setFormData] = useState({
    title: existingUseCase?.title || "",
    description: existingUseCase?.description || "",
    systemPrompt: existingUseCase?.prompt || "",
    category: existingUseCase?.category || "",
    tags: existingUseCase?.tags?.join(", ") || "",
    difficulty: existingUseCase?.difficulty || "beginner",
  });
  const [selectedAgents, setSelectedAgents] = useState<string[]>(existingUseCase?.expectedAgents || []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user types
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    }
    if (!formData.description.trim()) {
      newErrors.description = "Description is required";
    }
    if (!formData.systemPrompt.trim()) {
      newErrors.systemPrompt = "System prompt is required";
    }
    if (!formData.category) {
      newErrors.category = "Category is required";
    }
    if (selectedAgents.length === 0) {
      newErrors.agents = "At least one agent must be selected";
    }

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
      // Parse tags (comma-separated)
      const tags = formData.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const useCaseData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        category: formData.category,
        tags,
        prompt: formData.systemPrompt.trim(),
        expectedAgents: selectedAgents,
        difficulty: formData.difficulty,
      };

      const url = isEditMode 
        ? `/api/usecases?id=${existingUseCase!.id}`
        : "/api/usecases";
      
      const response = await fetch(url, {
        method: isEditMode ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(useCaseData),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: `Failed to ${isEditMode ? "update" : "save"} use case` }));
        throw new Error(error.error || `Failed to ${isEditMode ? "update" : "save"} use case`);
      }

      setSubmitStatus("success");
      
      // Reset form only if creating new use case
      if (!isEditMode) {
        setFormData({
          title: "",
          description: "",
          systemPrompt: "",
          category: "",
          tags: "",
          difficulty: "beginner",
        });
        setSelectedAgents([]);
        setErrors({});
      }

      // Call success callback if provided
      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
    } catch (error) {
      console.error("Error saving use case:", error);
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pb-4">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Title <span className="text-red-400">*</span>
            </label>
            <Input
              value={formData.title}
              onChange={(e) => handleInputChange("title", e.target.value)}
              placeholder="e.g., Check Deployment Status"
              className={cn(
                "h-9 text-sm",
                errors.title && "border-red-500 focus-visible:ring-red-500"
              )}
            />
            {errors.title && (
              <p className="text-xs text-red-400 mt-1">{errors.title}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange("description", e.target.value)}
              placeholder="Brief description of what this use case does..."
              rows={3}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                errors.description && "border-red-500 focus-visible:ring-red-500"
              )}
            />
            {errors.description && (
              <p className="text-xs text-red-400 mt-1">{errors.description}</p>
            )}
          </div>

          {/* System Prompt */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              System Prompt <span className="text-red-400">*</span>
            </label>
            <textarea
              value={formData.systemPrompt}
              onChange={(e) => handleInputChange("systemPrompt", e.target.value)}
              placeholder="Enter the system prompt that will be used for this use case..."
              rows={6}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none font-mono",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                errors.systemPrompt && "border-red-500 focus-visible:ring-red-500"
              )}
            />
            {errors.systemPrompt && (
              <p className="text-xs text-red-400 mt-1">{errors.systemPrompt}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              This prompt will be used when the use case is selected
            </p>
          </div>

          {/* Agents */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Agents <span className="text-red-400">*</span>
            </label>
            <div className="space-y-2">
              {DEFAULT_AGENTS.map((agent) => (
                <label
                  key={agent.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                    selectedAgents.includes(agent.id)
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/30 border-border/50 hover:bg-muted/50"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgents.includes(agent.id)}
                    onChange={() => toggleAgent(agent.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-foreground">{agent.label}</span>
                </label>
              ))}
            </div>
            {errors.agents && (
              <p className="text-xs text-red-400 mt-1">{errors.agents}</p>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Category <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <label
                  key={cat}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
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
                    className="h-4 w-4 border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-foreground">{cat}</span>
                </label>
              ))}
            </div>
            {errors.category && (
              <p className="text-xs text-red-400 mt-1">{errors.category}</p>
            )}
          </div>

          {/* Difficulty */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Difficulty
            </label>
            <div className="flex gap-2">
              {DIFFICULTY_LEVELS.map((level) => (
                <label
                  key={level.value}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                    formData.difficulty === level.value
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/30 border-border/50 hover:bg-muted/50"
                  )}
                >
                  <input
                    type="radio"
                    name="difficulty"
                    value={level.value}
                    checked={formData.difficulty === level.value}
                    onChange={(e) => handleInputChange("difficulty", e.target.value)}
                    className="h-4 w-4 border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-foreground">{level.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Tags (comma-separated)
            </label>
            <Input
              value={formData.tags}
              onChange={(e) => handleInputChange("tags", e.target.value)}
              placeholder="e.g., Kubernetes, ArgoCD, Monitoring"
              className="h-9 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Separate multiple tags with commas
            </p>
          </div>

          {/* Submit Status */}
          {submitStatus === "success" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-md bg-green-500/15 border border-green-500/30"
            >
              <CheckCircle className="h-4 w-4 text-green-400" />
              <p className="text-sm text-green-400">Use case saved successfully!</p>
            </motion.div>
          )}

          {submitStatus === "error" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-md bg-red-500/15 border border-red-500/30"
            >
              <AlertCircle className="h-4 w-4 text-red-400" />
              <p className="text-sm text-red-400">Failed to save use case. Please try again.</p>
            </motion.div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full gap-2 bg-gradient-to-r from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] hover:opacity-90 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{isEditMode ? "Updating..." : "Saving..."}</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>{isEditMode ? "Update Use Case" : "Save Use Case"}</span>
              </>
            )}
          </Button>
        </form>
  );
}

/**
 * UseCaseBuilderDialog - Wraps UseCaseBuilder in a Dialog
 */
interface UseCaseBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  existingUseCase?: {
    id: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    prompt: string;
    expectedAgents: string[];
    difficulty: "beginner" | "intermediate" | "advanced";
  };
}

export function UseCaseBuilderDialog({
  open,
  onOpenChange,
  onSuccess,
  existingUseCase,
}: UseCaseBuilderDialogProps) {
  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    }
    // Close dialog after a short delay to show success message
    setTimeout(() => {
      onOpenChange(false);
    }, 1500);
  };

  const isEditMode = !!existingUseCase;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] flex items-center justify-center shadow-lg shadow-primary/30">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="gradient-text">
                {isEditMode ? "Edit Use Case" : "Use Case Builder"}
              </DialogTitle>
              <DialogDescription>
                {isEditMode 
                  ? "Update the use case details, system prompt, and agent configurations"
                  : "Create custom use cases with system prompts and agent configurations"
                }
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ minHeight: 0 }}>
          <UseCaseBuilder onSuccess={handleSuccess} existingUseCase={existingUseCase} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
