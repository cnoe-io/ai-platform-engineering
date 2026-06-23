"use client";

import { useCallback,useEffect,useRef,useState } from "react";

export type PlatformProbeStatus = "checking" | "healthy" | "degraded" | "down";
export type PlatformCapabilityGroup =
  | "runtime"
  | "knowledge"
  | "identity"
  | "observability"
  | "messaging";
export type PlatformCapabilityStatus = "healthy" | "degraded" | "down" | "disabled";

export interface PlatformHealthCapability {
  id: string;
  label: string;
  group: PlatformCapabilityGroup;
  status: PlatformCapabilityStatus;
  required: boolean;
  description: string;
  detail: string;
  latency_ms: number | null;
}

interface PlatformHealthResponse {
  status: "healthy" | "degraded" | "down";
  checked_at: string;
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
    disabled: number;
  };
  capabilities: PlatformHealthCapability[];
}

interface UsePlatformHealthProbesResult {
  status: PlatformProbeStatus;
  capabilities: PlatformHealthCapability[];
  summary: PlatformHealthResponse["summary"] | null;
  secondsUntilNextCheck: number;
  checkNow: () => void;
}

const POLL_INTERVAL_MS = 30000;

export function usePlatformHealthProbes(): UsePlatformHealthProbesResult {
  const [status, setStatus] = useState<PlatformProbeStatus>("checking");
  const [capabilities, setCapabilities] = useState<PlatformHealthCapability[]>([]);
  const [summary, setSummary] = useState<PlatformHealthResponse["summary"] | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(0);
  const nextCheckTimeRef = useRef<number>(0);
  // Stable refs so checkNow has no state in its deps; this avoids re-polling
  // immediately after each successful fetch updates capability state.
  const hasLoadedRef = useRef(false);
  // Consecutive bad-result counter. We only promote to a worse visible status
  // after 2 consecutive bad polls so a single blip doesn't flip the badge.
  const badStreakRef = useRef(0);
  const lastStatusRef = useRef<PlatformProbeStatus>("checking");

  const checkNow = useCallback(async () => {
    // Only show the "checking" spinner on the very first load; subsequent
    // re-polls keep the last known status so the badge never flashes.
    if (!hasLoadedRef.current) setStatus("checking");

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch("/api/platform/health", {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);

      const body = (await response.json()) as PlatformHealthResponse;
      hasLoadedRef.current = true;
      setCapabilities(Array.isArray(body.capabilities) ? body.capabilities : []);
      setSummary(body.summary ?? null);

      const next: PlatformProbeStatus =
        response.ok && body.status === "healthy"
          ? "healthy"
          : body.status === "degraded"
            ? "degraded"
            : "down";

      if (next === "healthy" || next === "degraded") {
        // Good or degraded result clears the bad streak and applies immediately.
        badStreakRef.current = 0;
        lastStatusRef.current = next;
        setStatus(next);
      } else {
        // Bad result: only commit "down" after 2 consecutive bad polls so a
        // transient network blip doesn't flip healthy → down → healthy.
        badStreakRef.current += 1;
        if (badStreakRef.current >= 2 || lastStatusRef.current === "checking") {
          lastStatusRef.current = next;
          setStatus(next);
        }
      }
    } catch {
      hasLoadedRef.current = true;
      badStreakRef.current += 1;
      if (badStreakRef.current >= 2 || lastStatusRef.current === "checking") {
        lastStatusRef.current = "down";
        setStatus("down");
        setSummary(null);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    }
  // Stable reference: all mutable state goes through refs, never the dep array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void checkNow();
    const interval = window.setInterval(checkNow, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [checkNow]);

  useEffect(() => {
    const countdownInterval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextCheckTimeRef.current - Date.now()) / 1000));
      setSecondsUntilNextCheck(remaining);
    }, 1000);
    return () => window.clearInterval(countdownInterval);
  }, []);

  return {
    status,
    capabilities,
    summary,
    secondsUntilNextCheck,
    checkNow,
  };
}
