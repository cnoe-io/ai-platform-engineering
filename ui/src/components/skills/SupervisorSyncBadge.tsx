"use client";

/**
 * SupervisorSyncBadge — small inline indicator shared by the SkillsGallery
 * and the new Skill Workspace header.
 *
 *   - "synced"  → green check; supervisor has merged the current version.
 *   - "stale"   → amber triangle; this skill was edited after the supervisor's
 *                 last merge. Click → /admin?tab=skills to refresh.
 *   - "unknown" → muted question mark; supervisor unreachable / no merge yet.
 *
 * `useSupervisorSyncState` fetches the supervisor status once on mount and
 * derives the per-skill state from `updated_at` vs `skills_merged_at`. Use
 * `useSupervisorSyncStateForSkill(skill)` for one-shot consumers.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentSkill } from "@/types/agent-skill";

export type SupervisorSyncState = "synced" | "stale" | "unknown";

export interface SupervisorSyncBadgeProps {
  state: SupervisorSyncState;
  size?: "sm" | "md";
  /** Override the destination link for the stale state. */
  staleHref?: string;
  className?: string;
}

export function SupervisorSyncBadge({
  state,
  size = "sm",
  staleHref = "/admin?tab=skills",
  className,
}: SupervisorSyncBadgeProps) {
  const iconClass = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const router = useRouter();
  // Confirmation modal lives here (instead of in a tooltip) because the
  // supervisor-refresh action briefly recompiles the multi-agent graph
  // and can drop in-flight chat traffic — operators need an explicit
  // heads-up, not a silent navigation.
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (state === "synced") {
    return (
      <span
        className={`inline-flex items-center justify-center text-emerald-500 ${className ?? ""}`}
        title="In sync with supervisor — your changes are live in the running multi-agent graph."
      >
        <CheckCircle2 className={iconClass} aria-label="In sync with supervisor" />
      </span>
    );
  }
  if (state === "stale") {
    return (
      <>
        <button
          type="button"
          className={`inline-flex items-center justify-center text-amber-500 hover:text-amber-600 transition-colors cursor-pointer bg-transparent border-0 p-0 ${className ?? ""}`}
          title="Out of sync with supervisor — click to review and trigger a refresh."
          onClick={(e) => {
            // Cards / table rows commonly listen for clicks to open the
            // skill workspace; don't let this bubble.
            e.stopPropagation();
            e.preventDefault();
            setConfirmOpen(true);
          }}
          aria-label="Supervisor out of sync — open sync dialog"
        >
          <AlertTriangle className={iconClass} aria-hidden="true" />
        </button>
        <SupervisorStaleDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={() => {
            setConfirmOpen(false);
            router.push(staleHref);
          }}
        />
      </>
    );
  }
  return (
    <span
      className={`inline-flex items-center justify-center text-muted-foreground/50 ${className ?? ""}`}
      title="Supervisor sync status unavailable — backend not reachable or no merge has occurred yet."
    >
      <HelpCircle className={iconClass} aria-label="Supervisor sync unknown" />
    </span>
  );
}

/**
 * Confirmation modal shown when the user clicks the amber out-of-sync
 * indicator. Surfaces the cost of a supervisor refresh up front (brief
 * unavailability) and explicitly reassures that dynamic custom agents
 * are unaffected — they consume skills via the skills-middleware /
 * `agent_skills` projection, not the supervisor's compiled graph.
 */
interface SupervisorStaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

function SupervisorStaleDialog({
  open,
  onOpenChange,
  onConfirm,
}: SupervisorStaleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Skill not synced with supervisor
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-2 text-left">
            <span className="block">
              This skill has been edited since the supervisor&apos;s last
              merge, so the running multi-agent graph isn&apos;t using
              the latest version yet.
            </span>
            <span className="block">
              Would you like to open the Admin → Skills page and trigger
              a sync?
            </span>
            <span className="block rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              Heads-up: refreshing the supervisor recompiles the graph
              and may cause a brief period of unavailability for
              supervisor-routed traffic. Dynamic custom agents are not
              impacted — they pick up skill changes immediately.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Stay here
          </Button>
          <Button type="button" onClick={onConfirm}>
            Open Admin → Skills
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Hook: shared supervisor status fetch
// ---------------------------------------------------------------------------

interface SupervisorStatus {
  reachable: boolean;
  loading: boolean;
  mergedAt: Date | null;
}

export function useSupervisorStatus(): SupervisorStatus {
  const [status, setStatus] = useState<SupervisorStatus>({
    reachable: false,
    loading: true,
    mergedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills/supervisor-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const reachable =
          data && typeof data === "object" && !("message" in data);
        const merged =
          typeof data?.skills_merged_at === "string"
            ? new Date(data.skills_merged_at)
            : null;
        setStatus({
          reachable: Boolean(reachable),
          loading: false,
          mergedAt:
            merged && !Number.isNaN(merged.getTime()) ? merged : null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ reachable: false, loading: false, mergedAt: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

/**
 * Convenience hook for a single skill: returns the badge state derived
 * from the supervisor merge timestamp.
 */
export function useSupervisorSyncStateForSkill(
  skill: AgentSkill | null | undefined,
): SupervisorSyncState {
  const status = useSupervisorStatus();
  return useMemo(() => {
    if (!skill) return "unknown";
    if (!status.reachable || status.loading) return "unknown";
    if (!status.mergedAt) return "unknown";
    const updated =
      skill.updated_at instanceof Date
        ? skill.updated_at
        : new Date(skill.updated_at);
    if (Number.isNaN(updated.getTime())) return "unknown";
    return updated.getTime() <= status.mergedAt.getTime() ? "synced" : "stale";
  }, [skill, status]);
}
