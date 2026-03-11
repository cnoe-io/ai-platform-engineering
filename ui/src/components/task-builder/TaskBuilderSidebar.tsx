"use client";

import React, { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubagentSelector } from "./SubagentSelector";
import { CaipeFormBuilder } from "./CaipeFormBuilder";
import { EnvVarsPanel } from "./EnvVarsPanel";
import { PolicyPanel } from "./PolicyPanel";
import { FileInput, FileOutput } from "lucide-react";
import { cn } from "@/lib/utils";
import { extractFileIO, type TaskStep } from "@/types/task-config";

type SidebarTab = "properties" | "files" | "envvars" | "policy";

interface TaskBuilderSidebarProps {
  step: TaskStep | null;
  stepIndex: number;
  onChange: (updates: Partial<TaskStep>) => void;
  allSteps: TaskStep[];
  isSystemWorkflow: boolean;
  allowedTools?: string[];
  onAllowedToolsChange: (tools: string[] | undefined) => void;
}

export function TaskBuilderSidebar({
  step,
  stepIndex,
  onChange,
  allSteps,
  isSystemWorkflow,
  allowedTools,
  onAllowedToolsChange,
}: TaskBuilderSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("properties");

  if (!step) {
    return (
      <div className="w-80 border-l border-border bg-card/50 flex flex-col">
        <SidebarFooter tab={tab} setTab={setTab} />
        <div className="flex-1 overflow-y-auto">
          {tab === "envvars" ? (
            <div className="p-4">
              <EnvVarsPanel tasks={allSteps} />
            </div>
          ) : (
            <div className="flex items-center justify-center p-6 h-full">
              <p className="text-sm text-muted-foreground text-center">
                Select a step on the canvas to edit its properties
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const fileIO = extractFileIO(step.llm_prompt || "");
  const isCaipe = step.subagent === "caipe";

  return (
    <div className="w-80 border-l border-border bg-card/50 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-bold text-foreground">Step #{stepIndex + 1}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Edit step properties</p>
      </div>

      <SidebarFooter tab={tab} setTab={setTab} />

      <div className="flex-1 overflow-y-auto">
        {tab === "properties" && (
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

            {isCaipe ? (
              <CaipeFormBuilder
                prompt={step.llm_prompt}
                onChange={(prompt) => onChange({ llm_prompt: prompt })}
              />
            ) : (
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
            )}
          </div>
        )}

        {tab === "files" && (
          <div className="p-4 space-y-3">
            <FileSection
              title="Reads"
              icon={<FileInput className="h-3.5 w-3.5 text-blue-400" />}
              files={fileIO.reads}
              emptyMsg="No file reads detected"
              badgeClass="bg-blue-500/15 text-blue-300 border-blue-500/20"
            />
            <FileSection
              title="Writes"
              icon={<FileOutput className="h-3.5 w-3.5 text-emerald-400" />}
              files={fileIO.writes}
              emptyMsg="No file writes detected"
              badgeClass="bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
            />
            <p className="text-[10px] text-muted-foreground">
              File paths are auto-detected from the LLM prompt text.
            </p>
          </div>
        )}

        {tab === "envvars" && (
          <div className="p-4">
            <EnvVarsPanel tasks={allSteps} />
          </div>
        )}

        {tab === "policy" && (
          <div className="p-4">
            <PolicyPanel
              isSystemWorkflow={isSystemWorkflow}
              subagent={step.subagent}
              allowedTools={allowedTools}
              onChange={onAllowedToolsChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarFooter({
  tab,
  setTab,
}: {
  tab: SidebarTab;
  setTab: (t: SidebarTab) => void;
}) {
  const tabs: { id: SidebarTab; label: string }[] = [
    { id: "properties", label: "Properties" },
    { id: "files", label: "Files" },
    { id: "envvars", label: "Env Vars" },
    { id: "policy", label: "Policy" },
  ];

  return (
    <div className="flex border-b border-border shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={cn(
            "flex-1 text-[10px] font-bold uppercase tracking-wider py-2 transition-colors",
            tab === t.id
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function FileSection({
  title,
  icon,
  files,
  emptyMsg,
  badgeClass,
}: {
  title: string;
  icon: React.ReactNode;
  files: string[];
  emptyMsg: string;
  badgeClass: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-bold text-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">
          {files.length}
        </span>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyMsg}</p>
      ) : (
        <div className="space-y-1">
          {files.map((f) => (
            <div
              key={f}
              className={cn(
                "text-xs font-mono px-2 py-1 rounded border",
                badgeClass
              )}
            >
              {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
