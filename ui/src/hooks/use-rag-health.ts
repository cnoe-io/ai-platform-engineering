"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { config } from "@/lib/config";
import { getHealthStatus } from "@/components/rag/api";

export type HealthStatus = "checking" | "connected" | "disconnected";

const POLL_INTERVAL_MS = 30000; // 30 seconds

interface UseRAGHealthResult {
  status: HealthStatus;
  url: string;
  lastChecked: Date | null;
  secondsUntilNextCheck: number;
  graphRagEnabled: boolean;
  checkNow: () => void;
}

/**
 * Hook to check RAG server health status
 * Polls every 30 seconds to check if RAG server is healthy
 */
export function useRAGHealth(): UseRAGHealthResult {
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(0);
  const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);
  const nextCheckTimeRef = useRef<number>(Date.now() + POLL_INTERVAL_MS);
  const url = config.ragUrl;

  const checkHealth = useCallback(async () => {
    setStatus("checking");

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
    } catch (error) {
      console.error("[RAG] Error checking health:", error);
      setStatus("disconnected");
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    }
  }, []);

  // Update countdown timer every second
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextCheckTimeRef.current - Date.now()) / 1000));
      setSecondsUntilNextCheck(remaining);
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, []);

  useEffect(() => {
    // Check immediately on mount
    checkHealth();

    // Set up 30-second polling interval
    const interval = setInterval(checkHealth, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkHealth]);

  return {
    status,
    url,
    lastChecked,
    secondsUntilNextCheck,
    graphRagEnabled,
    checkNow: checkHealth,
  };
}
