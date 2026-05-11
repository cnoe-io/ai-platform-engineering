"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

// assisted-by Codex Codex-sonnet-4-6

interface RepoGitHubSyncControlProps {
  owner: string;
  repo: string;
}

interface SyncResponse {
  synced?: boolean;
  artifacts_upserted?: number;
  events_recorded?: number;
  last_reconciled_at?: string;
}

const AUTO_SYNC_TTL_MS = 5 * 60 * 1000;
const REFRESH_TOOLTIP = "Pull current issues and PRs if webhooks were missed.";

export function RepoGitHubSyncControl({
  owner,
  repo,
}: RepoGitHubSyncControlProps) {
  const [status, setStatus] = useState<"idle" | "syncing" | "ok" | "error">(
    "idle",
  );
  const [message, setMessage] = useState(
    REFRESH_TOOLTIP,
  );

  const syncUrl = `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/sync`;

  async function runSync() {
    setStatus("syncing");
    setMessage("Reconciling issues and PRs from GitHub...");
    try {
      const res = await fetch(syncUrl, {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        setStatus("error");
        setMessage(`GitHub refresh failed (HTTP ${res.status}).`);
        return;
      }

      const body = (await res.json()) as SyncResponse;
      const artifacts = body.artifacts_upserted ?? 0;
      setStatus("ok");
      setMessage(`Synced ${artifacts} artifacts from GitHub.`);
      markAutoSynced(owner, repo);
      window.dispatchEvent(
        new CustomEvent("agentic-sdlc:repo-synced", {
          detail: { owner, repo, last_reconciled_at: body.last_reconciled_at },
        }),
      );
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "GitHub refresh failed.");
    }
  }

  useEffect(() => {
    if (shouldAutoSync(owner, repo)) {
      void runSync();
    }
    // Auto-sync should run once per repo mount; runSync intentionally
    // stays outside deps to avoid repeating after status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo]);

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void runSync()}
        disabled={status === "syncing"}
        title={REFRESH_TOOLTIP}
        aria-label="Refresh from GitHub"
        className={[
          "relative isolate inline-flex h-8 items-center justify-center gap-1.5 overflow-hidden rounded-md border px-2.5 text-xs font-medium transition",
          status === "ok"
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15"
            : status === "error"
              ? "border-amber-400/35 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"
              : status === "syncing"
                ? "border-cyan-300/50 bg-cyan-500/15 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.22)]"
                : "border-cyan-400/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15",
          "disabled:cursor-not-allowed disabled:opacity-60",
        ].join(" ")}
      >
        {status === "syncing" ? (
          <span
            data-github-refresh-halo
            className="absolute inset-0 rounded-md border border-cyan-200/40 motion-safe:animate-ping"
            aria-hidden
          />
        ) : null}
        <RefreshCw
          data-github-refresh-icon
          className={[
            "relative h-3.5 w-3.5",
            status === "syncing" ? "motion-safe:animate-spin" : "",
          ].join(" ")}
          aria-hidden
        />
        <span className="relative">Refresh</span>
      </button>
      <span className="sr-only" role="status">
        {message}
      </span>
    </div>
  );
}

function autoSyncKey(owner: string, repo: string): string {
  return `agentic-sdlc:auto-sync:${owner}/${repo}`;
}

function shouldAutoSync(owner: string, repo: string): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.sessionStorage.getItem(autoSyncKey(owner, repo));
  const last = raw ? Number.parseInt(raw, 10) : 0;
  return !Number.isFinite(last) || Date.now() - last > AUTO_SYNC_TTL_MS;
}

function markAutoSynced(owner: string, repo: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(autoSyncKey(owner, repo), String(Date.now()));
}
