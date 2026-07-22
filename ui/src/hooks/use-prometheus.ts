"use client";

import { getErrorMessage } from "@/lib/error-utils";

import { useCallback,useEffect,useRef,useState } from "react";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface PrometheusMetric {
  metric: Record<string, string>;
  value?: [number, string]; // instant: [timestamp, value]
  values?: [number, string][]; // range: [[ts, val], ...]
}

export interface PrometheusResult {
  status: "success" | "error";
  data?: {
    resultType: "vector" | "matrix" | "scalar" | "string";
    result: PrometheusMetric[];
  };
  error?: string;
  errorType?: string;
}

export interface UsePrometheusOptions {
  /** PromQL expression */
  query: string;
  /** "instant" (default) or "range" */
  type?: "instant" | "range";
  /** Range start — unix epoch seconds or RFC3339 */
  start?: string | number;
  /** Range end — unix epoch seconds or RFC3339 */
  end?: string | number;
  /** Step for range queries (default "60s") */
  step?: string;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
  /** Skip fetching when true */
  enabled?: boolean;
}

export interface UsePrometheusReturn {
  data: PrometheusMetric[] | null;
  resultType: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Whether Prometheus is configured on the backend */
  configured: boolean;
}

// ────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────

export function usePrometheusQuery(options: UsePrometheusOptions): UsePrometheusReturn {
  const {
    query,
    type = "instant",
    start,
    end,
    step = "60s",
    refreshInterval = 0,
    enabled = true,
  } = options;

  const [data, setData] = useState<PrometheusMetric[] | null>(null);
  const [resultType, setResultType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const mountedRef = useRef(true);

  const fetchMetrics = useCallback(async () => {
    if (!query || !enabled) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ query, type });
      if (type === "range") {
        if (start) params.set("start", String(start));
        if (end) params.set("end", String(end));
        params.set("step", step);
      }

      const res = await fetch(`/api/admin/metrics?${params}`);
      const json = await res.json();

      if (!mountedRef.current) return;

      if (!json.success) {
        if (json.code === "PROMETHEUS_NOT_CONFIGURED") {
          setConfigured(false);
          setError("Prometheus not configured");
        } else {
          setError(json.error || "Query failed");
        }
        return;
      }

      const promResult: PrometheusResult = json.data;
      if (promResult.status === "success" && promResult.data) {
        setData(promResult.data.result);
        setResultType(promResult.data.resultType);
      } else {
        setError(promResult.error || "Unknown Prometheus error");
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(getErrorMessage(err, "") || "Network error");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [query, type, start, end, step, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (refreshInterval <= 0 || !enabled) return;
    const id = setInterval(fetchMetrics, refreshInterval);
    return () => clearInterval(id);
  }, [fetchMetrics, refreshInterval, enabled]);

  return { data, resultType, loading, error, refetch: fetchMetrics, configured };
}

// ────────────────────────────────────────────────────────────────
// Batch hook — fetch multiple PromQL queries in one round-trip
// ────────────────────────────────────────────────────────────────

export interface BatchQuery {
  id: string;
  query: string;
  type?: "instant" | "range";
  start?: string;
  end?: string;
  /** Evaluation timestamp for historical instant queries. */
  time?: string;
  step?: string;
  /** Rolling range resolved by the server at request time. */
  rangeSeconds?: number;
}

export interface UseBatchPrometheusReturn {
  results: Record<string, PrometheusResult> | null;
  loading: boolean;
  error: string | null;
  queryErrors: Record<string, string>;
  lastUpdatedAt: number | null;
  refetch: () => Promise<void>;
  configured: boolean;
}

export function useBatchPrometheus(
  queries: BatchQuery[],
  options?: { refreshInterval?: number; enabled?: boolean },
): UseBatchPrometheusReturn {
  const { refreshInterval = 0, enabled = true } = options || {};

  const [results, setResults] = useState<Record<string, PrometheusResult> | null>(null);
  const [loading, setLoading] = useState(enabled && queries.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [queryErrors, setQueryErrors] = useState<Record<string, string>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [configured, setConfigured] = useState(true);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const queriesRef = useRef(queries);
  queriesRef.current = queries;

  const queriesKey = JSON.stringify(queries.map((query) => ({
    end: query.end,
    id: query.id,
    query: query.query,
    rangeSeconds: query.rangeSeconds,
    start: query.start,
    step: query.step,
    time: query.time,
    type: query.type,
  })));

  const fetchBatch = useCallback(async () => {
    const currentQueries = queriesRef.current;
    if (!enabled || currentQueries.length === 0 || queriesKey === "[]") {
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
    setQueryErrors({});

    try {
      const res = await fetch("/api/admin/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: currentQueries }),
        signal: controller.signal,
      });

      const json = await res.json().catch(() => null);
      if (
        !mountedRef.current
        || controller.signal.aborted
        || requestVersionRef.current !== requestVersion
      ) return;

      if (!res.ok || !json?.success) {
        if (json?.code === "PROMETHEUS_NOT_CONFIGURED") {
          setConfigured(false);
          setError("Prometheus not configured");
        } else {
          setError(json?.error || `Batch query failed (${res.status})`);
        }
        return;
      }

      setConfigured(true);
      const incoming = (json.data ?? {}) as Record<string, PrometheusResult>;
      const successful: Record<string, PrometheusResult> = {};
      const nextQueryErrors: Record<string, string> = {};
      for (const query of currentQueries) {
        const result = incoming[query.id];
        if (result?.status === "success") {
          successful[query.id] = result;
        } else {
          nextQueryErrors[query.id] = result?.error || "Prometheus query failed";
        }
      }
      setResults((current) => ({ ...(current ?? {}), ...successful }));
      setQueryErrors(nextQueryErrors);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (
        mountedRef.current
        && !controller.signal.aborted
        && requestVersionRef.current === requestVersion
      ) {
        setError(getErrorMessage(err, "") || "Network error");
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
  }, [queriesKey, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  useEffect(() => {
    if (refreshInterval <= 0 || !enabled) return;
    const id = setInterval(fetchBatch, refreshInterval);
    return () => clearInterval(id);
  }, [fetchBatch, refreshInterval, enabled]);

  return {
    results,
    loading,
    error,
    queryErrors,
    lastUpdatedAt,
    refetch: fetchBatch,
    configured,
  };
}

// ────────────────────────────────────────────────────────────────
// Helpers — extract scalar values from Prometheus responses
// ────────────────────────────────────────────────────────────────

export function getScalarValue(metrics: PrometheusMetric[] | null): number | null {
  if (!metrics || metrics.length === 0) return null;
  const raw = metrics[0].value?.[1];
  if (raw === undefined) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

export function getTimeseriesData(
  metrics: PrometheusMetric[] | null,
): Array<{ timestamp: number; value: number; labels: Record<string, string> }> {
  if (!metrics) return [];

  const points: Array<{ timestamp: number; value: number; labels: Record<string, string> }> = [];

  for (const m of metrics) {
    if (m.values) {
      for (const [ts, val] of m.values) {
        const value = Number.parseFloat(val);
        if (Number.isFinite(value)) {
          points.push({ timestamp: ts, value, labels: m.metric });
        }
      }
    } else if (m.value) {
      const value = Number.parseFloat(m.value[1]);
      if (Number.isFinite(value)) {
        points.push({
          timestamp: m.value[0],
          value,
          labels: m.metric,
        });
      }
    }
  }

  return points.sort((a, b) => a.timestamp - b.timestamp);
}

export function getLabeledValues(
  metrics: PrometheusMetric[] | null,
  labelKey: string = "agent_name",
): Array<{ label: string; value: number }> {
  if (!metrics) return [];
  return metrics
    .map((m) => ({
      label: m.metric[labelKey] || "unknown",
      value: Number.parseFloat(m.value?.[1] || "NaN"),
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => b.value - a.value);
}
