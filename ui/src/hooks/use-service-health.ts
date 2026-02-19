"use client";

import { useMemo } from "react";
import { useBatchPrometheus, type BatchQuery } from "./use-prometheus";

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
// ────────────────────────────────────────────────────────────────

const HEALTH_QUERIES: BatchQuery[] = [
  {
    id: "supervisor_up",
    query: 'up{job=~".*supervisor.*"}',
  },
  {
    id: "enabled_agents",
    query: "count(enabled_subagents == 1)",
  },
  {
    id: "supervisor_success_rate",
    query:
      'sum(agent_requests_total{status="success"}) / sum(agent_requests_total) * 100',
  },
  {
    id: "request_rate_5m",
    query: "sum(rate(agent_requests_total[5m]))",
  },
  {
    id: "agent_statuses",
    query: "enabled_subagents",
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

    // Supervisor Agent
    const supervisorResult = results.supervisor_up?.data?.result;
    if (supervisorResult && supervisorResult.length > 0) {
      const val = parseFloat(supervisorResult[0].value?.[1] || "0");
      svcList.push({
        name: "Supervisor Agent",
        status: val === 1 ? "healthy" : "down",
        detail: val === 1 ? "Running" : "Not responding",
        value: val,
      });
    } else {
      svcList.push({
        name: "Supervisor Agent",
        status: "unknown",
        detail: "No data",
      });
    }

    // Enabled Sub-agents
    const agentCountResult = results.enabled_agents?.data?.result;
    const agentCount = agentCountResult?.[0]?.value?.[1];
    if (agentCount !== undefined) {
      const n = parseInt(agentCount, 10);
      svcList.push({
        name: "Sub-agents",
        status: n > 0 ? "healthy" : "down",
        detail: `${n} agent${n !== 1 ? "s" : ""} enabled`,
        value: n,
      });
    }

    // Individual agent status
    const agentStatusResult = results.agent_statuses?.data?.result;
    if (agentStatusResult) {
      for (const m of agentStatusResult) {
        const name = m.metric.agent_name || "unknown";
        const val = parseFloat(m.value?.[1] || "0");
        svcList.push({
          name: `Agent: ${name}`,
          status: val === 1 ? "healthy" : "down",
          detail: val === 1 ? "Enabled" : "Disabled",
          value: val,
        });
      }
    }

    // Success Rate
    const successRateResult = results.supervisor_success_rate?.data?.result;
    if (successRateResult && successRateResult.length > 0) {
      const rate = parseFloat(successRateResult[0].value?.[1] || "0");
      const status: HealthStatus =
        isNaN(rate) ? "unknown" : rate >= 95 ? "healthy" : rate >= 80 ? "degraded" : "down";
      svcList.push({
        name: "Success Rate",
        status,
        detail: isNaN(rate) ? "No data" : `${rate.toFixed(1)}%`,
        value: rate,
      });
    }

    // Request Rate
    const reqRateResult = results.request_rate_5m?.data?.result;
    if (reqRateResult && reqRateResult.length > 0) {
      const rate = parseFloat(reqRateResult[0].value?.[1] || "0");
      svcList.push({
        name: "Request Rate",
        status: "healthy",
        detail: `${rate.toFixed(2)} req/s`,
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
