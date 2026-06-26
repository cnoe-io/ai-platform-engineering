"use client";

import { HelpCircle } from "lucide-react";

import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectorAdminPanel } from "./ConnectorAdminPanel";
import type {
ConnectorAdminAdapter,
DiagnosticRoute,
ItemAgentRoute,
ItemDiagnostics,
ItemSummary,
} from "./connector-admin-adapter";

function WebexAccessNote() {
  return (
    <div className="flex max-w-4xl items-start gap-2 rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm text-muted-foreground">
      <span>
        Members of the assigned team can manage this Webex space&apos;s bot routing. The space and the
        assigned team must both be allowed to use an agent before the bot will call it.
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Webex access details"
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-md whitespace-normal break-words text-xs">
          <div className="space-y-2">
            <p>
              Team assignment controls who can manage this space&apos;s integration. Before dispatch,
              the Webex bot checks that the space has <code className="mx-0.5">can_use agent:&lt;id&gt;</code>{" "}
              and the user&apos;s active team has the same permission.
            </p>
            <p>
              Adding an agent to a team-assigned space grants every member of that team permission to
              invoke the agent in the space, even if they were never granted the agent directly.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function threadContextLabel(raw: Record<string, unknown>): string {
  const ctx = raw.thread_context as { enabled?: boolean; max_messages?: number; max_chars?: number } | undefined;
  if (!ctx) return "unknown";
  return `${ctx.enabled ? "Enabled" : "Disabled"}, ${ctx.max_messages} messages / ${ctx.max_chars} chars`;
}

async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `${fallback}: ${res.status}`;
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
    const detail = typeof payload.error === "string" ? payload.error
      : typeof payload.message === "string" ? payload.message : "";
    return detail ? `${fallback}: ${detail}` : `${fallback}: ${res.status}`;
  } catch { return `${fallback}: ${text}`; }
}

