"use client";

import { useState, useEffect, useCallback, useRef, startTransition } from "react";

export type AgentRuntimeStatus = "checking" | "connected" | "disconnected";

const POLL_INTERVAL_MS = 30000; // 30 seconds

interface UseAgentRuntimeHealthResult {
  status: AgentRuntimeStatus;
  checkNow: () => void;
}

/**
 * Hook to check Dynamic Agents (Agent Runtime) health status.
 * Polls every 30 seconds via the Next.js proxy at /api/dynamic-agents/health.
 */
export function useAgentRuntimeHealth(): UseAgentRuntimeHealthResult {
  const [status, setStatus] = useState<AgentRuntimeStatus>("checking");
  const hasInitialCheckCompleted = useRef<boolean>(false);

  const checkHealth = useCallback(async () => {
    if (!hasInitialCheckCompleted.current) {
      setStatus("checking");
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch("/api/dynamic-agents/health", {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        setStatus(data.status === "healthy" ? "connected" : "disconnected");
      } else {
        setStatus("disconnected");
      }

      hasInitialCheckCompleted.current = true;
    } catch {
      setStatus("disconnected");
      hasInitialCheckCompleted.current = true;
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      void checkHealth();
    });
    const interval = setInterval(() => {
      void checkHealth();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return { status, checkNow: checkHealth };
}
