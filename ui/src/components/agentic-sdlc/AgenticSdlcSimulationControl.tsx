"use client";

import { Bot, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useFeatureFlagStore } from "@/store/feature-flag-store";

// assisted-by Codex Codex-sonnet-4-6

interface AgenticSdlcSimulationControlProps {
  owner: string;
  repo: string;
  className?: string;
}

interface SimulationResponse {
  simulated: true;
  epic_id: string;
  artifacts_created: number;
  events_created: number;
  message: string;
}

export function AgenticSdlcSimulationControl({
  owner,
  repo,
  className,
}: AgenticSdlcSimulationControlProps) {
  const simulationEnabled = useFeatureFlagStore(
    (s) => s.flags.shipLoopSimulation ?? false,
  );
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle",
  );
  const [summary, setSummary] = useState<string | null>(null);

  if (!simulationEnabled) {
    return null;
  }

  async function runSimulation() {
    setStatus("running");
    setSummary(null);
    try {
      const res = await fetch(
        `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/simulate`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      );
      const body = (await res.json()) as Partial<SimulationResponse> & {
        message?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? `Simulation failed (${res.status})`);
      }

      setStatus("done");
      setSummary(
        `Simulation seeded: ${body.artifacts_created ?? 0} artifacts, ${body.events_created ?? 0} events.`,
      );
      window.dispatchEvent(
        new CustomEvent("ship-loop:simulation-seeded", {
          detail: { owner, repo, epic_id: body.epic_id },
        }),
      );
      window.dispatchEvent(new CustomEvent("ship-loop:repo-onboarded"));
    } catch (error) {
      setStatus("error");
      setSummary(error instanceof Error ? error.message : "Simulation failed.");
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-primary/20 bg-primary/5 p-3",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
            <Bot className="h-3.5 w-3.5" aria-hidden />
            Simulation mode
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Seed local GitHub-shaped Epics, issues, PRs, labels, review, and
            sandbox deploy events. No GitHub writes.
          </p>
        </div>
        <button
          type="button"
          onClick={runSimulation}
          disabled={status === "running"}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {status === "running" ? "Seeding..." : "Run simulation"}
        </button>
      </div>
      {summary && (
        <p
          className={cn(
            "mt-2 text-xs",
            status === "error" ? "text-amber-300" : "text-emerald-300",
          )}
          role={status === "error" ? "alert" : "status"}
        >
          {summary}
        </p>
      )}
    </div>
  );
}
