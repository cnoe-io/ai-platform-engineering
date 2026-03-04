"use client";

import React from "react";
import { cn } from "@/lib/utils";

const SUBAGENT_OPTIONS = [
  { value: "caipe",     label: "User Input (CAIPE)" },
  { value: "github",    label: "GitHub" },
  { value: "backstage", label: "Backstage" },
  { value: "aws",       label: "AWS" },
  { value: "argocd",    label: "ArgoCD" },
  { value: "aigateway", label: "AI Gateway" },
  { value: "jira",      label: "Jira" },
  { value: "webex",     label: "Webex" },
];

interface SubagentSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SubagentSelector({ value, onChange }: SubagentSelectorProps) {
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
      {SUBAGENT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
