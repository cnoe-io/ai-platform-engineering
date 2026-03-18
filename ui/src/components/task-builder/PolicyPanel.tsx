"use client";

import React from "react";
import { Shield, Info, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentTools } from "@/hooks/use-agent-tools";

interface PolicyPanelProps {
  isSystemWorkflow: boolean;
  subagent: string;
  allowedTools?: string[];
  onChange: (tools: string[] | undefined) => void;
}

export function PolicyPanel({ isSystemWorkflow, subagent, allowedTools, onChange }: PolicyPanelProps) {
  const { toolsMap, loading, error, refresh } = useAgentTools();

  if (isSystemWorkflow) {
    return (
      <div className="space-y-3">
        <Header />
        <div className="rounded-md bg-muted/50 border border-border p-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            System workflows are governed by the global policy managed by admins
            (Admin &gt; Policy). Tool restrictions cannot be edited here.
          </p>
        </div>
      </div>
    );
  }

  const tools = toolsMap[subagent] ?? [];

  if (loading) {
    return (
      <div className="space-y-3">
        <Header />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading tools from supervisor...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Header />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Could not load tools.</span>
          <button onClick={refresh} className="text-primary hover:underline inline-flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <div className="space-y-3">
        <Header />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {subagent === "user_input"
            ? "User Input steps collect data via forms — no external tool calls to restrict."
            : `No tools discovered for the "${subagent}" subagent. Ensure the supervisor is running.`}
        </p>
      </div>
    );
  }

  const hasRestrictions = allowedTools !== undefined && allowedTools.length > 0;
  const stepHasRestrictions = hasRestrictions && tools.some((t) => !allowedTools.includes(t));

  const allToolNames = Object.values(toolsMap).flat();

  const handleToggle = () => {
    if (stepHasRestrictions) {
      if (!allowedTools) {
        onChange(undefined);
        return;
      }
      const toAdd = tools.filter((t) => !allowedTools.includes(t));
      onChange([...allowedTools, ...toAdd]);
    } else {
      const base = allowedTools ?? allToolNames;
      const next = base.filter((t) => !tools.includes(t));
      onChange(next.length > 0 ? next : undefined);
    }
  };

  const handleToolToggle = (toolName: string) => {
    const current = allowedTools ?? allToolNames;
    const next = current.includes(toolName)
      ? current.filter((t) => t !== toolName)
      : [...current, toolName];
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div className="space-y-3">
      <Header />

      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={stepHasRestrictions}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
            stepHasRestrictions ? "bg-primary" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
              stepHasRestrictions ? "translate-x-[18px]" : "translate-x-[3px]"
            )}
          />
        </button>
        <span className="text-xs text-foreground">
          {stepHasRestrictions ? "Restricted" : "Allow All"}
        </span>
      </div>

      {!stepHasRestrictions && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          All {subagent} tools are allowed for this step.
        </p>
      )}

      {stepHasRestrictions && (
        <div className="space-y-2">
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="leading-relaxed">
              Unchecked tools will be blocked for this step.
            </span>
          </div>

          <div className="space-y-0.5">
            {tools.map((toolName) => (
              <label key={toolName} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={allowedTools?.includes(toolName) ?? true}
                  onChange={() => handleToolToggle(toolName)}
                  className="h-3 w-3 rounded border-border text-primary focus:ring-primary/30"
                />
                <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors font-mono">
                  {toolName}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <Shield className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs font-semibold text-foreground">Tool Policy</span>
    </div>
  );
}
