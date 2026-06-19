"use client";

import { useCallback,useEffect,useRef,useState } from "react";

export type PlatformProbeStatus = "checking" | "healthy" | "degraded" | "down";
export type PlatformProbeGroup = "core" | "identity" | "storage" | "rag" | "bootstrap";

export interface PlatformProbeRemediation {
  label: string;
  href: string;
  description: string;
}

export interface PlatformHealthProbe {
  id: string;
  label: string;
  group: PlatformProbeGroup;
  status: "healthy" | "warning" | "down";
  detail: string;
  target: string;
  latency_ms: number | null;
  remediation?: PlatformProbeRemediation;
}

interface PlatformHealthResponse {
  status: "healthy" | "degraded" | "down";
  checked_at: string;
  summary: {
    total: number;
    healthy: number;
    warning: number;
    down: number;
  };
  probes: PlatformHealthProbe[];
}

interface UsePlatformHealthProbesResult {
  status: PlatformProbeStatus;
  probes: PlatformHealthProbe[];
  summary: PlatformHealthResponse["summary"] | null;
  secondsUntilNextCheck: number;
  checkNow: () => void;
}

const POLL_INTERVAL_MS = 30000;

export function usePlatformHealthProbes(): UsePlatformHealthProbesResult {
  const [status, setStatus] = useState<PlatformProbeStatus>("checking");
  const [probes, setProbes] = useState<PlatformHealthProbe[]>([]);
  const [summary, setSummary] = useState<PlatformHealthResponse["summary"] | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(0);
  const nextCheckTimeRef = useRef<number>(0);

  const checkNow = useCallback(async () => {
    if (probes.length === 0) setStatus("checking");

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
      setProbes(Array.isArray(body.probes) ? body.probes : []);
      setSummary(body.summary ?? null);
      setStatus(response.ok && body.status === "healthy" ? "healthy" : body.status === "degraded" ? "degraded" : "down");
    } catch {
      setStatus("down");
      setSummary(null);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    }
  }, [probes.length]);

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
    probes,
    summary,
    secondsUntilNextCheck,
    checkNow,
  };
}
