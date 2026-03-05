"use client";

import React, { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Trash2, FileInput, FileOutput } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { extractFileIO } from "@/types/task-config";

export interface TaskStepNodeData {
  stepIndex: number;
  display_text: string;
  llm_prompt: string;
  subagent: string;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

interface NodeStyle {
  bg: string;
  border: string;
  badge: string;
  label: string;
}

const DARK_STYLES: Record<string, NodeStyle> = {
  caipe:      { bg: "bg-yellow-950",  border: "border-yellow-700",  badge: "bg-yellow-800 text-yellow-200",     label: "Input" },
  github:     { bg: "bg-purple-950",  border: "border-purple-700",  badge: "bg-purple-800 text-purple-200",     label: "GitHub" },
  backstage:  { bg: "bg-purple-950",  border: "border-purple-700",  badge: "bg-purple-800 text-purple-200",     label: "Backstage" },
  aws:        { bg: "bg-orange-950",  border: "border-orange-700",  badge: "bg-orange-800 text-orange-200",     label: "AWS" },
  argocd:     { bg: "bg-cyan-950",    border: "border-cyan-700",    badge: "bg-cyan-800 text-cyan-200",         label: "ArgoCD" },
  aigateway:  { bg: "bg-violet-950",  border: "border-violet-700",  badge: "bg-violet-800 text-violet-200",     label: "AI GW" },
  jira:       { bg: "bg-blue-950",    border: "border-blue-700",    badge: "bg-blue-800 text-blue-200",         label: "Jira" },
  webex:      { bg: "bg-green-950",   border: "border-green-700",   badge: "bg-green-800 text-green-200",       label: "Webex" },
  slack:      { bg: "bg-pink-950",    border: "border-pink-700",    badge: "bg-pink-800 text-pink-200",         label: "Slack" },
  pagerduty:  { bg: "bg-emerald-950", border: "border-emerald-700", badge: "bg-emerald-800 text-emerald-200",   label: "PagerDuty" },
  splunk:     { bg: "bg-lime-950",    border: "border-lime-700",    badge: "bg-lime-800 text-lime-200",         label: "Splunk" },
  komodor:    { bg: "bg-teal-950",    border: "border-teal-700",    badge: "bg-teal-800 text-teal-200",         label: "Komodor" },
  confluence: { bg: "bg-sky-950",     border: "border-sky-700",     badge: "bg-sky-800 text-sky-200",           label: "Confluence" },
};

const LIGHT_STYLES: Record<string, NodeStyle> = {
  caipe:      { bg: "bg-yellow-50",   border: "border-yellow-300",  badge: "bg-yellow-200 text-yellow-800",     label: "Input" },
  github:     { bg: "bg-purple-50",   border: "border-purple-300",  badge: "bg-purple-200 text-purple-800",     label: "GitHub" },
  backstage:  { bg: "bg-purple-50",   border: "border-purple-300",  badge: "bg-purple-200 text-purple-800",     label: "Backstage" },
  aws:        { bg: "bg-orange-50",   border: "border-orange-300",  badge: "bg-orange-200 text-orange-800",     label: "AWS" },
  argocd:     { bg: "bg-cyan-50",     border: "border-cyan-300",    badge: "bg-cyan-200 text-cyan-800",         label: "ArgoCD" },
  aigateway:  { bg: "bg-violet-50",   border: "border-violet-300",  badge: "bg-violet-200 text-violet-800",     label: "AI GW" },
  jira:       { bg: "bg-blue-50",     border: "border-blue-300",    badge: "bg-blue-200 text-blue-800",         label: "Jira" },
  webex:      { bg: "bg-green-50",    border: "border-green-300",   badge: "bg-green-200 text-green-800",       label: "Webex" },
  slack:      { bg: "bg-pink-50",     border: "border-pink-300",    badge: "bg-pink-200 text-pink-800",         label: "Slack" },
  pagerduty:  { bg: "bg-emerald-50",  border: "border-emerald-300", badge: "bg-emerald-200 text-emerald-800",   label: "PagerDuty" },
  splunk:     { bg: "bg-lime-50",     border: "border-lime-300",    badge: "bg-lime-200 text-lime-800",         label: "Splunk" },
  komodor:    { bg: "bg-teal-50",     border: "border-teal-300",    badge: "bg-teal-200 text-teal-800",         label: "Komodor" },
  confluence: { bg: "bg-sky-50",      border: "border-sky-300",     badge: "bg-sky-200 text-sky-800",           label: "Confluence" },
};

const DARK_DEFAULT:  NodeStyle = { bg: "bg-slate-900", border: "border-slate-600", badge: "bg-slate-700 text-slate-200", label: "Custom" };
const LIGHT_DEFAULT: NodeStyle = { bg: "bg-slate-50",  border: "border-slate-300", badge: "bg-slate-200 text-slate-700", label: "Custom" };

function TaskStepNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as TaskStepNodeData;
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const styles = isDark ? DARK_STYLES : LIGHT_STYLES;
  const fallback = isDark ? DARK_DEFAULT : LIGHT_DEFAULT;
  const s = styles[nodeData.subagent] || fallback;

  const fileIO = useMemo(() => extractFileIO(nodeData.llm_prompt || ""), [nodeData.llm_prompt]);
  const hasFiles = fileIO.reads.length > 0 || fileIO.writes.length > 0;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 w-[200px] shadow-lg transition-all",
        s.bg,
        selected ? "border-primary ring-2 ring-primary/40" : s.border
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2.5 !h-2.5 !border-2 !border-background" />

      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={cn("text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded leading-none", s.badge)}>
              {s.label}
            </span>
            <span className={cn("text-[10px] font-mono ml-auto", isDark ? "text-gray-400" : "text-slate-500")}>
              #{nodeData.stepIndex + 1}
            </span>
          </div>
          <p className={cn("text-xs font-semibold leading-snug truncate", isDark ? "text-gray-100" : "text-slate-800")}>
            {nodeData.display_text || "Untitled step"}
          </p>
        </div>
        {nodeData.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              nodeData.onDelete?.(id);
            }}
            className={cn(
              "p-0.5 rounded transition-colors shrink-0",
              isDark
                ? "text-gray-500 hover:text-red-400 hover:bg-red-500/30"
                : "text-slate-400 hover:text-red-500 hover:bg-red-500/20"
            )}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {hasFiles && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {fileIO.reads.map((f) => (
            <span
              key={`r-${f}`}
              className={cn(
                "inline-flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.5 rounded border",
                isDark
                  ? "bg-blue-900 text-blue-300 border-blue-700"
                  : "bg-blue-100 text-blue-700 border-blue-300"
              )}
              title={`Reads ${f}`}
            >
              <FileInput className="h-2.5 w-2.5" />
              {f.split("/").pop()}
            </span>
          ))}
          {fileIO.writes.map((f) => (
            <span
              key={`w-${f}`}
              className={cn(
                "inline-flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.5 rounded border",
                isDark
                  ? "bg-emerald-900 text-emerald-300 border-emerald-700"
                  : "bg-emerald-100 text-emerald-700 border-emerald-300"
              )}
              title={`Writes ${f}`}
            >
              <FileOutput className="h-2.5 w-2.5" />
              {f.split("/").pop()}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2.5 !h-2.5 !border-2 !border-background" />
    </div>
  );
}

export const TaskStepNode = memo(TaskStepNodeComponent);
