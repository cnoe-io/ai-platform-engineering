"use client";

import { useSession } from "next-auth/react";
import React from "react";

interface PublicationApprovalSummary {
  pending_count: number;
  can_approve: boolean;
  can_manage_settings: boolean;
}

const EMPTY_SUMMARY: PublicationApprovalSummary = {
  pending_count: 0,
  can_approve: false,
  can_manage_settings: false,
};

export function usePublicationApprovalSummary(): PublicationApprovalSummary {
  const { status } = useSession();
  const [summary, setSummary] = React.useState(EMPTY_SUMMARY);

  React.useEffect(() => {
    if (status !== "authenticated") {
      setSummary(EMPTY_SUMMARY);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/publication-requests/summary", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Approval summary returned ${response.status}`);
        const body = await response.json() as {
          data?: PublicationApprovalSummary;
        } & Partial<PublicationApprovalSummary>;
        const nextSummary = body.data ?? {
          pending_count: body.pending_count ?? 0,
          can_approve: body.can_approve ?? false,
          can_manage_settings: body.can_manage_settings ?? false,
        };
        if (!cancelled) setSummary(nextSummary);
      } catch {
        if (!cancelled) setSummary(EMPTY_SUMMARY);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [status]);

  return summary;
}
