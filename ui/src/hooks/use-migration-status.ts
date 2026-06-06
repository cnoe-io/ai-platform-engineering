"use client";

// assisted-by Cursor Composer

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export interface MigrationStatusSummary {
  release: string;
  pending_required_count: number;
  blocking_required_count: number;
  version_bootstrap_required_count?: number;
  version_bootstrap_schema_areas?: string[];
  needs_version_bootstrap?: boolean;
  requires_attention?: boolean;
  is_blocking: boolean;
  override_active: boolean;
}

/** Dispatched after the Migrations tab refreshes so the header alert pill stays in sync. */
export const MIGRATION_STATUS_REFRESH_EVENT = "caipe:migration-status-refresh";

export function refreshMigrationStatus(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MIGRATION_STATUS_REFRESH_EVENT));
  }
}

export function useMigrationStatus() {
  const { status: sessionStatus } = useSession();
  const [status, setStatus] = useState<MigrationStatusSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async (cancelled: () => boolean) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/rbac/migration-status");
      if (!response.ok) {
        if (!cancelled()) setStatus(null);
        return;
      }
      const body = (await response.json()) as { data?: MigrationStatusSummary };
      if (!cancelled()) setStatus(body.data ?? null);
    } catch {
      if (!cancelled()) setStatus(null);
    } finally {
      if (!cancelled()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      setStatus(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    const refresh = () => {
      void load(isCancelled);
    };

    refresh();
    const intervalId = window.setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    const onMigrationRefresh = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(MIGRATION_STATUS_REFRESH_EVENT, onMigrationRefresh);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(MIGRATION_STATUS_REFRESH_EVENT, onMigrationRefresh);
    };
  }, [sessionStatus, load]);

  return { status, isLoading };
}
