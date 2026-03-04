"use client";

import React from "react";
import { ArrowLeft, Save, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TaskConfigCategory } from "@/types/task-config";

const CATEGORY_OPTIONS: TaskConfigCategory[] = [
  "GitHub Operations",
  "AWS Operations",
  "ArgoCD Operations",
  "AI Gateway Operations",
  "Group Management",
  "Custom",
];

interface TaskBuilderToolbarProps {
  name: string;
  category: string;
  description: string;
  onNameChange: (name: string) => void;
  onCategoryChange: (category: string) => void;
  onDescriptionChange: (description: string) => void;
  onAddStep: () => void;
  onSave: () => void;
  onExportYaml: () => void;
  onBack: () => void;
  isSaving: boolean;
  isEditing: boolean;
  stepCount: number;
}

export function TaskBuilderToolbar({
  name,
  category,
  description,
  onNameChange,
  onCategoryChange,
  onDescriptionChange,
  onAddStep,
  onSave,
  onExportYaml,
  onBack,
  isSaving,
  isEditing,
  stepCount,
}: TaskBuilderToolbarProps) {
  return (
    <div className="border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="h-5 w-px bg-border" />

        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Workflow name..."
          className="max-w-[240px] h-8 text-sm font-semibold"
        />

        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className={cn(
            "flex h-8 w-[180px] rounded-md border border-input bg-transparent px-3 text-sm shadow-sm",
            "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          {CATEGORY_OPTIONS.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <Input
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Description (optional)"
          className="max-w-[260px] h-8 text-sm"
        />

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground font-mono">
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </span>

        <Button variant="outline" size="sm" onClick={onAddStep} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Step
        </Button>

        <Button variant="outline" size="sm" onClick={onExportYaml} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>

        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving || !name || stepCount === 0}
          className="gap-1.5 gradient-primary text-white"
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? "Saving..." : isEditing ? "Update" : "Save"}
        </Button>
      </div>
    </div>
  );
}
