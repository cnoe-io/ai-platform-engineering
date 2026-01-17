"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { AGENT_LOGOS, AgentLogoConfig } from "@/components/shared/AgentLogos";

export interface CustomCall {
  id: string;
  label: string;
  prompt: string;
  suggestions?: string[];
}

// Default agent configurations using AGENT_LOGOS
export const DEFAULT_AGENTS: CustomCall[] = [
  {
    id: "argocd",
    label: "ArgoCD",
    prompt: "@argocd",
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
    suggestions: [
      "Show active incidents",
      "List on-call schedule",
      "Check service status",
    ],
  },
];

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
          const agentLogo = AGENT_LOGOS[agent.id];
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
                "border",
                isSelected
                  ? "text-white shadow-lg border-transparent"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border-transparent",
                disabled && "opacity-50 cursor-not-allowed"
              )}
              style={isSelected && agentLogo ? {
                backgroundColor: agentLogo.color,
              } : undefined}
            >
              {/* Agent Icon from AGENT_LOGOS */}
              <div className={cn("w-4 h-4", isSelected ? "text-white" : "")} style={!isSelected && agentLogo ? { color: agentLogo.color } : undefined}>
                {agentLogo?.icon || <span className="text-xs">{agent.label.charAt(0)}</span>}
              </div>
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
        const agentLogo = AGENT_LOGOS[agent.id];
        const isSelected = value === agent.prompt;

        return (
          <button
            key={agent.id}
            onClick={() => onChange(isSelected ? null : agent.prompt)}
            title={agent.label}
            className={cn(
              "p-1.5 rounded-md transition-all",
              isSelected
                ? "text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            style={isSelected && agentLogo ? { backgroundColor: agentLogo.color } : undefined}
          >
            <div
              className="w-4 h-4"
              style={!isSelected && agentLogo ? { color: agentLogo.color } : undefined}
            >
              {agentLogo?.icon || <span className="text-xs font-bold">{agent.label.charAt(0)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
