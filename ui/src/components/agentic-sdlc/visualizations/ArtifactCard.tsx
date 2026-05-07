"use client";

/**
 * Compact card used by Pipeline and Kanban views to render a child
 * artifact. Centralised so PR vs sub-task vs deploy share the same
 * affordances (icon, "needs you" badge, external link). The
 * `view` prop tweaks density: pipeline columns are narrow, kanban
 * lanes have more room.
 */

import {
  Bot,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Rocket,
  User,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { AgenticSdlcArtifact } from "@/types/agentic-sdlc";

const KIND_ICON: Record<AgenticSdlcArtifact["kind"], LucideIcon> = {
  epic: GitBranch,
  subtask: GitBranch,
  pull_request: GitPullRequest,
  deploy: Rocket,
};

interface ArtifactCardProps {
  artifact: AgenticSdlcArtifact;
  view: "pipeline" | "kanban";
  /** When the caller is in needs_me, render an emphasised border. */
  needsMe?: boolean;
}

export function ArtifactCard({ artifact, view, needsMe }: ArtifactCardProps) {
  const Icon = KIND_ICON[artifact.kind] ?? GitBranch;
  const ActorIcon = inferActor(artifact) === "agent" ? Bot : User;

  return (
    <Link
      href={artifact.github_url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group block rounded-md border bg-card/40 p-2 text-xs shadow-sm transition",
        "hover:bg-card/70 hover:shadow-md",
        needsMe
          ? "border-amber-400/50 ring-1 ring-amber-400/30"
          : "border-border/50",
        view === "pipeline" ? "w-full" : "w-full",
      )}
    >
      <div className="flex items-start gap-1.5">
        <Icon className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 font-medium text-foreground">
            {artifact.title}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-0.5">
              <ActorIcon className="h-3 w-3" aria-hidden />
              {inferActor(artifact) === "agent" ? "Agent" : "Human"}
            </span>
            {needsMe && (
              <span className="inline-flex items-center gap-0.5 text-amber-400">
                <AlertCircle className="h-3 w-3" aria-hidden />
                Needs you
              </span>
            )}
            <ExternalLink
              className="ml-auto h-3 w-3 opacity-0 transition group-hover:opacity-70"
              aria-hidden
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

/**
 * Heuristic: an artifact "owned" by an agent has at least one
 * agent-applied label. The projector populates `agent_labels` for us.
 * Falls back to "human" when neither side has signalled.
 */
function inferActor(a: AgenticSdlcArtifact): "agent" | "human" {
  if ((a.agent_labels?.length ?? 0) > 0) return "agent";
  return "human";
}
