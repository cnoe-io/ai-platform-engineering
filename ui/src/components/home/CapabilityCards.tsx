"use client";

import React from "react";
import Link from "next/link";
import { MessageSquare, Zap, Database, Workflow, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CapabilityCardsProps {
  ragEnabled: boolean;
}

const capabilities = [
  {
    id: "chat",
    title: "Chat",
    description:
      "Have natural conversations with AI agents to manage infrastructure, debug issues, and automate tasks.",
    icon: MessageSquare,
    href: "/chat",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "hover:border-blue-500/30",
  },
  {
    id: "skills",
    title: "Skills",
    description:
      "Browse and run pre-built agent workflows for common platform engineering tasks across your stack.",
    icon: Zap,
    href: "/skills",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "hover:border-amber-500/30",
  },
  {
    id: "task-builder",
    title: "Task Builder",
    description:
      "Create and manage self-service workflows that chain agent actions into repeatable multi-step tasks.",
    icon: Workflow,
    href: "/task-builder",
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "hover:border-violet-500/30",
  },
  {
    id: "knowledge-bases",
    title: "Knowledge Base",
    description:
      "Search and explore your organization's knowledge through RAG-powered semantic search and graph views.",
    icon: Database,
    href: "/knowledge-bases",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "hover:border-emerald-500/30",
    requiresRag: true,
  },
];

export function CapabilityCards({ ragEnabled }: CapabilityCardsProps) {
  const visibleCapabilities = capabilities.filter(
    (c) => !c.requiresRag || ragEnabled
  );

  return (
    <div data-testid="capability-cards">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Platform Capabilities
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleCapabilities.map((cap) => (
          <Link
            key={cap.id}
            href={cap.href}
            data-testid={`capability-card-${cap.id}`}
            className={cn(
              "group block p-5 rounded-lg border border-border/50 bg-card/50",
              "hover:bg-card/80 transition-all",
              cap.borderColor
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                  cap.bgColor
                )}
              >
                <cap.icon className={cn("h-5 w-5", cap.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {cap.title}
                  </h3>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {cap.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
