"use client";

/**
 * Spec Health panel — circular gauge + per-epic missing-criteria list.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { Loader2, Sparkles, Target } from "lucide-react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { useInsightsFetch } from "@/hooks/use-insights-fetch";
import type { SpecHealthSummary } from "@/types/agentic-sdlc";

interface SpecHealthPanelProps {
  owner: string;
  repo: string;
}

export function SpecHealthPanel({ owner, repo }: SpecHealthPanelProps) {
  const { data: rawData, loading, error } = useInsightsFetch<SpecHealthSummary>({
    owner,
    repo,
    panel: "spec-health",
  });
  const data: SpecHealthSummary | null = rawData
    ? {
        repo_score: rawData.repo_score ?? 0,
        epics: Array.isArray(rawData.epics) ? rawData.epics : [],
        generated_at: rawData.generated_at ?? new Date().toISOString(),
      }
    : null;

  return (
    <CollapsiblePanel
      title="Spec health"
      leading={<Target className="h-4 w-4 text-indigo-300" aria-hidden />}
      subtitle="Per-epic spec readiness: AC, NFR, constraints, tests, budget, ADRs."
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
    >
      <div className="flex items-start gap-4">
        <Gauge value={data?.repo_score ?? 0} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Repo score
          </p>
          <p className="text-2xl font-semibold text-foreground">
            {data?.repo_score ?? "—"}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              / 100
            </span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data?.epics.length ?? 0} epics scored.
          </p>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Could not load spec health ({error}).
        </p>
      )}
      {loading && !data && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading…
        </p>
      )}
      {data && data.epics.length === 0 && (
        <p className="mt-3 rounded-md border border-dashed border-border/40 bg-background/20 px-3 py-2 text-[11px] text-muted-foreground">
          No epics yet — the score appears once specs land.
        </p>
      )}
      <ul className="mt-3 space-y-1.5">
        {data?.epics.slice(0, 6).map((epic) => (
          <li
            key={epic.epic_id}
            className="rounded-md border border-border/30 bg-background/30 px-2.5 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <a
                href={epic.github_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs font-medium text-foreground hover:text-primary"
              >
                {epic.title}
              </a>
              <BandBadge band={epic.band} score={epic.score} />
            </div>
            <ul className="mt-1 flex flex-wrap gap-1 text-[10px]">
              {epic.criteria
                .filter((c) => !c.present)
                .slice(0, 4)
                .map((c) => (
                  <li
                    key={c.kind}
                    className="rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-200"
                    title={c.hint}
                  >
                    missing: {c.label}
                  </li>
                ))}
              {epic.criteria.every((c) => c.present) && (
                <li className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">
                  <Sparkles className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" aria-hidden />
                  agent-ready
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </CollapsiblePanel>
  );
}

function Gauge({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = 8;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const tone =
    clamped >= 85
      ? "stroke-emerald-400"
      : clamped >= 70
        ? "stroke-cyan-400"
        : clamped >= 50
          ? "stroke-amber-400"
          : "stroke-red-400";
  return (
    <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80" aria-hidden>
      <circle
        cx="40"
        cy="40"
        r={radius}
        strokeWidth={stroke}
        className="stroke-border/40"
        fill="none"
      />
      <circle
        cx="40"
        cy="40"
        r={radius}
        strokeWidth={stroke}
        strokeLinecap="round"
        className={tone}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        style={{ transition: "stroke-dashoffset 700ms ease-out" }}
      />
    </svg>
  );
}

function BandBadge({
  band,
  score,
}: {
  band: "weak" | "fair" | "good" | "strong";
  score: number;
}) {
  const map = {
    weak: "border-red-400/30 bg-red-500/10 text-red-200",
    fair: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    good: "border-cyan-400/30 bg-cyan-500/10 text-cyan-200",
    strong: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  } as const;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[band]}`}
    >
      {band} {score}
    </span>
  );
}
