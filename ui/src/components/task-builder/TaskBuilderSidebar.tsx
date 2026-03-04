"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubagentSelector } from "./SubagentSelector";
import type { TaskStep } from "@/types/task-config";

interface TaskBuilderSidebarProps {
  step: TaskStep | null;
  stepIndex: number;
  onChange: (updates: Partial<TaskStep>) => void;
}

export function TaskBuilderSidebar({ step, stepIndex, onChange }: TaskBuilderSidebarProps) {
  if (!step) {
    return (
      <div className="w-80 border-l border-border bg-card/50 p-6 flex items-center justify-center">
        <p className="text-sm text-muted-foreground text-center">
          Select a step on the canvas to edit its properties
        </p>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-border bg-card/50 overflow-y-auto">
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-bold text-foreground">Step #{stepIndex + 1}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Edit step properties</p>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="display_text" className="text-xs font-semibold">
            Display Text
          </Label>
          <Input
            id="display_text"
            value={step.display_text}
            onChange={(e) => onChange({ display_text: e.target.value })}
            placeholder="e.g., Collect repository details"
            className="text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="subagent" className="text-xs font-semibold">
            Subagent
          </Label>
          <SubagentSelector
            value={step.subagent}
            onChange={(value) => onChange({ subagent: value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="llm_prompt" className="text-xs font-semibold">
            LLM Prompt
          </Label>
          <Textarea
            id="llm_prompt"
            value={step.llm_prompt}
            onChange={(e) => onChange({ llm_prompt: e.target.value })}
            placeholder="Instructions for the subagent..."
            className="text-sm font-mono min-h-[300px] resize-y"
          />
          <p className="text-[10px] text-muted-foreground">
            Use {"${VAR_NAME}"} for environment variable substitution
          </p>
        </div>
      </div>
    </div>
  );
}
