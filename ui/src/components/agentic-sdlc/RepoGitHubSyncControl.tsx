"use client";

import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
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

export function RepoGitHubSyncControl({
  owner,
  repo,
}: RepoGitHubSyncControlProps) {
  const [status, setStatus] = useState<"idle" | "syncing" | "ok" | "error">(
    "idle",
  );
  const [message, setMessage] = useState(
    "Pull current issues and PRs if webhooks were missed.",
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
    <div className="flex flex-col gap-3 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">
          GitHub state refresh
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {status === "ok" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
          ) : status === "error" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden />
          ) : null}
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void runSync()}
        disabled={status === "syncing"}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw
          className={[
            "h-4 w-4",
            status === "syncing" ? "animate-spin" : "",
          ].join(" ")}
          aria-hidden
        />
        Refresh from GitHub
      </button>
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
