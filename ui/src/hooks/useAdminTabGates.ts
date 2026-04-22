"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminTabGatesMap, AdminTabKey } from "@/lib/rbac/types";

const EMPTY_GATES: AdminTabGatesMap = {
  users: false,
  teams: false,
  roles: false,
  slack: false,
  skills: false,
  feedback: false,
  nps: false,
  stats: false,
  metrics: false,
  health: false,
  audit_logs: false,
  action_audit: false,
  policy: false,
};

interface AdminTabGatesState {
  gates: AdminTabGatesMap;
  loading: boolean;
  error: string | null;
  /** Visible tab keys (convenience filter of gates with `true` values). */
  visibleTabs: AdminTabKey[];
  /** Force a re-fetch (e.g. after an admin updates a policy). */
  refresh: () => void;
}

/**
 * React hook — fetches admin tab visibility gates from the BFF
 * and exposes a `gates` map for conditional rendering (US2, FR-004).
 *
 * Gates default to `false` (fail-closed) until the BFF responds.
 * Results are cached per session and invalidated on token refresh.
 */
export function useAdminTabGates(): AdminTabGatesState {
  const { data: session, status } = useSession();
  const [gates, setGates] = useState<AdminTabGatesMap>(EMPTY_GATES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastTokenRef = useRef<string | undefined>(undefined);

  const fetchGates = useCallback(async () => {
    if (status !== "authenticated") {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rbac/admin-tab-gates");
      if (!res.ok) {
        throw new Error(`Failed to fetch tab gates: ${res.status}`);
      }
      const data = await res.json();
      if (data.gates) {
        setGates(data.gates);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setGates(EMPTY_GATES);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (status === "unauthenticated") {
      setGates(EMPTY_GATES);
      setLoading(false);
      return;
    }
    if (status !== "authenticated") {
      return;
    }

    // NextAuth may omit accessToken on the client session; still load gates using a stable key.
    const token = (session as { accessToken?: string; user?: { email?: string | null } } | null)
      ?.accessToken;
    const stableKey =
      token ?? `session:${(session as { user?: { email?: string | null } } | null)?.user?.email ?? ""}`;
    if (stableKey !== lastTokenRef.current) {
      lastTokenRef.current = stableKey;
      fetchGates();
    }
  }, [session, status, fetchGates]);

  const visibleTabs = (Object.entries(gates) as [AdminTabKey, boolean][])
    .filter(([, v]) => v)
    .map(([k]) => k);

  return { gates, loading, error, visibleTabs, refresh: fetchGates };
}
