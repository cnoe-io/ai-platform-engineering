"use client";

import React, { useRef } from "react";
import YAML from "yaml";
import { ArrowLeft, Save, Play, Trash2, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WorkflowToolbarProps {
  name: string;
  description: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onSave: () => void;
  onBack: () => void;
  onRun?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onImport?: (config: unknown) => void;
  isSaving: boolean;
  isEditing: boolean;
  stepCount: number;
  readOnly?: boolean;
}

export function WorkflowToolbar({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onSave,
  onBack,
  onRun,
  onDelete,
  onExport,
  onImport,
  isSaving,
  isEditing,
  stepCount,
  readOnly,
}: WorkflowToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        // Try YAML first (also handles JSON since JSON is valid YAML)
        const parsed = YAML.parse(text);
        onImport(parsed);
      } catch {
        console.error("Invalid YAML/JSON file");
      }
    };
    reader.readAsText(file);
    // Reset so same file can be re-imported
    e.target.value = "";
  };

  return (
    <div className="px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
      {/* Single row: Back | Name & Desc | Actions */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 h-8 px-2.5 shrink-0">
          <ArrowLeft className="h-4 w-4" />
          Exit
        </Button>

        <div className="h-5 w-px bg-border shrink-0" />

        {/* Name & description fields */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex flex-col gap-0.5 min-w-[160px] max-w-[260px]">
            <label className="text-[10px] text-muted-foreground font-medium leading-none">
              Workflow Name
            </label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Workflow name..."
              className="h-8 text-sm font-semibold"
              readOnly={readOnly}
            />
          </div>

          <div className="flex flex-col gap-0.5 min-w-[140px] max-w-[320px] flex-1">
            <label className="text-[10px] text-muted-foreground font-medium leading-none">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Description (optional)"
              className="h-8 text-sm"
              readOnly={readOnly}
            />
          </div>
        </div>

        {/* Step count badge */}
        <span className="text-xs text-muted-foreground font-mono shrink-0 bg-muted/50 px-2 py-0.5 rounded">
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </span>

        <div className="h-5 w-px bg-border shrink-0" />

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {onExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              className="gap-1.5 h-8 text-xs px-3"
              title="Download workflow as YAML"
            >
              <Upload className="h-3.5 w-3.5" />
              Export
            </Button>
          )}
          {onImport && !readOnly && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportClick}
                className="gap-1.5 h-8 text-xs px-3"
                title="Upload workflow YAML"
              >
                <Download className="h-3.5 w-3.5" />
                Import
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml,.json"
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}

          {onDelete && isEditing && !readOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="gap-1.5 h-8 text-xs px-3 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}

          {onRun && isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRun}
              disabled={stepCount === 0}
              className="gap-1.5 h-8 text-xs px-3 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </Button>
          )}

          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving || !name || stepCount === 0 || readOnly}
            className="gap-1.5 h-8 text-xs px-4 gradient-primary text-white"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
