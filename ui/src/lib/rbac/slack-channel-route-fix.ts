// assisted-by Codex Codex-sonnet-4-6
import type { ItemAgentRoute,RouteListenMode } from "@/components/admin/rebac/connector-admin-adapter";

type SlackRouteDiagnostic = {
  agent_id: string;
  openfga_tuple: boolean;
  route_metadata: boolean;
};

function listenMode(route: ItemAgentRoute): RouteListenMode {
  return route.users?.listen ?? "mention";
}

function matchesMode(listen: RouteListenMode, mode: "mention" | "message"): boolean {
  return listen === "all" || listen === mode;
}

function defaultRouteForAgent(agentId: string): ItemAgentRoute {
  return {
    agent_id: agentId,
    enabled: true,
    priority: 100,
    users: { enabled: true, listen: "mention" },
  };
}

/** Merge diagnostics with saved routes and apply safe automatic fixes. */
export function planSlackRouteFixes(
  diagnosticsRoutes: SlackRouteDiagnostic[],
  existingRoutes: ItemAgentRoute[],
  primaryAgentId?: string,
): ItemAgentRoute[] {
  const byAgent = new Map<string, ItemAgentRoute>();
  for (const route of existingRoutes) {
    byAgent.set(route.agent_id, { ...route });
  }

  for (const diagnostic of diagnosticsRoutes) {
    if (diagnostic.openfga_tuple && !diagnostic.route_metadata) {
      byAgent.set(diagnostic.agent_id, defaultRouteForAgent(diagnostic.agent_id));
    }
  }

  const activeRoutes = diagnosticsRoutes
    .filter((route) => route.openfga_tuple)
    .map((route) => {
      const saved = byAgent.get(route.agent_id);
      if (saved) return saved;
      return defaultRouteForAgent(route.agent_id);
    });

  for (const mode of ["mention", "message"] as const) {
    const groups = new Map<number, ItemAgentRoute[]>();
    for (const route of activeRoutes) {
      if (!matchesMode(listenMode(route), mode)) continue;
      const priority = route.priority ?? 100;
      const bucket = groups.get(priority) ?? [];
      bucket.push(route);
      groups.set(priority, bucket);
    }

    for (const [priority, group] of groups) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.agent_id.localeCompare(b.agent_id));
      const winner =
        (primaryAgentId && group.some((route) => route.agent_id === primaryAgentId)
          ? group.find((route) => route.agent_id === primaryAgentId)
          : sorted[0]) ?? sorted[0];
      if (!winner) continue;

      let bump = 10;
      for (const route of group) {
        if (route.agent_id === winner.agent_id) {
          byAgent.set(route.agent_id, { ...route, priority });
          continue;
        }
        byAgent.set(route.agent_id, { ...route, priority: priority + bump });
        bump += 10;
      }
    }
  }

  return Array.from(byAgent.values()).sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.agent_id.localeCompare(b.agent_id),
  );
}

export function slackRouteFixesNeeded(
  diagnosticsRoutes: SlackRouteDiagnostic[],
  existingRoutes: ItemAgentRoute[],
): boolean {
  const hasMissingMetadata = diagnosticsRoutes.some(
    (route) => route.openfga_tuple && !route.route_metadata,
  );
  if (hasMissingMetadata) return true;

  const planned = planSlackRouteFixes(diagnosticsRoutes, existingRoutes);
  if (planned.length !== existingRoutes.length) return true;
  return JSON.stringify(planned) !== JSON.stringify(
    [...existingRoutes].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.agent_id.localeCompare(b.agent_id),
    ),
  );
}
