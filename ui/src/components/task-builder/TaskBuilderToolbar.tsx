"use client";

import React from "react";
import { ArrowLeft, Save, Plus, Download, Upload, Variable, Eye } from "lucide-react";
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
  onPreview: () => void;
  onImport: () => void;
  onBack: () => void;
  isSaving: boolean;
  isEditing: boolean;
  stepCount: number;
  envVarCount: number;
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
  onPreview,
  onImport,
  onBack,
  isSaving,
  isEditing,
  stepCount,
  envVarCount,
}: TaskBuilderToolbarProps) {
  return (
    <div className="border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
      {/* Row 1: Back + metadata inputs */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 h-7 px-2 shrink-0">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>

        <div className="h-4 w-px bg-border shrink-0" />

        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Workflow name..."
          className="h-7 text-sm font-semibold flex-1 min-w-[120px] max-w-[220px]"
        />

        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className={cn(
            "flex h-7 w-[160px] rounded-md border border-input bg-transparent px-2 text-xs shadow-sm shrink-0",
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
          className="h-7 text-xs flex-1 min-w-[100px] max-w-[220px]"
        />
      </div>

      {/* Row 2: Stats + actions */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <span className="text-[10px] text-muted-foreground font-mono">
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </span>

        {envVarCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
            <Variable className="h-2.5 w-2.5" />
            {envVarCount} var{envVarCount !== 1 ? "s" : ""}
          </span>
        )}

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={onAddStep} className="gap-1 h-7 text-xs px-2">
          <Plus className="h-3 w-3" />
          Add Step
        </Button>

        <div className="h-4 w-px bg-border" />

        {/* Import/Preview/Download group */}
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            onClick={onImport}
            className="flex items-center gap-1 h-7 px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            title="Import YAML"
          >
            <Upload className="h-3 w-3" />
            Import
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            onClick={onPreview}
            disabled={stepCount === 0}
            className="flex items-center gap-1 h-7 px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Preview YAML"
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            onClick={onExportYaml}
            className="flex items-center gap-1 h-7 px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            title="Download YAML"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
        </div>

        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving || !name || stepCount === 0}
          className="gap-1 h-7 text-xs px-3 gradient-primary text-white"
        >
          <Save className="h-3 w-3" />
          {isSaving ? "Saving..." : isEditing ? "Update" : "Save"}
        </Button>
      </div>
    </div>
  );
}
