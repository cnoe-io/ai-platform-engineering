"use client";

/**
 * Onboarded-repo grid for the Ship Loop home page.
 *
 * Fetches `/api/ship-loop/repos` and renders one card per active
 * repo with the four high-signal counts (open epics, in-flight
 * sub-tasks, PRs awaiting review, deploys in last 24h). Each card
 * deep-links into the per-repo page where the Epic list lives.
 *
 * Empty state, loading state, error state are all explicit so the
 * mock-webhook demo never shows a confusing blank panel.
 */

import {
  AlertTriangle,
  GitPullRequest,
  Layers,
  Loader2,
  Rocket,
  Ship,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface RepoListItem {
  repo_id: string;
  owner: string;
  name: string;
  full_name: string;
  sandbox_environment: string;
  webhook_status: "healthy" | "degraded" | "missing" | "unknown";
  counts: {
    open_epics: number;
    in_flight_subtasks: number;
    prs_awaiting_review: number;
    deploys_24h: number;
  };
}

interface RepoListResponse {
  items: RepoListItem[];
}

const HEALTH_CLASS: Record<RepoListItem["webhook_status"], string> = {
  healthy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  degraded: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  missing: "bg-red-500/15 text-red-300 border-red-500/30",
  unknown: "bg-muted/40 text-muted-foreground border-border/40",
};

export function RepoGrid({ className }: { className?: string }) {
  const [items, setItems] = useState<RepoListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ship-loop/repos", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setError(`http_${res.status}`);
          return;
        }
        const body = (await res.json()) as RepoListResponse;
        if (!cancelled) setItems(body.items ?? []);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "fetch_failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div
        className={cn(
          "rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300",
          className,
        )}
        role="alert"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Could not load onboarded repos ({error}).
        </div>
        <p className="mt-1 text-xs text-amber-300/70">
          If you are running the mock-webhook demo, make sure the dev server has{" "}
          <code className="rounded bg-amber-500/10 px-1 py-0.5 text-[11px]">
            SHIP_LOOP_ALLOW_NO_AUTH=true
          </code>{" "}
          and you ran <code>npm run ship-loop:seed-mock-repo</code>.
        </p>
      </div>
    );
  }

  if (items === null) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-border/40 bg-card/30 px-4 py-8 text-sm text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        Loading repos…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border/40 bg-card/20 px-4 py-8 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        <Ship className="mx-auto mb-2 h-5 w-5 opacity-60" aria-hidden />
        No repos onboarded yet. Onboarding lands in US1; for now you can
        seed a mock repo with{" "}
        <code className="rounded bg-muted/40 px-1 py-0.5 text-[11px]">
          npm run ship-loop:seed-mock-repo
        </code>
        .
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
        className,
      )}
      role="list"
      aria-label="Onboarded repos"
    >
      {items.map((r) => (
        <Link
          key={r.repo_id}
          role="listitem"
          href={`/ship-loop/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`}
          className="glass-panel hover-glow group flex flex-col gap-3 rounded-xl border border-border/40 p-4 transition"
        >
          <header className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {r.owner}
              </p>
              <h3 className="truncate text-sm font-semibold text-foreground">
                {r.name}
              </h3>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                HEALTH_CLASS[r.webhook_status],
              )}
              aria-label={`Webhook ${r.webhook_status}`}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  r.webhook_status === "healthy" && "bg-emerald-400",
                  r.webhook_status === "degraded" && "bg-amber-400",
                  r.webhook_status === "missing" && "bg-red-400",
                  r.webhook_status === "unknown" && "bg-muted-foreground",
                )}
                aria-hidden
              />
              {r.webhook_status}
            </span>
          </header>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat icon={Layers} label="Open Epics" value={r.counts.open_epics} />
            <Stat
              icon={Layers}
              label="Sub-tasks"
              value={r.counts.in_flight_subtasks}
            />
            <Stat
              icon={GitPullRequest}
              label="PRs in review"
              value={r.counts.prs_awaiting_review}
              accentWhenNonZero
            />
            <Stat
              icon={Rocket}
              label="Deploys 24h"
              value={r.counts.deploys_24h}
            />
          </div>

          <footer className="text-[10px] text-muted-foreground">
            Sandbox: {r.sandbox_environment}
          </footer>
        </Link>
      ))}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accentWhenNonZero,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: number;
  accentWhenNonZero?: boolean;
}) {
  const accent = accentWhenNonZero && value > 0;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2 py-1.5",
        accent && "border-amber-400/40 bg-amber-500/5",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          accent ? "text-amber-300" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-[10px] leading-tight text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "text-sm font-semibold leading-tight",
            accent ? "text-amber-300" : "text-foreground",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
