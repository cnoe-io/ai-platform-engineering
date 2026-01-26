"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { config } from "@/lib/config";

export type HealthStatus = "checking" | "connected" | "disconnected";

const POLL_INTERVAL_MS = 30000; // 30 seconds

interface UseCAIPEHealthResult {
  status: HealthStatus;
  url: string;
  lastChecked: Date | null;
  secondsUntilNextCheck: number;
  checkNow: () => void;
}

/**
 * Hook to check CAIPE supervisor health status
 * Polls every 30 seconds and considers 401 as reachable (auth required but server is up)
 */
export function useCAIPEHealth(): UseCAIPEHealthResult {
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(0);
  const nextCheckTimeRef = useRef<number>(Date.now() + POLL_INTERVAL_MS);
  const url = config.caipeUrl;

  const checkHealth = useCallback(async () => {
    setStatus("checking");

    try {
      // Use the A2A agent card endpoint which supports GET
      // Base URL is like http://localhost:8000, agent card is at /.well-known/agent.json
      const baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
      const agentCardUrl = `${baseUrl}/.well-known/agent.json`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(agentCardUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
        },
      });

      clearTimeout(timeoutId);

      // Any HTTP response (even 4xx/5xx) means server is reachable
      setStatus("connected");
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    } catch (error) {
      // Network error or timeout
      if (error instanceof Error && error.name === "AbortError") {
        // Timeout
        setStatus("disconnected");
      } else if (error instanceof TypeError) {
        // Network error (server not reachable) or CORS
        setStatus("disconnected");
      } else {
        // Other errors - assume disconnected
        setStatus("disconnected");
      }
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    }
  }, [url]);

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
    checkNow: checkHealth,
  };
}
