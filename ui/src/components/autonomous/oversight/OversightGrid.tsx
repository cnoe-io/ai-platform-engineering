"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRelative } from "@/components/autonomous/taskPresentation";
import type { OversightResult } from "@/lib/autonomous/oversight-grouping";
import {
  summarizeOversight,
  type OversightSummary,
  type TeamCardVM,
  type TeamHealth,
} from "@/lib/autonomous/oversight-view";

interface OversightGridProps {
  data: OversightResult;
  /** slug for a team, or null for the "No team" bucket. */
  onOpenTeam: (slug: string | null) => void;
}

const HEALTH_DOT: Record<TeamHealth, string> = {
  at_risk: "bg-destructive",
  watch: "bg-amber-500",
  healthy: "bg-emerald-500",
  quiet: "bg-muted-foreground/40",
};

/** Stable React key for a card (the no-team bucket has a null slug). */
const cardKey = (c: TeamCardVM) => c.slug ?? "__no_team";

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("font-semibold tabular-nums", tone)}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function SummaryStrip({ totals }: { totals: OversightSummary["totals"] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
      <Stat label="teams" value={totals.teams} />
      <Stat label="tasks" value={totals.tasks} />
      <Stat
        label="paused"
        value={totals.paused}
        tone={totals.paused ? "text-amber-600 dark:text-amber-300" : undefined}
      />
      <Stat
        label="failed"
        value={totals.failed}
        tone={totals.failed ? "text-destructive" : undefined}
      />
    </div>
  );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px]", tone)}>{children}</span>;
}

function AttentionCard({ card, onClick }: { card: TeamCardVM; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[card.health])} />
        <span className="truncate text-sm font-medium">{card.name}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {card.total} {card.total === 1 ? "task" : "tasks"} · {card.people}{" "}
        {card.people === 1 ? "person" : "people"}
      </div>
      <div className="flex flex-wrap gap-1">
        {card.failed > 0 && <Pill tone="bg-destructive/10 text-destructive">{card.failed} failed</Pill>}
        {card.paused > 0 && (
          <Pill tone="bg-amber-500/10 text-amber-600 dark:text-amber-300">{card.paused} paused</Pill>
        )}
      </div>
      {card.nextRunIso && (
        <div className="text-[11px] text-muted-foreground">next run {formatRelative(card.nextRunIso)}</div>
      )}
    </button>
  );
}

function TeamChip({ card, muted, onClick }: { card: TeamCardVM; muted?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted/50",
        muted && "text-muted-foreground",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", HEALTH_DOT[card.health])} />
      {card.name}
      {!muted && <span className="text-muted-foreground">· {card.total}</span>}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * Attention-first teams overview (spec 2026-07-06 redesign). An org summary
 * strip on top, then teams that need attention (failed/paused) as cards,
 * healthy teams as chips, and zero-task "quiet" teams as muted chips. All are
 * clickable and drill into the team detail via `onOpenTeam`.
 */
export function OversightGrid({ data, onOpenTeam }: OversightGridProps) {
  const summary = summarizeOversight(data);
  const nothing =
    summary.attention.length === 0 && summary.healthy.length === 0 && summary.quiet.length === 0;

  return (
    <div className="space-y-5">
      <SummaryStrip totals={summary.totals} />

      {nothing ? (
        <div className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          No teams or autonomous tasks yet.
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <SectionHeading>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Needs attention
            </SectionHeading>
            {summary.attention.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {summary.attention.map((c) => (
                  <AttentionCard key={cardKey(c)} card={c} onClick={() => onOpenTeam(c.slug)} />
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> All teams healthy — no paused or
                failed tasks.
              </p>
            )}
          </section>

          {summary.healthy.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>Healthy</SectionHeading>
              <div className="flex flex-wrap gap-2">
                {summary.healthy.map((c) => (
                  <TeamChip key={cardKey(c)} card={c} onClick={() => onOpenTeam(c.slug)} />
                ))}
              </div>
            </section>
          )}

          {summary.quiet.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>Quiet · no tasks</SectionHeading>
              <div className="flex flex-wrap gap-2">
                {summary.quiet.map((c) => (
                  <TeamChip key={cardKey(c)} card={c} muted onClick={() => onOpenTeam(c.slug)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
