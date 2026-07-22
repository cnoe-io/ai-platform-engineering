"use client";

import { useCallback,useEffect,useState } from "react";

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

/** Fetch the signed-in user's available agents for all personal-default pickers. */
export function useAccessibleAgents(): UseAccessibleAgentsState {
  const [agents, setAgents] = useState<AccessibleAgent[]>([]);
  const [loading, setLoading] = useState(true);
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
