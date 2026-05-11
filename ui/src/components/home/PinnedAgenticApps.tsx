"use client";

// assisted-by Codex Codex-sonnet-4-6

import { ArrowUpRight, Sparkles, Star } from "lucide-react";

import type { AgenticAppListItem } from "@/lib/api-client";

interface PinnedAgenticAppsProps {
  items: AgenticAppListItem[];
  loading: boolean;
}

export function PinnedAgenticApps({ items, loading }: PinnedAgenticAppsProps) {
  if (loading) {
    return (
      <section
        data-testid="pinned-agentic-apps"
        className="rounded-2xl border border-white/10 bg-slate-900/60 p-6"
      >
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">
          <Sparkles className="h-4 w-4" aria-hidden /> Pinned Apps
        </div>
        <p className="mt-3 text-sm text-slate-400">Loading your pinned apps...</p>
      </section>
    );
  }

  return (
    <section
      data-testid="pinned-agentic-apps"
      className="rounded-2xl border border-white/10 bg-slate-900/65 p-6 shadow-xl shadow-slate-950/30"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">
          <Star className="h-4 w-4" fill="currentColor" aria-hidden /> Pinned Apps
        </div>
        <a
          href="/apps"
          className="text-xs font-semibold text-cyan-200 hover:text-cyan-100"
        >
          Manage in Apps Hub
        </a>
      </div>

      {items.length === 0 ? (
        <div
          data-testid="pinned-agentic-apps-empty"
          className="mt-5 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-slate-300"
        >
          <p>
            No apps pinned yet. Open the Apps Hub and use the{" "}
            <Star className="inline-block h-3.5 w-3.5 align-text-bottom text-amber-200" aria-hidden />{" "}
            star on any app to pin it here for quick access.
          </p>
          <a
            href="/apps"
            className="inline-flex items-center gap-1 rounded-full border border-cyan-200/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
          >
            Browse Apps Hub
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((app) => (
            <a
              key={app.appId}
              href={app.href}
              aria-label={`Open ${app.displayName}`}
              className="group flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/55 p-4 transition hover:-translate-y-0.5 hover:border-cyan-200/30 hover:bg-slate-900/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-cyan-300/10 text-cyan-100">
                <Sparkles className="h-5 w-5" aria-hidden />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{app.displayName}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{app.description}</p>
              </div>
              <ArrowUpRight
                className="h-4 w-4 text-slate-500 transition group-hover:text-cyan-200"
                aria-hidden
              />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
