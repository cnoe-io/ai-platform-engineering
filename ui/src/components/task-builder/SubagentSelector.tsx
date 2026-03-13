"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useAgentTools } from "@/hooks/use-agent-tools";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

interface SubagentSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SubagentSelector({ value, onChange }: SubagentSelectorProps) {
  const { agents, loading, error, errorMessage, refresh } = useAgentTools();

  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading agents...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 h-9 px-2">
        <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="text-xs text-destructive truncate" title={errorMessage}>
          {errorMessage || "Could not load agents"}
        </span>
        <button
          onClick={refresh}
          className="text-primary hover:underline text-xs inline-flex items-center gap-1 shrink-0"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
        "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      {agents.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
