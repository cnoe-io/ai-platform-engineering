// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";

import { getConfig } from "@/lib/config";

export interface AutonomousCapability {
  /**
   * Layer 1 eligibility -- the caller belongs to an autonomous-eligible team
   * (or is an org admin). This, not per-agent `can_schedule`, decides whether
   * the Autonomous nav entry appears: a member of an eligible team must be
   * able to reach the page before any agent has been enabled, so the page can
   * tell them to ask their team admin.
   */
  canUseAutonomous: boolean;
  loading: boolean;
}

const CLOSED: Omit<AutonomousCapability, "loading"> = {
  canUseAutonomous: false,
};

/**
 * Resolves whether the Autonomous nav entry should appear: true when the
 * caller belongs to a team an org admin marked autonomous-eligible. Fails
 * closed -- any error hides the entry rather than offering a dead page.
 */
export function useAutonomousCapability(): AutonomousCapability {
  const enabled = Boolean(getConfig("autonomousAgentsEnabled"));
  const [state, setState] = useState<Omit<AutonomousCapability, "loading">>(CLOSED);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setState(CLOSED);
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/autonomous/agents?summary=true");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { data?: { eligible?: boolean } };
        if (!cancelled) {
          setState({ canUseAutonomous: Boolean(body.data?.eligible) });
        }
      } catch {
        if (!cancelled) setState(CLOSED);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { ...state, loading };
}
