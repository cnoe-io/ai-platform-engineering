"use client";

/**
 * Tiny shared fetch hook for repo-detail insight panels. Centralises
 * the URL shape, response normalisation, error handling, and the
 * `agentic-sdlc:repo-synced` reload event.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { useCallback, useEffect, useState } from "react";

interface UseInsightsFetchArgs {
  owner: string;
  repo: string;
  panel: string; // matches the panel slug in /insights/[panel]
  enabled?: boolean;
}

export interface UseInsightsFetchResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useInsightsFetch<T>(args: UseInsightsFetchArgs): UseInsightsFetchResult<T> {
  const { owner, repo, panel, enabled = true } = args;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/insights/${panel}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );
      if (!res.ok) throw new Error(`http_${res.status}`);
      const body = (await res.json()) as T;
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, panel, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onRepoSynced(event: Event) {
      const detail = (event as CustomEvent<{ owner?: string; repo?: string }>).detail;
      if (detail?.owner === owner && detail?.repo === repo) void load();
    }
    window.addEventListener("agentic-sdlc:repo-synced", onRepoSynced);
    return () =>
      window.removeEventListener("agentic-sdlc:repo-synced", onRepoSynced);
  }, [owner, repo, load]);

  return { data, error, loading, reload: load };
}