const WEBEX_ADAPTER: ConnectorAdminAdapter = {
  connectorName: "Webex",
  itemSingular: "space",
  itemPlural: "spaces",

  api: {
    list: "/api/admin/webex/spaces",
    discoveryUrl: (_page, cursor, q) => {
      const p = new URLSearchParams({ limit: "200" });
      if (cursor) p.set("cursor", cursor);
      if (q) p.set("q", q);
      return `/api/admin/webex/available-spaces?${p.toString()}`;
    },
    defaults: "/api/admin/webex/spaces/defaults",
    runtimeStatus: "/api/admin/webex/runtime/status",
    runtimeReload: "/api/admin/webex/runtime/reload",
    runtimeSyncFromConfig: "/api/admin/webex/runtime/sync-from-config",
    routesFor: (ws, sp) => `/api/admin/webex/spaces/${encodeURIComponent(ws)}/${encodeURIComponent(sp)}/routes`,
    diagnosticsFor: (ws, sp) => `/api/admin/webex/spaces/${encodeURIComponent(ws)}/${encodeURIComponent(sp)}/diagnostics`,
    legacyConfigDefaults: null,
  },

  parseListResponse: (json) => {
    const d = apiData<{ spaces: unknown[] }>(json as { spaces: unknown[] });
    return (d.spaces ?? []) as Record<string, unknown>[];
  },
  parseListItem: (raw) => {
    const r = raw as Record<string, unknown>;
    if (!r.space_id) return null;
    return {
      workspace_id: String(r.workspace_id ?? ""),
      item_id: String(r.space_id),
      item_name: String(r.space_name ?? r.space_id),
      team_slug: r.team_slug ? String(r.team_slug) : undefined,
      primary_agent_id: r.primary_agent_id ? String(r.primary_agent_id) : undefined,
      active_grants: Number(r.active_grants ?? 0),
      can_manage: Boolean(r.can_manage),
      health: r.health as ItemSummary["health"],
    };
  },
  itemKey: (item) => `${item.workspace_id}/${item.item_id}`,
  parseDiscoveryPage: (json) => {
    const d = apiData<{ spaces: unknown[]; next_cursor?: string | null; has_more?: boolean; total_matches?: number }>(
      json as { spaces: unknown[] },
    );
    const spaces = (d.spaces ?? []) as Record<string, unknown>[];
    return {
      items: spaces.map((sp) => ({
        id: String(sp.id ?? ""),
        name: String(sp.name ?? sp.id),
        secondary: [String(sp.id ?? ""), sp.type, sp.is_locked ? "locked" : ""].filter(Boolean).join(" · "),
      })),
      nextCursor: d.next_cursor ?? null,
      hasMore: Boolean(d.has_more),
      totalMatches: typeof d.total_matches === "number" ? d.total_matches : undefined,
    };
  },
  parseRuntimeStatus: (json) => {
    const d = json as Record<string, unknown>;
    const sc = (d.static_config ?? {}) as Record<string, number>;
    const rc = (d.route_cache ?? {}) as Record<string, unknown>;
    return {
      route_mode: String(d.route_mode ?? "unknown"),
      static_config: sc,
      route_cache: { ttl_seconds: Number(rc.ttl_seconds ?? 0), cache_size: Number(rc.cache_size ?? 0) },
      raw: d,
    };
  },
  parseRuntimeSyncSummary: (json) => {
    const d = json as Record<string, unknown>;
    return {
      dry_run: Boolean(d.dry_run),
      items_seen: Number(d.spaces_seen ?? 0),
      routes_planned: Number(d.routes_planned ?? 0),
      routes_upserted: Number(d.routes_upserted ?? 0),
      openfga_tuples_written: Number(d.openfga_tuples_written ?? 0),
    };
  },

  discoveryCacheProvider: "webex",

  copy: {
    configuredTabTitle: "Configured spaces",
    configuredTabDescription: "Spaces CAIPE already knows about. Click a space to manage its agents and diagnostics.",
    onboardTabTitle: "Onboard spaces",
    onboardTabDescription: "Find Webex spaces where the bot is installed and set them up.",
    advancedTabTitle: "Advanced",
    advancedTabDescription: "One-time YAML import and Webex bot runtime status. Most admins won't need this.",
    advancedHeading: "Advanced Setup - Import/Sync with Webex Bot",
    botNameInLegend: "Webex bot",
    discoveryDescription: "Find Webex spaces where the bot is already installed. Spaces the bot has not joined will not appear.",
    discoveryFindLabel: "Find spaces",
    discoveryRefreshLabel: "Refresh spaces",
    discoveryLoadingLabel: "Finding spaces…",
    discoveryEmptyLabel: "No bot-visible Webex spaces were discovered.",
    discoveryDiscoveredLabel: "bot-visible space",
    advancedSectionDescription: "Preview Webex bot YAML seed data before importing space routes and agent settings into the database.",
    selfServiceTitle: "My Webex Space Settings",
    selfServiceDescription: "Manage bot routing behavior only for Webex spaces where OpenFGA grants you space admin access.",
  },
  ariaLabels: {
    tablist: "Webex admin views",
    configuredRegion: "Configured Webex spaces",
    advancedRegion: "Advanced Setup - Import/Sync with Webex Bot",
  },

  discoveryStatusText: ({ discoveredCount, newCount, configuredCount, unassignedCount }) =>
    discoveredCount > 0
      ? `${discoveredCount} bot-visible found · ${newCount} new · ${configuredCount} in CAIPE · ${unassignedCount} missing team`
      : `${configuredCount} in CAIPE · ${unassignedCount} missing team`,

  staticConfigLabel: ({ items, routes }) => `${items} spaces / ${routes} routes`,
  routeCacheLabel: (count) => `${count} cached space${count === 1 ? "" : "s"}`,
  syncDialogueTitle: (mode) => mode === "preview" ? "Webex Bot Config Sync Preview" : "Webex Bot Config Sync Apply",
  syncDialogueDescription: "Preview reads the Webex bot's loaded static YAML config. Apply upserts matching MongoDB route metadata and space-agent OpenFGA tuples without deleting UI-managed associations.",
  syncSummaryItemsLabel: "Spaces",

  advancedExtraTiles: (status) => [
    {
      label: "Thread context",
      value: threadContextLabel(status.raw),
      description: "Shows whether the bot sends bounded prior Webex thread messages to the selected agent.",
    },
  ],

  authzDisclaimer: (
    <>
      <div>
        The Webex bot checks that the space has
        <code className="mx-1">can_use agent:&lt;id&gt;</code> (a space→agent grant).
        User-level <code className="mx-1">can_use</code> on the agent is enforced when
        the conversation is created — any user with agent access can use it in spaces
        where that agent is assigned.
      </div>
      <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
        <span className="font-medium">Sharing model:</span> Assigning an agent to a
        space exposes it to users who message in that space. Grant agent access to
        individual users or teams separately; space assignment alone does not
        substitute for user <code className="mx-1">can_use</code> permission.
      </div>
    </>
  ),

  diagnosticRouteIsFixable: (route: DiagnosticRoute) =>
    (route.route_metadata && !route.openfga_tuple) ||
    (route.openfga_tuple && route.listen !== "all"),

  fixDiagnosticRoute: async ({ item, route, routes }) => {
    const routeUrl = `/api/admin/webex/spaces/${encodeURIComponent(item.workspace_id)}/${encodeURIComponent(item.item_id)}/routes`;
    if (route.route_metadata && !route.openfga_tuple) {
      const res = await fetch(routeUrl, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: route.agent_id }),
      });
      if (!res.ok) throw new Error(await responseErrorMessage(res, `Failed to fix agent:${route.agent_id}`));
      return { toast: `Removed stale route metadata for agent:${route.agent_id}.` };
    }
    const currentRoute = routes.find((r) => r.agent_id === route.agent_id);
    const nextRoutes: ItemAgentRoute[] = [
      ...routes.filter((r) => r.agent_id !== route.agent_id),
      { agent_id: route.agent_id, enabled: true, priority: currentRoute?.priority ?? 100, users: { enabled: true, listen: "all" } },
    ];
    const res = await fetch(routeUrl, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routes: nextRoutes }),
    });
    if (!res.ok) throw new Error(await responseErrorMessage(res, `Failed to fix agent:${route.agent_id}`));
    const data = apiData<{ routes: ItemAgentRoute[] }>(await res.json());
    return {
      toast: `Updated agent:${route.agent_id} to listen to mentions and plain messages.`,
      nextRoutes: data.routes ?? [],
    };
  },

  applyOnboarding: async ({ rows, defaultTeamSlug, defaultAgentId, createDefaultRoutes, fetchFn }) => {
    const selectedImports = rows.filter((r) => r.selected && r.teamSlug && r.agentId);
    if (selectedImports.length === 0) return { toastMessage: "No spaces selected." };
    const grouped = new Map<string, Array<{ id: string; name?: string }>>();
    for (const sp of selectedImports) {
      const key = `${sp.teamSlug} ${sp.agentId}`;
      const cur = grouped.get(key) ?? [];
      cur.push({ id: sp.id, name: sp.name });
      grouped.set(key, cur);
    }
    const requests = Array.from(grouped.entries()).map(([key, spacesForGroup]) => {
      const [teamSlug, agentId] = key.split(" ");
      return { team_slug: teamSlug ?? defaultTeamSlug, agent_id: agentId ?? defaultAgentId, create_routes: createDefaultRoutes, manual_spaces: spacesForGroup };
    });
    const results = await Promise.all(requests.map(async (body) => {
      const res = await fetchFn("/api/admin/webex/spaces/defaults", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      return apiData<{ summary: Record<string, number> }>(await res.json());
    }));
    const s = results.reduce<Record<string, number>>((acc, r) => {
      for (const [k, v] of Object.entries(r.summary)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {});
    return {
      toastMessage: `Discovered Webex spaces applied: onboarded ${s.spaces_onboarded ?? 0} spaces, assigned ${s.spaces_assigned_team ?? 0} spaces, ensured ${s.space_grants_ensured ?? 0} space grants, ensured ${s.routes_ensured ?? 0} routes, preserved ${s.routes_preserved ?? 0} existing routes.`,
    };
  },

  discoveryAutoSelectNewItems: true,
  discoveryPaginated: true,
  discoveryServerSearch: true,

  missingRouteableAgentAutoFix: {
    title: "Auto-fix missing Webex association",
    description: "Create an OpenFGA-backed route with listen mode all so the Webex runtime has an agent to dispatch.",
    buttonLabel: (agentId) => agentId ? `Fix missing association with agent:${agentId}` : "Select an agent to auto-fix",
    noAgentHelpText: "Select a Dynamic Agent below or configure a default Dynamic Agent first.",
    isApplicable: (_item: ItemSummary, diagnostics: ItemDiagnostics) =>
      Boolean(diagnostics?.openfga.reachable && diagnostics.openfga.tuple_count === 0 && diagnostics.routes.length === 0),
  },
};

export function WebexSpaceRebacPanel({
  disabled = false,
  selfService = false,
}: {
  disabled?: boolean;
  selfService?: boolean;
}) {
  return <ConnectorAdminPanel adapter={WEBEX_ADAPTER} disabled={disabled} selfService={selfService} />;
}
