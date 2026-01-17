"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  Cloud,
  AlertTriangle,
  Github,
  FileText,
  Search,
  Database,
  Server,
  Settings,
  Terminal,
  Rocket,
} from "lucide-react";

export interface CustomCall {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  color?: string;
  suggestions?: string[];
}

// Default agent configurations
export const DEFAULT_AGENTS: CustomCall[] = [
  {
    id: "argocd",
    label: "ArgoCD",
    prompt: "@argocd",
    icon: "rocket",
    color: "from-orange-500 to-red-500",
    suggestions: [
      "List all ArgoCD applications",
      "Show sync status for all apps",
      "Find unhealthy applications",
    ],
  },
  {
    id: "aws",
    label: "AWS",
    prompt: "@aws",
    icon: "cloud",
    color: "from-amber-500 to-orange-500",
    suggestions: [
      "List EC2 instances",
      "Show S3 buckets",
      "Check CloudWatch alarms",
    ],
  },
  {
    id: "github",
    label: "GitHub",
    prompt: "@github",
    icon: "github",
    color: "from-gray-600 to-gray-800",
    suggestions: [
      "List open PRs",
      "Show recent commits",
      "Find failing workflows",
    ],
  },
  {
    id: "jira",
    label: "Jira",
    prompt: "@jira",
    icon: "file-text",
    color: "from-blue-500 to-indigo-500",
    suggestions: [
      "Show my open tickets",
      "Find high-priority issues",
      "List sprint tasks",
    ],
  },
  {
    id: "splunk",
    label: "Splunk",
    prompt: "@splunk",
    icon: "search",
    color: "from-green-500 to-emerald-500",
    suggestions: [
      "Search for errors",
      "Show recent alerts",
      "Query application logs",
    ],
  },
  {
    id: "pagerduty",
    label: "PagerDuty",
    prompt: "@pagerduty",
    icon: "alert-triangle",
    color: "from-red-500 to-rose-500",
    suggestions: [
      "Show active incidents",
      "List on-call schedule",
      "Check service status",
    ],
  },
];

// Icon mapping
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  rocket: Rocket,
  cloud: Cloud,
  github: Github,
  "file-text": FileText,
  search: Search,
  "alert-triangle": AlertTriangle,
  "git-branch": GitBranch,
  database: Database,
  server: Server,
  settings: Settings,
  terminal: Terminal,
};

interface CustomCallButtonsProps {
  agents?: CustomCall[];
  selectedAgent: string | null;
  onSelectAgent: (agent: CustomCall | null) => void;
  onSuggestionClick?: (suggestion: string, agentPrompt: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function CustomCallButtons({
  agents = DEFAULT_AGENTS,
  selectedAgent,
  onSelectAgent,
  onSuggestionClick,
  disabled = false,
  compact = false,
}: CustomCallButtonsProps) {
  const selectedAgentConfig = agents.find((a) => a.id === selectedAgent);

  return (
    <div className="space-y-2">
      {/* Agent Buttons */}
      <div className="flex flex-wrap gap-1.5">
        {agents.map((agent) => {
          const Icon = iconMap[agent.icon || "rocket"] || Rocket;
          const isSelected = selectedAgent === agent.id;

          return (
            <motion.button
              key={agent.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (disabled) return;
                onSelectAgent(isSelected ? null : agent);
              }}
              disabled={disabled}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                "border border-transparent",
                isSelected
                  ? `bg-gradient-to-r ${agent.color} text-white shadow-lg`
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {!compact && <span>{agent.label}</span>}
            </motion.button>
          );
        })}
      </div>

      {/* Suggestions for selected agent */}
      {selectedAgentConfig?.suggestions && selectedAgentConfig.suggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="flex flex-wrap gap-1.5 pt-1"
        >
          {selectedAgentConfig.suggestions.map((suggestion) => (
            <motion.button
              key={suggestion}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (!disabled && onSuggestionClick) {
                  onSuggestionClick(suggestion, selectedAgentConfig.prompt);
                }
              }}
              disabled={disabled}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs transition-all",
                "bg-primary/10 text-primary hover:bg-primary/20",
                "border border-primary/20",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {suggestion}
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  );
}

/**
 * Simple inline agent selector for the input area
 */
interface InlineAgentSelectorProps {
  value: string | null;
  onChange: (agentPrompt: string | null) => void;
  agents?: CustomCall[];
}

export function InlineAgentSelector({
  value,
  onChange,
  agents = DEFAULT_AGENTS,
}: InlineAgentSelectorProps) {
  return (
    <div className="flex items-center gap-1 px-1">
      {agents.slice(0, 4).map((agent) => {
        const Icon = iconMap[agent.icon || "rocket"] || Rocket;
        const isSelected = value === agent.prompt;

        return (
          <button
            key={agent.id}
            onClick={() => onChange(isSelected ? null : agent.prompt)}
            title={agent.label}
            className={cn(
              "p-1.5 rounded-md transition-all",
              isSelected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
