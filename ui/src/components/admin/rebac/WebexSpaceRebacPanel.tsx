"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { AdminSimulationQueryTarget } from "@/lib/rbac/admin-simulation-query";
import { withAdminSimulationParams } from "@/lib/rbac/admin-simulation-query";
import { ConnectorAdminPanel } from "./ConnectorAdminPanel";
import { WebexDirectUsersPanel } from "./WebexDirectUsersPanel";
import { WebexBotMigrationPanel } from "./WebexBotMigrationPanel";
import type {
ConnectorAdminAdapter,
DiagnosticRoute,
ItemAgentRoute,
ItemDiagnostics,
ItemSummary,
} from "./connector-admin-adapter";

function WebexConfiguredSpaceDelete({
  item,
  routeCount,
  disabled,
  loading,
  selectedCanManage,
  setLoading,
  onRefresh,
  onDeselect,
}: {
  item: ItemSummary;
  routeCount: number;
  disabled: boolean;
  loading: boolean;
  selectedCanManage: boolean;
  setLoading: (loading: boolean) => void;
  onRefresh: () => Promise<void> | void;
  onDeselect: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const label = item.item_name || item.item_id;

  const deleteSpace = async () => {
    setLoading(true);
    try {
      const url = `/api/admin/webex/spaces/${encodeURIComponent(item.workspace_id)}/${encodeURIComponent(item.item_id)}`;
      const params = new URLSearchParams({ bot_id: item.bot_id ?? "" });
      const res = await fetch(`${url}?${params.toString()}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, "Failed to delete Webex space"));
      }
      setOpen(false);
      onDeselect();
      toast(`Removed ${label} from CAIPE.`, "success");
      await onRefresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to delete Webex space", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-destructive">Danger zone</div>
          <p className="text-sm text-muted-foreground">
            Remove this space&apos;s team assignment, agent routes, grants, and OpenFGA relationships.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={disabled || !selectedCanManage || loading}
          aria-label={`Delete space ${label}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete space
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(nextOpen) => { if (!loading) setOpen(nextOpen); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete space from CAIPE?</DialogTitle>
            <DialogDescription>
              This permanently removes everything CAIPE stores for {label}. It does not remove the bot from Webex.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>The following are deleted:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{item.team_slug ? `The team:${item.team_slug} assignment.` : "Any saved team assignment."}</li>
              <li>{routeCount > 0 ? `${routeCount} agent route${routeCount === 1 ? "" : "s"}.` : "All agent routes."}</li>
              <li>All saved grants and OpenFGA relationships for this space.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void deleteSpace()} disabled={loading}>
              {loading ? "Deleting..." : "Delete space"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  singlePanelView: "onboard",
  directMessagesPanel: {
    title: "1:1 Messages",
    description: "Configure who can message each Webex bot and how their agent is selected.",
    render: ({ disabled }) => <WebexDirectUsersPanel disabled={disabled} />,
  },
  migrationPanel: {
    title: "Legacy migration",
    description: "Assign pre-multi-bot Webex spaces to an explicit bot.",
    render: ({ disabled }) => <WebexBotMigrationPanel disabled={disabled} />,
  },

  api: {
    list: "/api/admin/webex/spaces",
    discoveryUrl: (_page, cursor, q, identityId, refresh) => {
      const p = new URLSearchParams({ limit: "200" });
      if (cursor) p.set("cursor", cursor);
      if (q) p.set("q", q);
      if (identityId) p.set("bot_id", identityId);
      if (refresh) p.set("refresh", "1");
      return `/api/admin/webex/available-spaces?${p.toString()}`;
    },
    discoveryIdentities: "/api/admin/webex/bots",
    defaults: "/api/admin/webex/spaces/defaults",
    runtimeStatus: "/api/admin/webex/runtime/status",
    runtimeReload: "/api/admin/webex/runtime/reload",
    runtimeSyncFromConfig: "/api/admin/webex/runtime/sync-from-config",
    runtimeSyncUsesDiscoveryIdentity: true,
    routesFor: (ws, sp, botId) => `/api/admin/webex/spaces/${encodeURIComponent(ws)}/${encodeURIComponent(sp)}/routes?bot_id=${encodeURIComponent(botId ?? "")}`,
    diagnosticsFor: (ws, sp, botId) => `/api/admin/webex/spaces/${encodeURIComponent(ws)}/${encodeURIComponent(sp)}/diagnostics?bot_id=${encodeURIComponent(botId ?? "")}`,
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
      bot_id: r.bot_id ? String(r.bot_id) : undefined,
      active_grants: Number(r.active_grants ?? 0),
      can_manage: Boolean(r.can_manage),
      health: r.health as ItemSummary["health"],
    };
  },
  itemKey: (item) => `${item.bot_id ?? ""}/${item.workspace_id}/${item.item_id}`,
  parseDiscoveryPage: (json) => {
    const d = apiData<{ spaces: unknown[]; next_cursor?: string | null; has_more?: boolean; total_matches?: number }>(
      json as { spaces: unknown[] },
    );
    const spaces = ((d.spaces ?? []) as Record<string, unknown>[]).filter(
      (space) => String(space.type ?? "group").trim().toLowerCase() !== "direct",
    );
    return {
      items: spaces.map((sp) => {
        const type = String(sp.type ?? "group").trim().toLowerCase() || "group";
        return {
          id: String(sp.id ?? ""),
          name: String(sp.name ?? sp.id),
          secondary: [String(sp.id ?? ""), type, sp.is_locked ? "locked" : ""].filter(Boolean).join(" · "),
          teamRequired: true,
          selectable: true,
          availableBotIds: Array.isArray(sp.available_bot_ids)
            ? sp.available_bot_ids.map((id) => String(id)).filter(Boolean)
            : [],
          botId: Array.isArray(sp.available_bot_ids) && sp.available_bot_ids.length === 1
            ? String(sp.available_bot_ids[0])
            : undefined,
        };
      }),
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
  discoveryIdentity: {
    label: "Webex bot",
    parseResponse: (json) => {
      const data = apiData<{ bots?: Array<{ id?: unknown; name?: unknown; available?: unknown }> }>(
        json as { bots?: Array<{ id?: unknown; name?: unknown; available?: unknown }> },
      );
      return (data.bots ?? [])
        .map((bot) => ({
          id: String(bot.id ?? "").trim(),
          name: String(bot.name ?? bot.id ?? "").trim(),
          available: bot.available === true,
        }))
        .filter((bot) => bot.id && bot.name);
    },
  },
  discoveryIdentityPerItem: false,

  copy: {
    configuredTabTitle: "Configured spaces",
    configuredTabDescription: "Spaces CAIPE already knows about. Click a space to manage its agents and diagnostics.",
    onboardTabTitle: "Configure spaces",
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

  discoveryStatusText: ({ discoveredCount, newCount, configuredCount, unassignedCount }) => [
    `Discovered: ${discoveredCount}`,
    `Configured: ${configuredCount}`,
    ...(newCount > 0 ? [`New: ${newCount}`] : []),
    ...(unassignedCount > 0 ? [`Missing team: ${unassignedCount}`] : []),
  ].join(" · "),

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
        The Webex bot checks that its installation in the space has
        <code className="mx-1">can_use agent:&lt;id&gt;</code> (a bot-scoped route grant).
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

  configuredDetailExtra: (ctx) => (
    <WebexConfiguredSpaceDelete
      item={ctx.item}
      routeCount={ctx.routes.length}
      disabled={ctx.disabled}
      loading={ctx.loading}
      selectedCanManage={ctx.selectedCanManage}
      setLoading={ctx.setLoading}
      onRefresh={ctx.onRefresh}
      onDeselect={ctx.onDeselect}
    />
  ),

  diagnosticRouteIsFixable: (route: DiagnosticRoute) =>
    (route.route_metadata && !route.openfga_tuple) ||
    (route.openfga_tuple && route.listen !== "all"),

  fixDiagnosticRoute: async ({ item, route, routes }) => {
    const routeUrl = `/api/admin/webex/spaces/${encodeURIComponent(item.workspace_id)}/${encodeURIComponent(item.item_id)}/routes?bot_id=${encodeURIComponent(item.bot_id ?? "")}`;
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
    const selectedImports = rows.filter((r) =>
      r.selectable !== false &&
      r.teamRequired !== false &&
      r.selected &&
      r.teamSlug &&
      r.agentId &&
      r.botId
    );
    if (selectedImports.length === 0) return { toastMessage: "No spaces selected." };
    const grouped = new Map<string, Array<{ id: string; name?: string; bot_id: string }>>();
    for (const sp of selectedImports) {
      const key = `${sp.teamSlug} ${sp.agentId}`;
      const cur = grouped.get(key) ?? [];
      cur.push({ id: sp.id, name: sp.name, bot_id: sp.botId! });
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
  simulationTarget = null,
}: {
  disabled?: boolean;
  selfService?: boolean;
  simulationTarget?: AdminSimulationQueryTarget | null;
}) {
  const adapter = useMemo<ConnectorAdminAdapter>(
    () => ({
      ...WEBEX_ADAPTER,
      api: {
        ...WEBEX_ADAPTER.api,
        list: withAdminSimulationParams(WEBEX_ADAPTER.api.list, simulationTarget),
      },
    }),
    [simulationTarget],
  );
  return <ConnectorAdminPanel adapter={adapter} disabled={disabled} selfService={selfService} />;
}
