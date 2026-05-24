"use client";

import { useCallback, useEffect, useState } from "react";

export interface AccessibleAgent {
  id: string;
  name: string;
  description: string;
}

interface UseAccessibleAgentsState {
  agents: AccessibleAgent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface AccessibleAgentsResponse {
  success?: boolean;
  data?: {
    agents?: AccessibleAgent[];
    total?: number;
    page?: number;
    page_size?: number;
  };
  error?: string;
}

/**
 * Tiny hook that fetches `/api/user/accessible-agents` once on mount and
 * exposes a `refresh()` callback for cases where the list changes (e.g. the
 * user just got added to a team).
 *
 * Intentionally simple — no SWR-like deduping. The DM-preference panel is
 * a small, mostly-idle surface; we'd rather keep the dependency surface
 * minimal than introduce a global cache.
 */
export function useAccessibleAgents(): UseAccessibleAgentsState {
  const [agents, setAgents] = useState<AccessibleAgent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/user/accessible-agents?page_size=100", {
        method: "GET",
        credentials: "same-origin",
      });
      const json = (await response.json()) as AccessibleAgentsResponse;
      if (!response.ok || !json.success) {
        setError(
          typeof json.error === "string"
            ? json.error
            : `Failed to load agents (HTTP ${response.status})`,
        );
        setAgents([]);
        return;
      }
      setAgents(json.data?.agents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { agents, loading, error, refresh };
}
