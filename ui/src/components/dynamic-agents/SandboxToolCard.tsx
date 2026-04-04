"use client";

import React from "react";
import { Terminal, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SandboxToolExecData } from "./sse-types";

interface SandboxToolCardProps {
  data: SandboxToolExecData;
}

/**
 * Enhanced tool card for sandbox-executed commands.
 * Displays command, exit code, sandbox name, and truncation status.
 */
export function SandboxToolCard({ data }: SandboxToolCardProps) {
  const isSuccess = data.exit_code === 0;
  const isError = data.exit_code !== undefined && data.exit_code !== 0;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 my-1 text-xs">
      <div className="flex items-center gap-2 mb-1.5">
        <Terminal className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="font-medium text-foreground">
          {data.tool_name}
        </span>
        {data.sandbox_name && (
          <span className="text-muted-foreground">
            in {data.sandbox_name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {isSuccess && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              exit 0
            </span>
          )}
          {isError && (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="h-3 w-3" />
              exit {data.exit_code}
            </span>
          )}
          {data.truncated && (
            <span className="flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              truncated
            </span>
          )}
        </div>
      </div>

      {data.command && (
        <div className={cn(
          "font-mono text-[11px] p-1.5 rounded border bg-background/50",
          isError ? "border-destructive/20" : "border-border/30"
        )}>
          <code className="break-all">{data.command}</code>
        </div>
      )}
    </div>
  );
}
