"use client";

import { useMemo } from "react";
import { useBatchPrometheus,type BatchQuery } from "./use-prometheus";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  detail: string;
  value?: number;
}

export interface UseServiceHealthReturn {
  services: ServiceHealth[];
  overall: HealthStatus;
  loading: boolean;
  error: string | null;
  configured: boolean;
  refetch: () => void;
}

// ────────────────────────────────────────────────────────────────
// Queries
//
// Health is derived from the `da_*` metrics emitted by the Dynamic Agents
// service.
// `da_up` matches the dynamic-agents scrape target by service name.
// ────────────────────────────────────────────────────────────────

const HEALTH_QUERIES: BatchQuery[] = [
  {
    id: "da_up",
    query: 'up{job=~".*dynamic.*"}',
  },
  {
    id: "turn_success_rate",
    query:
      'sum(da_turns_total{status="success"}) / sum(da_turns_total) * 100',
  },
  {
    id: "turn_rate_5m",
    query: "sum(rate(da_turns_total[5m]))",
  },
  {
    id: "agent_turns",
    query: "sum by (agent_name) (da_turns_total)",
  },
];

// ────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────

export function useServiceHealth(
  options?: { refreshInterval?: number; enabled?: boolean },
): UseServiceHealthReturn {
  const { refreshInterval = 30_000, enabled = true } = options || {};

  const { results, loading, error, refetch, configured } = useBatchPrometheus(
    HEALTH_QUERIES,
    { refreshInterval, enabled },
  );

  const { services, overall } = useMemo(() => {
    if (!results) {
      return {
        services: [] as ServiceHealth[],
        overall: "unknown" as HealthStatus,
      };
    }

    const svcList: ServiceHealth[] = [];

    // Dynamic Agents service (scrape target up/down)
    const upResult = results.da_up?.data?.result;
    if (upResult && upResult.length > 0) {
      // A target is healthy when at least one instance reports up=1.
      const anyUp = upResult.some((m) => parseFloat(m.value?.[1] || "0") === 1);
      svcList.push({
        name: "Dynamic Agents",
        status: anyUp ? "healthy" : "down",
        detail: anyUp ? "Running" : "Not responding",
        value: anyUp ? 1 : 0,
      });
    } else {
      svcList.push({
        name: "Dynamic Agents",
        status: "unknown",
        detail: "No data",
      });
    }

    // Per-agent activity — agents that have handled at least one turn.
    const agentTurnsResult = results.agent_turns?.data?.result;
    if (agentTurnsResult) {
      const activeAgents = agentTurnsResult.filter(
        (m) => parseFloat(m.value?.[1] || "0") > 0,
      );
      svcList.push({
        name: "Active Agents",
        status: activeAgents.length > 0 ? "healthy" : "unknown",
        detail: `${activeAgents.length} agent${activeAgents.length !== 1 ? "s" : ""} active`,
        value: activeAgents.length,
      });

      for (const m of agentTurnsResult) {
        const name = m.metric.agent_name || "unknown";
        const turns = parseFloat(m.value?.[1] || "0");
        svcList.push({
          name: `Agent: ${name}`,
          status: turns > 0 ? "healthy" : "unknown",
          detail: `${turns.toLocaleString()} turn${turns !== 1 ? "s" : ""}`,
          value: turns,
        });
      }
    }

    // Turn success rate
    const successRateResult = results.turn_success_rate?.data?.result;
    if (successRateResult && successRateResult.length > 0) {
      const rate = parseFloat(successRateResult[0].value?.[1] || "0");
      const status: HealthStatus =
        isNaN(rate) ? "unknown" : rate >= 95 ? "healthy" : rate >= 80 ? "degraded" : "down";
      svcList.push({
        name: "Turn Success Rate",
        status,
        detail: isNaN(rate) ? "No data" : `${rate.toFixed(1)}%`,
        value: rate,
      });
    }

    // Turn rate
    const turnRateResult = results.turn_rate_5m?.data?.result;
    if (turnRateResult && turnRateResult.length > 0) {
      const rate = parseFloat(turnRateResult[0].value?.[1] || "0");
      svcList.push({
        name: "Turn Rate",
        status: "healthy",
        detail: `${rate.toFixed(2)} turns/s`,
        value: rate,
      });
    }

    // Compute overall
    const statuses = svcList.map((s) => s.status);
    let computedOverall: HealthStatus = "healthy";
    if (statuses.includes("down")) computedOverall = "down";
    else if (statuses.includes("degraded")) computedOverall = "degraded";
    else if (statuses.every((s) => s === "unknown")) computedOverall = "unknown";

    return { services: svcList, overall: computedOverall };
  }, [results]);

  return { services, overall, loading, error, configured, refetch };
}
