"use client";

import { Ship, GitBranch, Workflow, AlertTriangle } from "lucide-react";

/**
 * Ship Loop home (placeholder).
 *
 * Shipped early as a visible demo target for the toggle wiring; real
 * functionality lands in T039 (full ShipLoopHome with onboarded-repo
 * grid + empty-state) and T032/T033 (the /api/ship-loop/repos route
 * powering it). When that lands, this file will replace the placeholder
 * blocks below with the live data.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */
export function ShipLoopHome() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Hero */}
        <div className="flex items-start gap-4 p-6 rounded-xl border border-border/50 bg-card">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Ship className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              Agentic SDLC Ship Loop
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Onboard a GitHub repo and watch agents drive an Epic from
              specification through sub-tasks, pull requests, human-in-the-loop
              review, merge, and sandbox deployment — live, label-driven, and
              webhook-fed.
            </p>
          </div>
        </div>

        {/* Coming-soon notice */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <div className="text-sm space-y-1">
            <p className="font-medium">Preview build</p>
            <p className="text-amber-200/80">
              The Ship Loop tab is wired up and the toggle works end-to-end.
              Onboarding, the per-Epic visualizations, and the live dashboard
              are landing in subsequent commits — track progress in{" "}
              <code className="px-1 py-0.5 rounded bg-black/20 text-xs">
                docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/tasks.md
              </code>
              .
            </p>
          </div>
        </div>

        {/* Capabilities preview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg border border-border/50 bg-card space-y-2">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">Onboard a repo</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Connect any GitHub repository you have access to. We register a
              webhook scoped to the events the Ship Loop needs.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Lands in US1 (T030–T043).
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border/50 bg-card space-y-2">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">Visualize an Epic</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Switch among Pipeline, Kanban, Timeline, Dependency Graph, and
              Ship-Loop Radar views — all driven from the same event log.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Lands in US2 (T044–T058) and US4 (T067–T070).
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border/50 bg-card space-y-2">
            <div className="flex items-center gap-2">
              <Ship className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">Stay in the loop</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Approve, request changes, comment, or retry deploys inline. Talk
              to a read-only agent assistant scoped to the active Epic.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Lands in US5 (T071–T083).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
