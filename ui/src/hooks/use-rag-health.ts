"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { config } from "@/lib/config";
import { getHealthStatus } from "@/components/rag/api";

export type HealthStatus = "checking" | "connected" | "disconnected" | "disabled";

const POLL_INTERVAL_MS = 30000; // 30 seconds

interface UseRAGHealthResult {
  status: HealthStatus;
  url: string;
  lastChecked: Date | null;
  secondsUntilNextCheck: number;
  graphRagEnabled: boolean;
  ragEnabled: boolean;
  checkNow: () => void;
}

/**
 * Hook to check RAG server health status
 * Polls every 30 seconds to check if RAG server is healthy
 * Skips health checks entirely if ENABLE_RAG is false
 */
export function useRAGHealth(): UseRAGHealthResult {
  const ragEnabled = config.ragEnabled;
  const [status, setStatus] = useState<HealthStatus>(ragEnabled ? "checking" : "disabled");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(0);
  const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);
  const nextCheckTimeRef = useRef<number>(Date.now() + POLL_INTERVAL_MS);
  const hasInitialCheckCompleted = useRef<boolean>(false);
  const url = config.ragUrl;
  const ragEnabled = config.ragEnabled;

  const checkHealth = useCallback(async () => {
    // Skip health check if RAG is disabled
    if (!ragEnabled) {
      setStatus("disabled");
      hasInitialCheckCompleted.current = true;
      return;
    }

    // Only show "checking" state on initial load, not on subsequent polls
    if (!hasInitialCheckCompleted.current) {
      setStatus("checking");
    }

    try {
      const data = await getHealthStatus();
      
      if (data.status === "healthy") {
        setStatus("connected");
        setGraphRagEnabled(data.config?.graph_rag_enabled ?? true);
      } else {
        setStatus("disconnected");
      }
      
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
      hasInitialCheckCompleted.current = true;
    } catch (error) {
      console.error("[RAG] Error checking health:", error);
      setStatus("disconnected");
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
      hasInitialCheckCompleted.current = true;
    }
  }, [ragEnabled]);

  // Update countdown timer every second
  useEffect(() => {
    // Skip countdown if RAG is disabled
    if (!ragEnabled) return;

    const countdownInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextCheckTimeRef.current - Date.now()) / 1000));
      setSecondsUntilNextCheck(remaining);
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [ragEnabled]);

  useEffect(() => {
    // Skip polling if RAG is disabled
    if (!ragEnabled) {
      setStatus("disabled");
      return;
    }

    // Check immediately on mount
    checkHealth();

    // Set up 30-second polling interval
    const interval = setInterval(checkHealth, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkHealth, ragEnabled]);

  return {
    status,
    url,
    lastChecked,
    secondsUntilNextCheck,
    graphRagEnabled,
    ragEnabled,
    checkNow: checkHealth,
  };
}
