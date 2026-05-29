"use client";

import type { ReactNode } from "react";

// Normalised summary for a single configured item (channel / space).
// The shared component uses these field names; each provider adapter
// maps its API response to this shape.
export interface ItemSummary {
  workspace_id: string;
  item_id: string;
  item_name: string;
  team_slug?: string;
  active_grants: number;
  can_manage?: boolean;
  health?: {
    warnings_count: number;
    openfga_reachable: boolean;
    last_runtime_error_ts: string | null;
  };
}

export interface ItemAgentRoute {
  agent_id: string;
  enabled: boolean;
  priority: number;
  users?: { enabled?: boolean; listen?: "message" | "mention" | "all" };
}

export interface DiagnosticRoute {
  agent_id: string;
  openfga_tuple: boolean;
  route_metadata: boolean;
  listen: "message" | "mention" | "all" | "unknown";
  priority?: number;
  runtime_matches: { mention: boolean; message: boolean };
  warnings: string[];
}

export interface ItemDiagnostics {
  openfga: { reachable: boolean; tuple_count: number; error?: string };
  routes: DiagnosticRoute[];
  warnings: string[];
  last_runtime_error?: {
    ts?: string; reason_code?: string; message?: string; action?: string;
  } | null;
}

export interface RuntimeStatus {
  route_mode: string;
  static_config: Record<string, number>;
  route_cache: { ttl_seconds: number; cache_size: number };
  raw: Record<string, unknown>;
}

export interface RuntimeSyncSummary {
  dry_run: boolean;
  items_seen: number;
  routes_planned: number;
  routes_upserted: number;
  openfga_tuples_written: number;
}

export interface DiscoveredItem {
  id: string;
  name: string;
  secondary: string;
}

