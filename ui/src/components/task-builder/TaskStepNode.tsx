"use client";

import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TaskStepNodeData {
  stepIndex: number;
  display_text: string;
  llm_prompt: string;
  subagent: string;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

const SUBAGENT_STYLES: Record<string, { bg: string; border: string; badge: string; label: string }> = {
  caipe:     { bg: "bg-yellow-500/10", border: "border-yellow-500/40", badge: "bg-yellow-500/20 text-yellow-300", label: "User Input" },
  github:    { bg: "bg-purple-500/10", border: "border-purple-500/40", badge: "bg-purple-500/20 text-purple-300", label: "GitHub" },
  backstage: { bg: "bg-purple-500/10", border: "border-purple-500/40", badge: "bg-purple-500/20 text-purple-300", label: "Backstage" },
  aws:       { bg: "bg-purple-500/10", border: "border-purple-500/40", badge: "bg-purple-500/20 text-purple-300", label: "AWS" },
  argocd:    { bg: "bg-purple-500/10", border: "border-purple-500/40", badge: "bg-purple-500/20 text-purple-300", label: "ArgoCD" },
  aigateway: { bg: "bg-purple-500/10", border: "border-purple-500/40", badge: "bg-purple-500/20 text-purple-300", label: "AI Gateway" },
  jira:      { bg: "bg-blue-500/10",   border: "border-blue-500/40",   badge: "bg-blue-500/20 text-blue-300",   label: "Jira" },
  webex:     { bg: "bg-green-500/10",  border: "border-green-500/40",  badge: "bg-green-500/20 text-green-300",  label: "Webex" },
};

const DEFAULT_STYLE = { bg: "bg-slate-500/10", border: "border-slate-500/40", badge: "bg-slate-500/20 text-slate-300", label: "Custom" };

function TaskStepNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as TaskStepNodeData;
  const style = SUBAGENT_STYLES[nodeData.subagent] || DEFAULT_STYLE;

  return (
    <div
      className={cn(
        "rounded-xl border-2 px-4 py-3 min-w-[260px] max-w-[320px] shadow-lg transition-all",
        style.bg,
        selected ? "border-primary ring-2 ring-primary/30" : style.border
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-3 !h-3 !border-2 !border-background" />

      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground/50 mt-0.5 cursor-grab" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className={cn("text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", style.badge)}>
              {style.label}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              #{nodeData.stepIndex + 1}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground leading-tight truncate">
            {nodeData.display_text || "Untitled step"}
          </p>
          {nodeData.llm_prompt && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {nodeData.llm_prompt.slice(0, 100)}
              {nodeData.llm_prompt.length > 100 ? "..." : ""}
            </p>
          )}
        </div>
        {nodeData.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              nodeData.onDelete?.(id);
            }}
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-3 !h-3 !border-2 !border-background" />
    </div>
  );
}

export const TaskStepNode = memo(TaskStepNodeComponent);
