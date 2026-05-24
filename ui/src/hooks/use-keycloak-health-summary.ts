"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export interface KeycloakHealthSummary {
  configured: boolean;
  reachable: boolean;
  realm: string;
  invariants: {
    total: number;
    passing: number;
    failing: number;
    unknown: number;
    reconcile_now_recommended: boolean;
  } | null;
  has_issues: boolean;
  cached: boolean;
  fetched_at: string;
}

interface UseKeycloakHealthSummaryOptions {
  /**
   * Only poll when the caller has confirmed admin access. The summary
   * endpoint enforces the same predicate server-side, but we short-circuit
   * here so non-admin sessions don't generate a steady stream of 403s in
   * the network panel or admin audit log on every page navigation.
   */
  enabled: boolean;
  /**
   * How often to re-poll the cached summary endpoint. The server-side
   * cache is 60s; polling more frequently than that just gets cache hits.
   */
  refreshIntervalMs?: number;
}

/**
 * Admin-only hook that pings the Keycloak health summary endpoint and
 * surfaces invariant failure counts to the header alert chip. Returns
 * `null` when the session is unauthenticated, when `enabled` is false,
 * or when the endpoint rejects (e.g. RBAC denial) — callers should treat
 * `null` as "no data, render nothing" rather than "no issues".
 */
export function useKeycloakHealthSummary({
  enabled,
  refreshIntervalMs = 60_000,
}: UseKeycloakHealthSummaryOptions) {
  const { status: sessionStatus } = useSession();
  const [summary, setSummary] = useState<KeycloakHealthSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !enabled) {
      setSummary(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/admin/keycloak/migration-health/summary");
        if (!response.ok) {
          if (!cancelled) setSummary(null);
          return;
        }
        const body = (await response.json()) as { data?: KeycloakHealthSummary };
        if (!cancelled) setSummary(body.data ?? null);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    const id = window.setInterval(load, Math.max(refreshIntervalMs, 5_000));

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionStatus, enabled, refreshIntervalMs]);

  return { summary, isLoading };
}
