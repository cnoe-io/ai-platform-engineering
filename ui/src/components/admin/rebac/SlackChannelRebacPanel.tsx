"use client";

import type {
ConnectorAdminAdapter,
DiagnosticRoute,
ItemSummary,
RuntimeSyncSummary,
} from "./connector-admin-adapter";
import { ConnectorAdminPanel } from "./ConnectorAdminPanel";
import { SlackConfiguredChannelDetail } from "./slack/SlackConfiguredChannelDetail";
import { SlackVictoropsAgentSetting } from "./SlackVictoropsAgentSetting";

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSlackChannelName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name) return "";
  return name.startsWith("#") ? name : `#${name}`;
}

const SLACK_ADAPTER: ConnectorAdminAdapter = {
  connectorName: "Slack",
  itemSingular: "channel",
  itemPlural: "channels",

  api: {
    list: "/api/admin/slack/channels",
    discoveryUrl: (page, cursor) => {
      const p = new URLSearchParams({ member_only: "1", limit: "500" });
      if (cursor) p.set("cursor", cursor);
      void page;
      return `/api/admin/slack/available-channels?${p.toString()}`;
    },
    defaults: "/api/admin/slack/channels/defaults",
    runtimeStatus: "/api/admin/slack/runtime/status",
    runtimeReload: "/api/admin/slack/runtime/reload",
    runtimeSyncFromConfig: "/api/admin/slack/runtime/sync-from-config",
    routesFor: (ws, ch) => `/api/admin/slack/channels/${encodeURIComponent(ws)}/${encodeURIComponent(ch)}/routes`,
    diagnosticsFor: (ws, ch) => `/api/admin/slack/channels/${encodeURIComponent(ws)}/${encodeURIComponent(ch)}/diagnostics`,
    legacyConfigDefaults: "/api/admin/slack/runtime/config-defaults",
  },

  parseListResponse: (json) => {
    const d = apiData<{ channels: unknown[] }>(json as { channels: unknown[] });
    return (d.channels ?? []) as Record<string, unknown>[];
  },
  parseListItem: (raw) => {
    const r = raw as Record<string, unknown>;
    if (!r.channel_id) return null;
    return {
      workspace_id: String(r.workspace_id ?? ""),
      item_id: String(r.channel_id),
      item_name: formatSlackChannelName(r.channel_name ?? r.channel_id),
      team_slug: r.team_slug ? String(r.team_slug) : undefined,
      active_grants: Number(r.active_grants ?? 0),
      can_manage: Boolean(r.can_manage),
      health: r.health as ItemSummary["health"],
    };
  },
  itemKey: (item) => `${item.workspace_id}/${item.item_id}`,
  parseDiscoveryPage: (json) => {
    const d = apiData<{ channels: unknown[]; next_cursor?: string | null; has_more?: boolean }>(
      json as { channels: unknown[] },
    );
    const channels = (d.channels ?? []) as Record<string, unknown>[];
    return {
      items: channels
        .filter((ch) => ch.is_member !== false)
        .map((ch) => ({
          id: String(ch.id ?? ""),
          name: formatSlackChannelName(ch.name ?? ch.id),
          secondary: [
            String(ch.id ?? ""),
            typeof ch.num_members === "number" ? pluralize(ch.num_members, "member") : "",
          ].filter(Boolean).join(" · "),
        })),
      nextCursor: d.next_cursor ?? null,
      hasMore: Boolean(d.has_more),
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
      items_seen: Number(d.channels_seen ?? 0),
      routes_planned: Number(d.routes_planned ?? 0),
      routes_upserted: Number(d.routes_upserted ?? 0),
      openfga_tuples_written: Number(d.openfga_tuples_written ?? 0),
      channels: Array.isArray(d.channels) ? (d.channels as RuntimeSyncSummary["channels"]) : undefined,
    };
  },

  discoveryCacheProvider: "slack",

  copy: {
    configuredTabTitle: "Configured channels",
    configuredTabDescription: "Channels CAIPE already knows about. Click a channel to manage its agents and diagnostics.",
    onboardTabTitle: "Onboard channels",
    onboardTabDescription: "Find Slack channels where the bot is installed and set them up.",
    advancedTabTitle: "Advanced",
    advancedTabDescription: "Superadmin Slack setup and operational controls for platform-wide bot behavior.",
    advancedHeading: "Import from Slackbot YAML",
    advancedSectionDescription: "Preview Slackbot YAML seed data before importing channel routes and agent settings into the database.",
    botNameInLegend: "Slackbot",
    discoveryDescription: "Find Slack channels where the bot is already installed. Channels the bot has not joined will not appear.",
    discoveryFindLabel: "Find channels",
    discoveryRefreshLabel: "Refresh channels",
    discoveryLoadingLabel: "Finding channels…",
    discoveryEmptyLabel: "No bot-member channels were discovered.",
    discoveryDiscoveredLabel: "bot-member channel",
    selfServiceTitle: "My Slack Channel Settings",
    selfServiceDescription: "Manage bot routing behavior only for Slack channels where OpenFGA grants you channel admin access.",
  },
  ariaLabels: {
    tablist: "Slack admin views",
    configuredRegion: "Configured Slack channels",
    advancedRegion: "Advanced Setup - Import/Sync with Slackbot",
  },

  discoveryStatusText: ({ discoveredCount, newCount, configuredCount, unassignedCount }) =>
    discoveredCount > 0
      ? `${discoveredCount} bot-member found · ${newCount} new · ${configuredCount} in CAIPE · ${unassignedCount} missing team`
      : `${configuredCount} in CAIPE · ${unassignedCount} missing team`,

  staticConfigLabel: ({ items, routes }) => `${items} channels / ${routes} routes`,
  routeCacheLabel: (count) => `${count} cached channel${count === 1 ? "" : "s"}`,
  syncDialogueTitle: (mode) => mode === "preview" ? "Slack Bot Config Sync Preview" : "Slack Bot Config Sync Apply",
  syncDialogueDescription: "Preview reads the Slack bot's loaded static YAML config. Apply upserts matching MongoDB route metadata and channel-agent OpenFGA tuples without deleting UI-managed associations.",
  syncSummaryItemsLabel: "Channels",

  authzDisclaimer: (
    <>
      <div>
        Slack authorization has two checks before dispatch: the channel must have
        <code className="mx-1">can_use agent:&lt;id&gt;</code>, and the user&apos;s active
        team must also have <code className="mx-1">can_use agent:&lt;id&gt;</code>.
        If either check fails, the Slack bot denies the request before calling the agent.
      </div>
      <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
        <span className="font-medium">Sharing model:</span> Adding an agent to a
        channel that is assigned to a team transitively grants <em>every member of
        that team</em> permission to invoke the agent in this channel — even members
        who were never granted the agent directly. If that is not what you want, share
        the agent with a smaller subgroup (or with individual users) instead of the
        channel&apos;s team.
        <p className="mt-2">
          Agents with <strong>global</strong> visibility or set as the{" "}
          <strong>platform default</strong> (Admin → Settings) also carry an OpenFGA
          grant <code className="mx-1">user:* can_use agent:&lt;id&gt;</code>, so every
          signed-in user can DM the agent and use it in any mapped Slack channel or
          Webex space. Channel onboarding here still writes{" "}
          <code className="mx-1">slack_channel:… can_use agent:&lt;id&gt;</code> and{" "}
          <code className="mx-1">team:&lt;slug&gt;#member can_use agent:&lt;id&gt;</code>{" "}
          for the channel&apos;s team; the bot&apos;s dispatch checks above still apply.
        </p>
      </div>
    </>
  ),

  configuredDetailExtra: (ctx) => (
    <SlackConfiguredChannelDetail
      selected={ctx.item}
      routes={ctx.routes}
      dynamicAgents={ctx.dynamicAgents}
      teams={ctx.teams}
      disabled={ctx.disabled}
      loading={ctx.loading}
      setLoading={ctx.setLoading}
      selectedCanManage={ctx.selectedCanManage}
      onRefresh={ctx.onRefresh}
      onDeselect={ctx.onDeselect}
      routesFor={ctx.routesFor}
      listApi={ctx.listApi}
    />
  ),

  diagnosticRouteIsFixable: (route: DiagnosticRoute) => route.route_metadata && !route.openfga_tuple,
  fixDiagnosticRoute: async ({ item, route }) => {
    const routeUrl = `/api/admin/slack/channels/${encodeURIComponent(item.workspace_id)}/${encodeURIComponent(item.item_id)}/routes`;
    const res = await fetch(routeUrl, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: route.agent_id }),
    });
    if (!res.ok) throw new Error(await res.text());
    return { toast: `Removed stale route metadata for agent:${route.agent_id}.` };
  },

  applyOnboarding: async ({ rows, defaultTeamSlug, defaultAgentId, createDefaultRoutes, fetchFn }) => {
    // Only set up rows that are fully configured (team + agent). Blocked
    // rows that happen to be selected are skipped rather than sent with
    // empty team/agent, so one unconfigured channel can't strand the batch.
    const selectedImports = rows.filter((r) => r.selected && r.teamSlug && r.agentId);
    if (selectedImports.length === 0 && (!defaultTeamSlug || !defaultAgentId)) {
      const missing: string[] = [];
      if (!defaultTeamSlug) missing.push("Preselected Team");
      if (!defaultAgentId) missing.push("Preselected Dynamic Agent");
      throw new Error(`Select ${missing.join(" and ")} in the "Default team and agent for new channels" section before running setup.`);
    }
    const fallbackTeamSlug = defaultTeamSlug || selectedImports[0]?.teamSlug || "";
    const fallbackAgentId = defaultAgentId || selectedImports[0]?.agentId || "";
    const res = await fetchFn("/api/admin/slack/channels/defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_slug: fallbackTeamSlug,
        agent_id: fallbackAgentId,
        create_routes: createDefaultRoutes,
        ...(selectedImports.length > 0 ? {
          channel_defaults: selectedImports.map((ch) => ({ id: ch.id, name: ch.name, team_slug: ch.teamSlug, agent_id: ch.agentId })),
        } : {}),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ summary: Record<string, number> }>(await res.json());
    const s = data.summary;
    return {
      toastMessage: selectedImports.length > 0
        ? `Discovered defaults applied: onboarded ${s.channels_onboarded ?? 0} channels, assigned ${s.channels_assigned_team} channels, ensured ${s.channel_grants_ensured} channel grants, ensured ${s.routes_ensured} routes, preserved ${s.routes_preserved ?? 0} existing routes.`
        : `Slack channel association defaults applied: assigned ${s.channels_assigned_team} channels, ensured ${s.channel_grants_ensured} channel grants, ensured ${s.routes_ensured} routes.`,
    };
  },

  missingRouteableAgentAutoFix: null,

  // Superadmin VictorOps escalation agent picker, rendered at the bottom of
  // the Slack Advanced tab. Persists to platform_config and is read by the
  // Slack bot at runtime.
  advancedTabExtraSection: ({ disabled }) => <SlackVictoropsAgentSetting disabled={disabled} />,
};

export function SlackChannelRebacPanel({
  disabled = false,
  selfService = false,
}: {
  disabled?: boolean;
  selfService?: boolean;
}) {
  return <ConnectorAdminPanel adapter={SLACK_ADAPTER} disabled={disabled} selfService={selfService} />;
}
