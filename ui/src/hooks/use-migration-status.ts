"use client";

// assisted-by Codex GPT-5.5

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export interface MigrationStatusSummary {
  release: string;
  pending_required_count: number;
  blocking_required_count: number;
  is_blocking: boolean;
  override_active: boolean;
}

export function useMigrationStatus() {
  const { status: sessionStatus } = useSession();
  const [status, setStatus] = useState<MigrationStatusSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      setStatus(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    fetch("/api/rbac/migration-status")
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { data?: MigrationStatusSummary };
        return body.data ?? null;
      })
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionStatus]);

  return { status, isLoading };
}
