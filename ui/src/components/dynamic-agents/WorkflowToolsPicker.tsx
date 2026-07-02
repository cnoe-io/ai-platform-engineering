"use client";

import { cn } from "@/lib/utils";
import type { WorkflowConfig } from "@/types/workflow-config";
import { Check,Loader2,Workflow } from "lucide-react";
import React from "react";

interface WorkflowToolsPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select picker for workflow configs.
 * Selected IDs are stored in builtin_tools.workflows.
 */
export function WorkflowToolsPicker({ value, onChange, disabled }: WorkflowToolsPickerProps) {
  const [configs, setConfigs] = React.useState<WorkflowConfig[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/workflow-configs");
        if (!res.ok) throw new Error("Failed to fetch workflow configs");
        const data = await res.json();
        if (!cancelled) setConfigs(data);
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (id: string) => {
    if (disabled) return;
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading workflows...
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        No workflow configs found. Create a workflow first in the Workflows page.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {configs.map((cfg) => {
        const selected = value.includes(cfg._id);
        return (
          <button
            key={cfg._id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(cfg._id)}
            className={cn(
              "w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              selected
                ? "border-primary/50 bg-primary/5"
                : "border-border hover:border-muted-foreground/30 hover:bg-muted/30",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
              )}
            >
              {selected && <Check className="h-3 w-3" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Workflow className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">{cfg.name}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {cfg.steps?.length ?? 0} step{(cfg.steps?.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </div>
              {cfg.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{cfg.description}</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
