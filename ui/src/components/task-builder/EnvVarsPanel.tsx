"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Variable } from "lucide-react";
import { cn } from "@/lib/utils";
import { extractEnvVarsWithSteps, KNOWN_ENV_VARS, type TaskStep } from "@/types/task-config";

interface EnvVarsPanelProps {
  tasks: TaskStep[];
}

export function EnvVarsPanel({ tasks }: EnvVarsPanelProps) {
  const vars = extractEnvVarsWithSteps(tasks);

  if (vars.length === 0) {
    return (
      <div className="p-4 text-center">
        <Variable className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">
          No environment variables detected in this workflow.
        </p>
      </div>
    );
  }

  const known = vars.filter((v) => v.name in KNOWN_ENV_VARS);
  const unknown = vars.filter((v) => !(v.name in KNOWN_ENV_VARS));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">
          Environment Variables
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {vars.length} var{vars.length !== 1 ? "s" : ""}
        </span>
      </div>

      {unknown.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
              Undocumented ({unknown.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {unknown.map((v) => (
              <VarRow key={v.name} name={v.name} description={v.description} steps={v.steps} isKnown={false} />
            ))}
          </div>
        </div>
      )}

      {known.length > 0 && (
        <div className="space-y-1.5">
          {known.map((v) => (
            <VarRow key={v.name} name={v.name} description={v.description} steps={v.steps} isKnown />
          ))}
        </div>
      )}
    </div>
  );
}

function VarRow({
  name,
  description,
  steps,
  isKnown,
}: {
  name: string;
  description: string;
  steps: number[];
  isKnown: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-xs",
        isKnown ? "border-border bg-background/50" : "border-amber-500/20 bg-amber-500/5"
      )}
    >
      <div className="flex items-center gap-1.5">
        {isKnown ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
        ) : (
          <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
        )}
        <code className="font-mono font-semibold text-foreground">${name}</code>
        <span className="ml-auto text-[9px] text-muted-foreground font-mono shrink-0">
          step{steps.length > 1 ? "s" : ""} {steps.map((s) => s + 1).join(", ")}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5 pl-4.5">
        {description}
      </p>
    </div>
  );
}