export interface DiscoveryPage {
  items: DiscoveredItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ConnectorAdminAdapter {
  // ── Branding ──────────────────────────────────────────────────────────
  connectorName: string;    // "Slack" | "Webex"
  itemSingular: string;     // "channel" | "space"
  itemPlural: string;       // "channels" | "spaces"

  // ── API paths ─────────────────────────────────────────────────────────
  api: {
    list: string;                                                    // GET ?health=1
    // Returns the paged discovery URL for the given page index + cursor.
    // Slack: /api/admin/slack/available-channels?member_only=1&limit=500[&cursor=…]
    // Webex: /api/admin/webex/available-spaces?limit=500[&refresh=1][&cursor=…]
    discoveryUrl: (page: number, cursor: string | null) => string;
    defaults: string;                                                // GET / PUT / POST
    runtimeStatus: string;
    runtimeReload: string;
    runtimeSyncFromConfig: string;
    routesFor: (workspaceId: string, itemId: string) => string;
    diagnosticsFor: (workspaceId: string, itemId: string) => string;
    legacyConfigDefaults?: string | null;                            // Slack only
  };

  // ── Shape adapters ────────────────────────────────────────────────────
  // Composite key used as React key and selectedKey value.
  itemKey: (item: ItemSummary) => string;
  // Map a raw list-response row to ItemSummary. Return null to skip.
  parseListItem: (raw: Record<string, unknown>) => ItemSummary | null;
  parseListResponse: (json: unknown) => Record<string, unknown>[];
  parseDiscoveryPage: (json: unknown) => DiscoveryPage;
  parseRuntimeStatus: (json: unknown) => RuntimeStatus;
  parseRuntimeSyncSummary: (json: unknown) => RuntimeSyncSummary;

  // ── Copy / aria labels ────────────────────────────────────────────────
  copy: {
    configuredTabTitle: string;
    configuredTabDescription: string;
    onboardTabTitle: string;
    onboardTabDescription: string;
    advancedTabTitle: string;
    advancedTabDescription: string;
    advancedHeading: string;
    // Used in the legend: "shows whether the Slackbot reads…" / "Webex bot reads…"
    botNameInLegend: string;
    onboardingDefaultsHeading: string;
    onboardingDefaultsDescription: string;
    discoveryDescription: string;
    discoveryFindLabel: string;
    discoveryRefreshLabel: string;
    discoveryLoadingLabel: string;
    discoveryEmptyLabel: string;
    discoveryDiscoveredLabel: string;
    selfServiceTitle: string;
    selfServiceDescription: string;
    // Optional extra text appended to the stale-default warnings.
    // Slack tells the admin which env var to update; Webex can omit.
    invalidTeamEnvHint?: string;
    invalidAgentEnvHint?: string;
  };
  ariaLabels: {
    tablist: string;
    configuredRegion: string;
    advancedRegion: string;
    advancedLegend: string;
    onboardingDefaultsRegion: string;
  };

  // ── Discovery status text ─────────────────────────────────────────────
  discoveryStatusText: (counts: {
    discoveredCount: number;
    newCount: number;
    configuredCount: number;
    unassignedCount: number;
  }) => string;

  // ── Advanced tab extras ───────────────────────────────────────────────
  // Webex shows a "Thread context" stat tile; Slack doesn't.
  // Returns extra stat tiles to render after the base 3.
  advancedExtraTiles?: (status: RuntimeStatus) => Array<{ label: string; value: string }>;
  // Returns extra legend rows for the Webex "Thread context" legend entry.
  advancedExtraLegendRows?: () => Array<{ label: string; description: string }>;
  // How to pluralise the static-config and route-cache tile values.
  staticConfigLabel: (counts: { items: number; routes: number }) => string;
  routeCacheLabel: (count: number) => string;
  // Dialogue: Slack says "Slack Bot Config Sync", Webex says "Webex Bot Config Sync".
  syncDialogueTitle: (mode: "preview" | "apply") => string;
  // Dialogue description differs by connector.
  syncDialogueDescription: string;
  // In the sync summary modal: "Channels" vs "Spaces" scanned.
  syncSummaryItemsLabel: string;

  // When true, discovered items that are not yet configured are
  // auto-selected in the wizard. Webex uses this; Slack does not.
  discoveryAutoSelectNewItems?: boolean;

  // ── Onboarding apply ─────────────────────────────────────────────────
  // Different connectors send different POST payloads and fire different
  // success messages. The adapter owns the request(s) and the toast text.
  applyOnboarding: (input: {
    rows: Array<{ id: string; name?: string; teamSlug: string; agentId: string; selected: boolean }>;
    defaultTeamSlug: string;
    defaultAgentId: string;
    createDefaultRoutes: boolean;
    fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  }) => Promise<{ toastMessage: string }>;

  // ── Route editing ─────────────────────────────────────────────────────
  // Slack shows manual route create/edit/delete. Webex does not.
  manualRouteEditing: boolean;

  // Hint text above the manual route form (Slack channel semantics copy).
  manualRouteFormHint?: (item: ItemSummary) => ReactNode;

  // ── Discovery cache provider ─────────────────────────────────────────
  // Optional — drives the cache-invalidation popover next to the Find button.
  discoveryCacheProvider?: import("@/components/admin/rebac/DiscoveryCacheControls").DiscoveryCacheProvider;

  // ── Authorization disclaimer ─────────────────────────────────────────
  // Rendered above the configured-items table when selfService=true or
  // on the Onboard tab. Slack and Webex have near-identical copy; each
  // adapter provides the exact JSX so the panel stays generic.
  authzDisclaimer: ReactNode;

  // ── Diagnostics fixability ────────────────────────────────────────────
  diagnosticRouteIsFixable: (route: DiagnosticRoute) => boolean;
  // Execute the fix for a diagnostic route (delete orphan or lift listen
  // mode). Returns the toast text and optionally the updated route list.
  fixDiagnosticRoute: (input: {
    item: ItemSummary;
    route: DiagnosticRoute;
    routes: ItemAgentRoute[];
  }) => Promise<{ toast: string; nextRoutes?: ItemAgentRoute[] }>;

  // ── Provider-specific feature flags ──────────────────────────────────
  // Slack only: "Use existing Slackbot channel agents as defaults" checkbox.
  legacyConfigAgentPrefill?: {
    description: string;
    fetchSuggestions: (fetchFn: typeof fetch) => Promise<Record<string, string>>;
  } | null;

  // Webex only: auto-fix card when a space has no routeable agent.
  missingRouteableAgentAutoFix?: {
    title: string;
    description: string;
    buttonLabel: (agentId: string) => string;
    noAgentHelpText: string;
    isApplicable: (item: ItemSummary, diagnostics: ItemDiagnostics) => boolean;
  } | null;

  // Webex only: extra runtime info rendered on the Advanced tab after
  // the shared controls (e.g. thread-context block).
  advancedTabExtras?: (status: RuntimeStatus) => ReactNode;
}
