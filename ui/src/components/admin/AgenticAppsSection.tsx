"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useEffect, useState } from "react";

import type { AgenticAppAuditEventRecord } from "@/types/agentic-app";

export function AgenticAppsSection() {
  const [events, setEvents] = useState<AgenticAppAuditEventRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/admin/agentic-apps/audit?limit=25", {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`audit fetch failed: ${response.status}`);
        const body = (await response.json()) as { items?: AgenticAppAuditEventRecord[] };
        if (!cancelled) setEvents(body.items ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load app audit");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">Agentic Apps</p>
          <h2 className="mt-2 text-xl font-semibold text-white">App Platform Audit</h2>
        </div>
      </div>
      {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      <div className="mt-4 space-y-2">
        {events.length === 0 && !error ? (
          <p className="text-sm text-slate-400">No app platform audit events found.</p>
        ) : null}
        {events.map((event) => (
          <article
            key={`${event.createdAt}-${event.type}-${event.correlationId ?? ""}`}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-white">{event.type}</span>
              {event.appId ? <span className="text-cyan-200">{event.appId}</span> : null}
              {event.reasonCode ? <span className="text-amber-200">{event.reasonCode}</span> : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {event.createdAt}
              {event.correlationId ? ` · correlation ${event.correlationId}` : ""}
              {event.decisionId ? ` · decision ${event.decisionId}` : ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
