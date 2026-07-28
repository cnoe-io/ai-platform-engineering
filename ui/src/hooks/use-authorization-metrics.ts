"use client";

import { getErrorMessage } from "@/lib/error-utils";
import { useCallback, useEffect, useRef, useState } from "react";

export interface AuthorizationDecisionStats {
  allow: number;
  byReason: Array<{ count: number; reason: string }>;
  deny: number;
  denyRate: number;
  policyDeny: number;
  policyDenyRate: number;
  topDenied: Array<{ count: number; resource: string }>;
  total: number;
  truncated: boolean;
  unavailable: number;
  unavailableRate: number;
}

export interface AuthorizationStatsResponse {
  decisions: AuthorizationDecisionStats | null;
  persistence: boolean;
  window: string;
}

export interface AuthorizationMetricsRange {
  end?: string;
  label: string;
  seconds: number;
  start?: string;
}

export interface UseAuthorizationMetricsReturn {
  data: AuthorizationStatsResponse | null;
  error: string | null;
  lastUpdatedAt: number | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useAuthorizationMetrics(
  range: AuthorizationMetricsRange,
  options?: { enabled?: boolean; refreshInterval?: number },
): UseAuthorizationMetricsReturn {
  const { enabled = true, refreshInterval = 60_000 } = options ?? {};
  const [data, setData] = useState<AuthorizationStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);

  const fetchStats = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (range.start && range.end) {
        params.set("from", range.start);
        params.set("to", range.end);
      } else {
        params.set("rangeSeconds", String(range.seconds));
      }

      const response = await fetch(`/api/admin/authz/stats?${params}`, {
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);

      if (
        !mountedRef.current
        || controller.signal.aborted
        || requestVersionRef.current !== requestVersion
      ) return;

      if (!response.ok || !body) {
        throw new Error(body?.error || `Authorization metrics failed (${response.status})`);
      }

      setData(body as AuthorizationStatsResponse);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (
        mountedRef.current
        && !controller.signal.aborted
        && requestVersionRef.current === requestVersion
      ) {
        setError(getErrorMessage(err, "") || "Failed to load authorization metrics");
      }
    } finally {
      if (
        mountedRef.current
        && !controller.signal.aborted
        && requestVersionRef.current === requestVersion
      ) {
        setLoading(false);
      }
    }
  }, [enabled, range.end, range.seconds, range.start]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (!enabled || refreshInterval <= 0) return;
    const interval = window.setInterval(() => void fetchStats(), refreshInterval);
    return () => window.clearInterval(interval);
  }, [enabled, fetchStats, refreshInterval]);

  return { data, error, lastUpdatedAt, loading, refetch: fetchStats };
}
