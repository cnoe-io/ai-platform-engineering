"use client";

import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Copy, Check, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { A2AEvent } from "@/types/a2a";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentLogo } from "@/components/shared/AgentLogos";

interface SubAgentCardProps {
  agentName: string;
  events: A2AEvent[];
  isStreaming?: boolean;
  className?: string;
}

/**
 * SubAgentCard renders a collapsible card for a sub-agent's streaming response.
 * Groups all events from a single agent into one visual container.
 */
export function SubAgentCard({
  agentName,
  events,
  isStreaming = false,
  className,
}: SubAgentCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  // Aggregate content from all events for this agent
  const content = useMemo(() => {
    const textParts: string[] = [];

    for (const event of events) {
      // Skip tool notifications - they're UI chrome, not content
      if (event.type === "tool_start" || event.type === "tool_end") {
        continue;
      }

      if (event.displayContent) {
        textParts.push(event.displayContent);
      }
    }

    return textParts.join("");
  }, [events]);

  // Get the latest status from events
  const latestStatus = useMemo(() => {
    const toolEndEvents = events.filter((e) => e.type === "tool_end");
    if (toolEndEvents.length > 0) return "completed";

    const toolStartEvents = events.filter((e) => e.type === "tool_start");
    if (toolStartEvents.length > 0) return "running";

    return isStreaming ? "streaming" : "idle";
  }, [events, isStreaming]);

  // Format agent name for display
  const displayName = useMemo(() => {
    // Handle common agent name patterns
    const nameMap: Record<string, string> = {
      github: "GitHub Agent",
      gitlab: "GitLab Agent",
      argocd: "Argo CD Agent",
      aws: "AWS Agent",
      jira: "Jira Agent",
      rag: "RAG Agent",
      supervisor: "Supervisor",
    };

    const lower = agentName.toLowerCase();
    return nameMap[lower] || `${agentName.charAt(0).toUpperCase()}${agentName.slice(1)} Agent`;
  }, [agentName]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!content && !isStreaming) {
    return null; // Don't render empty cards
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm overflow-hidden",
        "transition-all duration-200",
        isStreaming && "border-primary/50 ring-1 ring-primary/20",
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3",
          "bg-muted/30 border-b cursor-pointer hover:bg-muted/50",
          "transition-colors duration-150"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <AgentLogo agent={agentName.toLowerCase()} size="sm" />
          <span className="font-medium text-sm">{displayName}</span>

          {/* Status indicator */}
          {isStreaming && latestStatus === "streaming" && (
            <div className="flex items-center gap-1.5 text-xs text-primary animate-pulse">
              <Radio className="h-3 w-3" />
              <span>Streaming raw output</span>
            </div>
          )}
          {latestStatus === "running" && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500">
              <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Processing</span>
            </div>
          )}
          {latestStatus === "completed" && !isStreaming && (
            <div className="flex items-center gap-1.5 text-xs text-green-500">
              <Check className="h-3 w-3" />
              <span>Completed</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Copy button */}
          {content && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
              className="p-1.5 hover:bg-muted rounded-md transition-colors"
              title="Copy response"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          )}

          {/* Expand/Collapse */}
          <button className="p-1.5 hover:bg-muted rounded-md transition-colors">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-4">
          {content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : isStreaming ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <div className="flex gap-1">
                <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span>Waiting for response...</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Internal tools that should NOT be shown as sub-agent cards
// These are supervisor utilities, not actual sub-agents
const INTERNAL_TOOLS = new Set([
  "write_todos",
  "update_todos",
  "read_todos",
  "supervisor",
  "unknown",
]);

// Actual sub-agents that SHOULD be shown as cards
const KNOWN_SUBAGENTS = new Set([
  "github",
  "gitlab",
  "argocd",
  "aws",
  "jira",
  "rag",
  "confluence",
]);

/**
 * Check if an agent name represents a real sub-agent (not an internal tool)
 */
export function isRealSubAgent(agentName: string): boolean {
  const normalized = agentName.toLowerCase();

  // Explicitly exclude internal tools
  if (INTERNAL_TOOLS.has(normalized)) {
    return false;
  }

  // Include known sub-agents
  if (KNOWN_SUBAGENTS.has(normalized)) {
    return true;
  }

  // For unknown agents, check if they look like a sub-agent name
  // Sub-agents typically don't have underscores (those are tools)
  return !normalized.includes("_") && normalized !== "supervisor";
}

/**
 * Groups A2A events by source agent for rendering in SubAgentCards
 */
export function groupEventsByAgent(events: A2AEvent[]): Map<string, A2AEvent[]> {
  const groups = new Map<string, A2AEvent[]>();

  for (const event of events) {
    // Determine the agent for this event
    let agent = event.sourceAgent || "supervisor";

    // Normalize agent name
    agent = agent.toLowerCase();

    if (!groups.has(agent)) {
      groups.set(agent, []);
    }
    groups.get(agent)!.push(event);
  }

  return groups;
}

/**
 * Get the order in which agents should be displayed
 * Only includes real sub-agents (not internal tools like write_todos)
 */
export function getAgentDisplayOrder(events: A2AEvent[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const agent = (event.sourceAgent || "supervisor").toLowerCase();

    // Skip if already seen or is an internal tool
    if (seen.has(agent) || !isRealSubAgent(agent)) {
      continue;
    }

    seen.add(agent);
    order.push(agent);
  }

  return order;
}
