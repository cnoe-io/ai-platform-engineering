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
      // Try to reach the CAIPE supervisor
      // We just need to check if it responds, even 401/403 means it's reachable
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      await fetch(url, {
        method: "OPTIONS",
        signal: controller.signal,
        mode: "no-cors", // Allow checking even with CORS restrictions
      });

      clearTimeout(timeoutId);
      
      // If we got here without error, the server is reachable
      setStatus("connected");
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    } catch (error) {
      // Try a regular fetch as fallback (might work if CORS is configured)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
          },
        });

        clearTimeout(timeoutId);

        // Any response (including 401, 403, 404) means server is reachable
        setStatus("connected");
        setLastChecked(new Date());
        nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
      } catch (fallbackError) {
        // Check if it's a network error or timeout
        if (fallbackError instanceof Error) {
          if (fallbackError.name === "AbortError") {
            setStatus("disconnected");
          } else {
            // Could be CORS error which actually means server is reachable
            setStatus("connected");
          }
        } else {
          setStatus("disconnected");
        }
        setLastChecked(new Date());
        nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
      }
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
