"use client";

/**
 * Timeline view -- a chronological stream of recent events. The
 * Epic page already gets `recent_events` from the GET response and
 * patches new ones in via SSE, so the component is a pure
 * render-of-list.
 *
 * Each row carries a small kind badge (issues / pull_request /
 * deployment_status / etc), the actor (agent vs human), the
 * occurred_at timestamp, and a one-line summary. We intentionally
 * keep this terse -- the timeline is for skimming, not auditing.
 */

import { Bot, User, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ShipLoopEvent } from "@/types/ship-loop";

type SafeEvent = Omit<ShipLoopEvent, "payload" | "_id">;

interface TimelineViewProps {
  events: SafeEvent[];
  className?: string;
}

export function TimelineView({ events, className }: TimelineViewProps) {
  if (events.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border/40 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        <Workflow className="mx-auto mb-2 h-5 w-5 opacity-50" aria-hidden />
        No events yet — once the agents push the first webhook, this stream
        starts filling in real time.
      </div>
    );
  }
  return (
    <ol
      className={cn("flex flex-col gap-2", className)}
      aria-label="Recent events"
    >
      {events.map((ev, idx) => (
        <TimelineRow key={`${ev.github_delivery_id ?? idx}`} ev={ev} />
      ))}
    </ol>
  );
}

function TimelineRow({ ev }: { ev: SafeEvent }) {
  const actorIsAgent = ev.actor_kind === "agent";
  const ActorIcon = actorIsAgent ? Bot : User;
  return (
    <li className="flex items-start gap-3 rounded-md border border-border/40 bg-card/30 px-3 py-2">
      <span
        className={cn(
          "mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs",
          actorIsAgent
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        <ActorIcon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">
            {ev.github_event_type ?? "event"}
            {ev.github_action ? ` · ${ev.github_action}` : ""}
          </span>
          <span className="text-muted-foreground">
            {ev.actor_login ?? (actorIsAgent ? "agent" : "system")}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/70">
            {formatRelative(ev.occurred_at)}
          </span>
        </div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          {ev.artifact_kind} · {ev.artifact_id}
        </div>
      </div>
    </li>
  );
}

function formatRelative(input: Date | string): string {
  const t = typeof input === "string" ? Date.parse(input) : input.getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}
