"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  FileUp,
  RefreshCw,
  RotateCw,
  Settings2,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { cn } from "@/lib/utils";
import { ConnectorOnboardingWizard } from "./ConnectorOnboardingWizard";

interface SlackChannelSummary {
  workspace_id: string;
  channel_id: string;
  channel_name: string;
  team_slug?: string;
  active_grants: number;
  can_manage?: boolean;
  health?: {
    warnings_count: number;
    openfga_reachable: boolean;
    last_runtime_error_ts: string | null;
  };
}

interface SlackChannelAgentRoute {
  agent_id: string;
  enabled: boolean;
  priority: number;
  users?: {
    enabled?: boolean;
    listen?: "message" | "mention" | "all";
  };
}

interface SlackRuntimeDiagnosticRoute {
  agent_id: string;
  openfga_tuple: boolean;
  route_metadata: boolean;
  listen: "message" | "mention" | "all" | "unknown";
  priority: number;
  runtime_matches: {
    mention: boolean;
    message: boolean;
  };
  warnings: string[];
}

interface SlackRuntimeDiagnostics {
  openfga: {
    reachable: boolean;
    tuple_count: number;
    error?: string;
  };
  routes: SlackRuntimeDiagnosticRoute[];
  warnings: string[];
  last_runtime_error?: {
    ts?: string;
    reason_code?: string;
    message?: string;
    action?: string;
  } | null;
}

interface DynamicAgentOption {
  _id: string;
  name: string;
}

interface TeamOption {
  _id?: string;
  id?: string;
  slug: string;
  name: string;
}

interface SlackChannelAssociationDefaults {
  team_slug: string;
  agent_id: string;
  create_routes?: boolean;
  /** Set by the persistence API (DB-backed); empty when value came from env. */
  updated_at?: string;
  /** Email of the admin who last saved; empty for env-only values. */
  updated_by?: string;
  /** "db" | "env" | "unset" — drives the "Saved" vs "Env default" label. */
  source?: "db" | "env" | "unset";
}

interface SlackBotRuntimeStatus {
  route_mode: string;
  static_config: {
    channels: number;
    routes: number;
  };
  route_cache: {
    ttl_seconds: number;
    cache_size: number;
    cached_channels?: string[];
  };
  last_sync?: SlackBotRuntimeSyncSummary | null;
}

interface SlackBotRuntimeSyncSummary {
  dry_run: boolean;
  channels_seen: number;
  routes_planned: number;
  routes_upserted: number;
  openfga_tuples_written: number;
}

interface DiscoveredSlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_member?: boolean;
  num_members?: number;
}

interface SlackChannelImportRow extends DiscoveredSlackChannel {
  selected: boolean;
  team_slug: string;
  agent_id: string;
  is_existing: boolean;
}

interface SlackLegacyConfigDefault {
  suggested_agent_id?: string | null;
  agents?: Array<{
    agent_id?: string;
    priority?: number;
  }>;
}

interface SlackLegacyConfigDefaultsPayload {
  channels?: Record<string, SlackLegacyConfigDefault>;
}

interface SlackChannelDiscoveryPayload {
  channels: DiscoveredSlackChannel[];
  next_cursor?: string | null;
  has_more?: boolean;
}

interface SlackChannelDefaultsSummary {
  channels_seen: number;
  channels_assigned_team: number;
  channel_grants_ensured: number;
  routes_ensured: number;
  channels_discovered?: number;
  channels_onboarded?: number;
  routes_preserved?: number;
}

type RuntimeSyncModalMode = "preview" | "apply";
type RuntimeSyncModalStatus = "idle" | "loading" | "success" | "error";

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function agentLabel(agent: DynamicAgentOption): string {
  return `${agent.name || agent._id} (${agent._id})`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

interface ChannelDetailProps {
  selected: SlackChannelSummary;
  diagnostics: SlackRuntimeDiagnostics | null;
  routes: SlackChannelAgentRoute[];
  dynamicAgents: DynamicAgentOption[];
  routeAgentId: string;
  setRouteAgentId: (value: string) => void;
  routeListen: "message" | "mention" | "all";
  setRouteListen: (value: "message" | "mention" | "all") => void;
  routePriority: number;
  setRoutePriority: (value: number) => void;
  editingRouteAgentId: string | null;
  resetRouteForm: () => void;
  editRoute: (route: SlackChannelAgentRoute) => void;
  saveRoute: () => Promise<void> | void;
  deleteRoute: (route: SlackChannelAgentRoute) => void;
  fixDiagnosticRoute: (route: SlackRuntimeDiagnosticRoute) => Promise<void> | void;
  diagnosticRouteIsFixable: (route: SlackRuntimeDiagnosticRoute) => boolean;
  disabled: boolean;
  loading: boolean;
  selectedCanManage: boolean;
  message: string | null;
}

function ChannelDetail({
  selected,
  diagnostics,
  routes,
  dynamicAgents,
  routeAgentId,
  setRouteAgentId,
  routeListen,
  setRouteListen,
  routePriority,
  setRoutePriority,
  editingRouteAgentId,
  resetRouteForm,
  editRoute,
  saveRoute,
  deleteRoute,
  fixDiagnosticRoute,
  diagnosticRouteIsFixable,
  disabled,
  loading,
  selectedCanManage,
  message,
}: ChannelDetailProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Diagnostics
        </div>
        {!diagnostics ? (
          <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
        ) : (
          <>
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <div className="rounded-md border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">OpenFGA</div>
                <div className="font-medium">{diagnostics.openfga.reachable ? "reachable" : "unreachable"}</div>
                <div className="text-xs text-muted-foreground">{diagnostics.openfga.tuple_count} channel-agent tuples</div>
              </div>
              <div className="rounded-md border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">Runtime routes</div>
                <div className="font-medium">{diagnostics.routes.length}</div>
                <div className="text-xs text-muted-foreground">OpenFGA-backed candidates</div>
              </div>
              <div className="rounded-md border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">Last error</div>
                <div className="font-medium">{diagnostics.last_runtime_error?.reason_code ?? "none"}</div>
                <div className="text-xs text-muted-foreground">{diagnostics.last_runtime_error?.ts ?? "No recent runtime error"}</div>
              </div>
            </div>
            {diagnostics.warnings.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="text-xs font-medium uppercase tracking-wide">Issues found</div>
                {diagnostics.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}
            {diagnostics.last_runtime_error?.message && (
              <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                {diagnostics.last_runtime_error.message}
              </div>
            )}
            {diagnostics.routes.length > 0 && (
              <div className="space-y-2">
                {diagnostics.routes.map((route) => (
                  <div key={route.agent_id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background/60 p-3 text-sm">
                    <span className="font-medium">agent:{route.agent_id}</span>
                    <Badge variant={route.openfga_tuple ? "default" : "outline"}>
                      {route.openfga_tuple ? "OpenFGA tuple" : "missing tuple"}
                    </Badge>
                    <Badge variant={route.route_metadata ? "secondary" : "outline"}>
                      {route.route_metadata ? `listen:${route.listen}` : "default metadata"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      mention {route.runtime_matches.mention ? "yes" : "no"} / message {route.runtime_matches.message ? "yes" : "no"}
                    </span>
                    {diagnosticRouteIsFixable(route) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => void fixDiagnosticRoute(route)}
                        disabled={disabled || !selectedCanManage || loading}
                        aria-label={`Fix agent:${route.agent_id} routing`}
                      >
                        Fix it
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agents
        </div>
        <p className="text-xs text-muted-foreground">
          Multiple agents can be associated with #{selected.channel_name}. The Slack bot picks the
          highest-priority agent whose listen mode matches the message (mention vs. plain message).
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="slack-route-agent-id">Dynamic Agent</Label>
            <select
              id="slack-route-agent-id"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={routeAgentId}
              onChange={(event) => setRouteAgentId(event.target.value)}
              disabled={disabled || !selectedCanManage || dynamicAgents.length === 0}
            >
              <option value="">
                {dynamicAgents.length === 0 ? "No enabled Dynamic Agents found" : "Select Dynamic Agent"}
              </option>
              {dynamicAgents.map((agent) => (
                <option key={agent._id} value={agent._id}>
                  {agentLabel(agent)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="slack-route-listen">Listen</Label>
            <select
              id="slack-route-listen"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={routeListen}
              onChange={(event) => setRouteListen(event.target.value as "message" | "mention" | "all")}
              disabled={disabled || !selectedCanManage}
            >
              <option value="mention">mention</option>
              <option value="message">message</option>
              <option value="all">all</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="slack-route-priority">Priority</Label>
            <Input
              id="slack-route-priority"
              type="number"
              value={routePriority}
              onChange={(event) => setRoutePriority(Number(event.target.value))}
              disabled={disabled || !selectedCanManage}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void saveRoute()} disabled={disabled || !selectedCanManage || loading || !routeAgentId.trim()}>
            {loading
              ? "Saving..."
              : editingRouteAgentId
                ? "Update Association"
                : "Create Association"}
          </Button>
          {editingRouteAgentId && (
            <Button type="button" variant="outline" onClick={resetRouteForm} disabled={loading}>
              Cancel edit
            </Button>
          )}
        </div>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {routes.length > 0 && (
          <div className="space-y-2">
            {routes.map((route) => (
              <div
                key={route.agent_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/60 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>agent:{route.agent_id}</span>
                  <Badge>
                    {route.users?.listen ?? "mention"} / priority {route.priority}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => editRoute(route)}
                    disabled={disabled || !selectedCanManage || loading}
                    aria-label={`Edit agent:${route.agent_id}`}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteRoute(route)}
                    disabled={disabled || !selectedCanManage || loading}
                    aria-label={`Delete agent:${route.agent_id}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SlackChannelRebacPanel({
  disabled = false,
  selfService = false,
}: {
  disabled?: boolean;
  selfService?: boolean;
}) {
  const { toast } = useToast();
  const [channels, setChannels] = useState<SlackChannelSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [routes, setRoutes] = useState<SlackChannelAgentRoute[]>([]);
  const [diagnostics, setDiagnostics] = useState<SlackRuntimeDiagnostics | null>(null);
  const [dynamicAgents, setDynamicAgents] = useState<DynamicAgentOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [routeAgentId, setRouteAgentId] = useState("");
  const [editingRouteAgentId, setEditingRouteAgentId] = useState<string | null>(null);
  const [routePendingDelete, setRoutePendingDelete] = useState<SlackChannelAgentRoute | null>(null);
  const [defaultTeamSlug, setDefaultTeamSlug] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [invalidDefaultTeamSlug, setInvalidDefaultTeamSlug] = useState<string | null>(null);
  const [invalidDefaultAgentId, setInvalidDefaultAgentId] = useState<string | null>(null);
  const [configuredDefaults, setConfiguredDefaults] = useState<SlackChannelAssociationDefaults | null>(null);
  const [useSlackbotConfigDefaults, setUseSlackbotConfigDefaults] = useState(true);
  const [slackRuntimeStatus, setSlackRuntimeStatus] = useState<SlackBotRuntimeStatus | null>(null);
  const [runtimeSyncSummary, setRuntimeSyncSummary] = useState<SlackBotRuntimeSyncSummary | null>(null);
  const [runtimeSyncModalOpen, setRuntimeSyncModalOpen] = useState(false);
  const [runtimeSyncModalMode, setRuntimeSyncModalMode] = useState<RuntimeSyncModalMode>("preview");
  const [runtimeSyncModalStatus, setRuntimeSyncModalStatus] = useState<RuntimeSyncModalStatus>("idle");
  const [runtimeSyncModalError, setRuntimeSyncModalError] = useState<string | null>(null);
  const [createDefaultRoutes, setCreateDefaultRoutes] = useState(true);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [discoverDefaultsLoading, setDiscoverDefaultsLoading] = useState(false);
  const [discoverDefaultsError, setDiscoverDefaultsError] = useState<string | null>(null);
  const [discoveredBotChannels, setDiscoveredBotChannels] = useState<DiscoveredSlackChannel[]>([]);
  const [discoveredImportRows, setDiscoveredImportRows] = useState<SlackChannelImportRow[]>([]);
  const [routeListen, setRouteListen] = useState<"message" | "mention" | "all">("mention");
  const [routePriority, setRoutePriority] = useState(100);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Sub-tab the admin is viewing. `channels` shows configured channels
  // (with drill-in for diagnostics + per-channel route editing).
  // `onboard` shows discovery + bulk import. `advanced` shows YAML
  // import and runtime status. Self-service users always see the
  // channel detail layout, which renders unconditionally below.
  type SlackPanelView = "channels" | "onboard" | "advanced";
  const [view, setView] = useState<SlackPanelView>("channels");
  // Search box for the onboarding wizard's discovered list. Lifted to
  // the panel so we keep the value across refresh clicks.
  const [discoverySearch, setDiscoverySearch] = useState("");

  const selected = useMemo(
    () => channels.find((channel) => `${channel.workspace_id}/${channel.channel_id}` === selectedKey),
    [channels, selectedKey]
  );
  const selectedCanManage = !selfService || selected?.can_manage === true;
  const unassignedChannelCount = useMemo(
    () => channels.filter((channel) => !channel.team_slug).length,
    [channels]
  );
  const configuredChannelIds = useMemo(
    () => new Set(channels.map((channel) => channel.channel_id)),
    [channels]
  );
  const configuredChannelsById = useMemo(
    () => new Map(channels.map((channel) => [channel.channel_id, channel])),
    [channels]
  );
  const sortedDynamicAgents = useMemo(
    () => [...dynamicAgents].sort((left, right) => agentLabel(left).localeCompare(agentLabel(right))),
    [dynamicAgents]
  );
  const dynamicAgentIds = useMemo(
    () => new Set(dynamicAgents.map((agent) => agent._id)),
    [dynamicAgents]
  );
  const teamSlugSet = useMemo(
    () => new Set(teams.map((team) => team.slug).filter(Boolean) as string[]),
    [teams]
  );
  // Returns the agent that should pre-fill discovered rows when the
  // legacy Slackbot YAML has no entry for that channel. Honors the
  // admin's saved default; otherwise leaves the row's agent unset so
  // the admin sees a "Pick an agent" status instead of getting an
  // arbitrary alphabetical default silently submitted on their behalf.
  const fallbackAgentId = useMemo(() => {
    if (defaultAgentId && dynamicAgentIds.has(defaultAgentId)) return defaultAgentId;
    return "";
  }, [defaultAgentId, dynamicAgentIds]);
  // True when the form picks differ from what's actually persisted —
  // drives the dedicated "Save defaults" button's enabled state and
  // the small "Unsaved changes" indicator next to the chips. Treat
  // missing fields on `configuredDefaults` as empty so a never-saved
  // tenant doesn't get a permanent "dirty" badge.
  const associationDefaultsDirty = useMemo(() => {
    const savedTeam = configuredDefaults?.team_slug ?? "";
    const savedAgent = configuredDefaults?.agent_id ?? "";
    const savedCreateRoutes =
      typeof configuredDefaults?.create_routes === "boolean"
        ? configuredDefaults.create_routes
        : true;
    return (
      savedTeam !== defaultTeamSlug ||
      savedAgent !== defaultAgentId ||
      savedCreateRoutes !== createDefaultRoutes
    );
  }, [configuredDefaults, defaultTeamSlug, defaultAgentId, createDefaultRoutes]);
  const discoveredNewChannelCount = useMemo(
    () => discoveredBotChannels.filter((channel) => !configuredChannelIds.has(channel.id)).length,
    [configuredChannelIds, discoveredBotChannels]
  );
  const selectedDiscoveredImportRows = useMemo(
    () => discoveredImportRows.filter((row) => row.selected && row.team_slug && row.agent_id),
    [discoveredImportRows]
  );
  const discoveryStatusText =
    discoveredBotChannels.length > 0
      ? `${discoveredBotChannels.length} bot-visible found · ${discoveredNewChannelCount} new · ${channels.length} in CAIPE · ${unassignedChannelCount} missing team`
      : `${channels.length} in CAIPE · ${unassignedChannelCount} missing team`;

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/slack/channels?health=1");
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{ channels: SlackChannelSummary[] }>(await response.json());
      setChannels(data.channels ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channels");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoutes = useCallback(async () => {
    if (!selected) return;
    const response = await fetch(
      `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/routes`
    );
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ routes: SlackChannelAgentRoute[] }>(await response.json());
    setRoutes(data.routes ?? []);
  }, [selected]);

  const loadDiagnostics = useCallback(async () => {
    if (!selected) return;
    const response = await fetch(
      `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/diagnostics`
    );
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<SlackRuntimeDiagnostics>(await response.json());
    setDiagnostics(data);
  }, [selected]);

  const loadDynamicAgents = useCallback(async () => {
    const response = await fetch("/api/dynamic-agents?enabled_only=true");
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ items: DynamicAgentOption[] }>(await response.json());
    setDynamicAgents(data.items ?? []);
  }, []);

  const loadTeams = useCallback(async () => {
    const response = await fetch("/api/admin/teams");
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ teams: TeamOption[] }>(await response.json());
    setTeams(data.teams ?? []);
  }, []);

  const loadAssociationDefaults = useCallback(async () => {
    const response = await fetch("/api/admin/slack/channels/defaults");
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ defaults: SlackChannelAssociationDefaults }>(await response.json());
    setConfiguredDefaults(data.defaults ?? null);
    // Adopt the saved values verbatim — empty strings included — so
    // clearing the save in another tab is reflected here on the next
    // load. The previous `current || …` pattern was a one-way bridge
    // that only ever populated empty fields, which is why admins saw
    // stale values stick after they cleared their pick.
    if (data.defaults) {
      setDefaultTeamSlug(data.defaults.team_slug ?? "");
      setDefaultAgentId(data.defaults.agent_id ?? "");
      if (typeof data.defaults.create_routes === "boolean") {
        setCreateDefaultRoutes(data.defaults.create_routes);
      }
    }
  }, []);

  // Persist the onboarding defaults to MongoDB (`platform_config`) so
  // the admin's pick survives a page reload. This is the explicit
  // "Save defaults" button the UI exposes — distinct from the
  // migration POST, which only fires when the admin clicks "Apply" on
  // the import wizard.
  const saveAssociationDefaults = useCallback(async () => {
    setSavingDefaults(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/slack/channels/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_slug: defaultTeamSlug,
          agent_id: defaultAgentId,
          create_routes: createDefaultRoutes,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{ defaults: SlackChannelAssociationDefaults }>(
        await response.json(),
      );
      setConfiguredDefaults(data.defaults ?? null);
      if (data.defaults) {
        setDefaultTeamSlug(data.defaults.team_slug ?? "");
        setDefaultAgentId(data.defaults.agent_id ?? "");
        if (typeof data.defaults.create_routes === "boolean") {
          setCreateDefaultRoutes(data.defaults.create_routes);
        }
      }
      toast("Onboarding defaults saved.", "success");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save Slack onboarding defaults";
      setMessage(errorMessage);
      toast(errorMessage, "error");
    } finally {
      setSavingDefaults(false);
    }
  }, [defaultTeamSlug, defaultAgentId, createDefaultRoutes, toast]);

  const loadSlackRuntimeStatus = useCallback(async () => {
    const response = await fetch("/api/admin/slack/runtime/status");
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<SlackBotRuntimeStatus>(await response.json());
    setSlackRuntimeStatus(data);
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    void loadDynamicAgents().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Dynamic Agents")
    );
  }, [loadDynamicAgents]);

  useEffect(() => {
    if (selfService) return;
    void loadTeams().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load teams")
    );
  }, [loadTeams, selfService]);

  useEffect(() => {
    if (selfService) return;
    void loadAssociationDefaults().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channel association defaults")
    );
  }, [loadAssociationDefaults, selfService]);

  // Drop env-provided default Dynamic Agent / team if it no longer resolves to a
  // real, enabled record. Otherwise the dropdown silently submits a stale id
  // (e.g. SLACK_DEFAULT_AGENT_ID points at a deleted agent) and the API
  // rejects with "Dynamic Agent <id> was not found or is disabled".
  useEffect(() => {
    if (selfService) return;
    if (dynamicAgents.length === 0) return;
    // Clear the stale-default warning ONLY when the admin picks a real,
    // valid agent. We deliberately do NOT clear it when defaultAgentId
    // is "" — that would race the same effect that just emptied the
    // value after detecting the stale env id, and the warning would
    // disappear on the next render before the admin saw it.
    if (!defaultAgentId) return;
    if (!dynamicAgentIds.has(defaultAgentId)) {
      setInvalidDefaultAgentId(defaultAgentId);
      setDefaultAgentId("");
    } else if (invalidDefaultAgentId) {
      setInvalidDefaultAgentId(null);
    }
  }, [selfService, dynamicAgents.length, dynamicAgentIds, defaultAgentId, invalidDefaultAgentId]);

  useEffect(() => {
    if (selfService) return;
    if (teams.length === 0) return;
    if (!defaultTeamSlug) return;
    if (!teamSlugSet.has(defaultTeamSlug)) {
      setInvalidDefaultTeamSlug(defaultTeamSlug);
      setDefaultTeamSlug("");
    } else if (invalidDefaultTeamSlug) {
      setInvalidDefaultTeamSlug(null);
    }
  }, [selfService, teams.length, teamSlugSet, defaultTeamSlug, invalidDefaultTeamSlug]);

  useEffect(() => {
    if (selfService) return;
    void loadSlackRuntimeStatus().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack bot runtime status")
    );
  }, [loadSlackRuntimeStatus, selfService]);

  useEffect(() => {
    void loadRoutes().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channel routes")
    );
  }, [loadRoutes]);

  useEffect(() => {
    setDiagnostics(null);
    void loadDiagnostics().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack runtime diagnostics")
    );
  }, [loadDiagnostics]);

  const resetRouteForm = () => {
    setRouteAgentId("");
    setRouteListen("mention");
    setRoutePriority(100);
    setEditingRouteAgentId(null);
  };

  const editRoute = (route: SlackChannelAgentRoute) => {
    setRouteAgentId(route.agent_id);
    setRouteListen(route.users?.listen ?? "mention");
    setRoutePriority(route.priority ?? 100);
    setEditingRouteAgentId(route.agent_id);
  };

  const saveRoute = async () => {
    if (!selected || !routeAgentId.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const agentId = routeAgentId.trim();
      const nextRoutes = [
        ...routes.filter(
          (route) => route.agent_id !== agentId && route.agent_id !== editingRouteAgentId
        ),
        {
          agent_id: agentId,
          enabled: true,
          priority: routePriority,
          users: { enabled: true, listen: routeListen },
        },
      ];
      const response = await fetch(
        `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/routes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routes: nextRoutes }),
        }
      );
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{ routes: SlackChannelAgentRoute[] }>(await response.json());
      setRoutes(data.routes ?? []);
      resetRouteForm();
      toast(
        editingRouteAgentId
          ? "Slack channel-agent association updated."
          : "Slack channel-agent association created.",
        "success"
      );
      await Promise.all([loadChannels(), loadDiagnostics()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Slack association");
    } finally {
      setLoading(false);
    }
  };

  const deleteRoute = async () => {
    if (!selected || !routePendingDelete) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/routes`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: routePendingDelete.agent_id }),
        }
      );
      if (!response.ok) throw new Error(await response.text());
      if (editingRouteAgentId === routePendingDelete.agent_id) {
        resetRouteForm();
      }
      setRoutePendingDelete(null);
      toast("Slack channel-agent association deleted.", "success");
      await Promise.all([loadChannels(), loadRoutes(), loadDiagnostics()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete Slack association");
    } finally {
      setLoading(false);
    }
  };

  const refreshSlackRuntimeStatus = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await loadSlackRuntimeStatus();
      toast("Slack bot runtime status refreshed.", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Slack bot runtime status");
    } finally {
      setLoading(false);
    }
  };

  const reloadSlackBotRoutes = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/slack/runtime/reload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await response.text());
      await loadSlackRuntimeStatus();
      toast("Slack bot route cache reloaded.", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to reload Slack bot routes");
    } finally {
      setLoading(false);
    }
  };

  const syncSlackBotConfig = async (dryRun: boolean) => {
    setRuntimeSyncModalOpen(true);
    setRuntimeSyncModalMode(dryRun ? "preview" : "apply");
    setRuntimeSyncModalStatus("loading");
    setRuntimeSyncModalError(null);
    if (dryRun) {
      setRuntimeSyncSummary(null);
    }
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/slack/runtime/sync-from-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<SlackBotRuntimeSyncSummary>(await response.json());
      setRuntimeSyncSummary(data);
      setRuntimeSyncModalStatus("success");
      toast(
        dryRun
          ? `Sync preview: ${data.routes_planned} routes planned from ${data.channels_seen} channels.`
          : `Config sync applied: upserted ${data.routes_upserted} routes and wrote ${data.openfga_tuples_written} OpenFGA tuples.`,
        "success"
      );
      await Promise.all([loadSlackRuntimeStatus(), loadChannels(), loadRoutes(), loadDiagnostics()]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to sync Slack bot config";
      setRuntimeSyncModalError(errorMessage);
      setRuntimeSyncModalStatus("error");
      setMessage(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const fetchBotMemberChannels = async (): Promise<DiscoveredSlackChannel[]> => {
    // Issue #1506: previously this set `refresh=1` on the first page of every
    // Discover click, which defeated the server-side cache entirely and
    // tripped Slack's per-tenant rate limits on workspaces with thousands of
    // channels. The cache TTL (10 min, server-side) is short enough for human
    // admin workflows; a hard refresh button can be added separately if/when
    // operators actually need it.
    const discovered: DiscoveredSlackChannel[] = [];
    let cursor: string | null | undefined;
    do {
      const params = new URLSearchParams({
        member_only: "1",
        limit: "500",
      });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/slack/available-channels?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<SlackChannelDiscoveryPayload>(await response.json());
      discovered.push(...(data.channels ?? []));
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);
    return discovered.filter((channel) => channel.is_member !== false);
  };

  const fetchSlackbotConfigDefaults = async (): Promise<SlackLegacyConfigDefaultsPayload | null> => {
    if (!useSlackbotConfigDefaults) return null;
    const response = await fetch("/api/admin/slack/runtime/config-defaults", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    return apiData<SlackLegacyConfigDefaultsPayload>(await response.json());
  };

  const resolveDiscoveredAgentId = (
    channel: DiscoveredSlackChannel,
    legacyDefaults: SlackLegacyConfigDefaultsPayload | null
  ): string => {
    const legacyAgentId = legacyDefaults?.channels?.[channel.id]?.suggested_agent_id?.trim();
    if (legacyAgentId && dynamicAgentIds.has(legacyAgentId)) return legacyAgentId;
    return fallbackAgentId;
  };

  const discoverDefaults = async () => {
    setDiscoverDefaultsLoading(true);
    setDiscoverDefaultsError(null);
    setMessage(null);
    try {
      const [discovered, legacyDefaults] = await Promise.all([
        fetchBotMemberChannels(),
        fetchSlackbotConfigDefaults(),
      ]);
      setDiscoveredBotChannels(discovered);
      setDiscoveredImportRows(
        discovered.map((channel) => {
          const existingChannel = configuredChannelsById.get(channel.id);
          const isSetupComplete = Boolean(
            existingChannel?.team_slug && (existingChannel.active_grants ?? 0) > 0
          );
          return {
            ...channel,
            selected: false,
            team_slug: defaultTeamSlug,
            agent_id: resolveDiscoveredAgentId(channel, legacyDefaults),
            is_existing: isSetupComplete,
          };
        })
      );
      toast(`Found ${pluralize(discovered.length, "bot-member channel")}.`, "success");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to discover Slack bot-member channels";
      setDiscoverDefaultsError(errorMessage);
      setMessage(errorMessage);
      setDiscoveredImportRows([]);
    } finally {
      setDiscoverDefaultsLoading(false);
    }
  };

  const updateDiscoveredImportRow = (
    channelId: string,
    updates: Partial<Pick<SlackChannelImportRow, "selected" | "team_slug" | "agent_id">>
  ) => {
    setDiscoveredImportRows((rows) =>
      rows.map((row) => (row.id === channelId ? { ...row, ...updates } : row))
    );
  };

  const setAllDiscoveredImportRowsSelected = (selected: boolean) => {
    setDiscoveredImportRows((rows) => rows.map((row) => ({ ...row, selected })));
  };

  const confirmMigrationDefaults = async (channelImportRows: SlackChannelImportRow[] = []) => {
    const selectedImports = channelImportRows.filter((row) => row.selected);
    // Two valid entry points:
    //   1. Per-row apply — every selected row carries its own team+agent.
    //      The "Default team and agent for new channels" globals are
    //      pre-fill convenience and have their own Save button, so we
    //      don't gate the apply on them. The wizard's `applyDisabled`
    //      already blocks the click when a selected row is missing
    //      either pick, so reaching here implies every row is complete.
    //   2. Legacy global apply — no rows selected; the admin wants to
    //      backfill onboarded-but-team-less channels using the globals.
    //      Here the globals are still required.
    if (selectedImports.length === 0 && (!defaultTeamSlug || !defaultAgentId)) {
      const missing: string[] = [];
      if (!defaultTeamSlug) missing.push("Preselected Team");
      if (!defaultAgentId) missing.push("Preselected Dynamic Agent");
      const reason = `Select ${missing.join(" and ")} in the "Default team and agent for new channels" section before running setup.`;
      setMessage(reason);
      toast(reason, "error");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      // The API still wants non-empty top-level team_slug/agent_id even
      // when per-row defaults supply the actual values, so fall back to
      // the first selected row's picks when the admin hasn't chosen
      // globals. Until the API contract is relaxed, this keeps the UX
      // honest: globals are optional pre-fills, not gates.
      const fallbackTeamSlug = defaultTeamSlug || selectedImports[0]?.team_slug || "";
      const fallbackAgentId = defaultAgentId || selectedImports[0]?.agent_id || "";
      const response = await fetch("/api/admin/slack/channels/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_slug: fallbackTeamSlug,
          agent_id: fallbackAgentId,
          create_routes: createDefaultRoutes,
          ...(selectedImports.length > 0
            ? {
                channel_defaults: selectedImports.map((channel) => ({
                  id: channel.id,
                  name: channel.name,
                  team_slug: channel.team_slug,
                  agent_id: channel.agent_id,
                })),
              }
            : {}),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{
        summary: SlackChannelDefaultsSummary;
      }>(await response.json());
      await Promise.all([loadChannels(), loadRoutes(), loadDiagnostics(), loadSlackRuntimeStatus()]);
      if (selectedImports.length > 0) {
        const selectedImportIds = new Set(selectedImports.map((channel) => channel.id));
        setDiscoveredImportRows((rows) =>
          rows.map((row) =>
            selectedImportIds.has(row.id) ? { ...row, is_existing: true, selected: false } : row
          )
        );
      }
      toast(
        selectedImports.length > 0
          ? `Discovered defaults applied: onboarded ${data.summary.channels_onboarded ?? 0} channels, assigned ${data.summary.channels_assigned_team} channels, ensured ${data.summary.channel_grants_ensured} channel grants, ensured ${data.summary.routes_ensured} routes, preserved ${data.summary.routes_preserved ?? 0} existing routes.`
          : `Slack channel association defaults applied: assigned ${data.summary.channels_assigned_team} channels, ensured ${data.summary.channel_grants_ensured} channel grants, ensured ${data.summary.routes_ensured} routes.`,
        "success"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to apply Slack channel association defaults";
      setMessage(errorMessage);
      toast(errorMessage, "error");
    } finally {
      setLoading(false);
    }
  };

  const diagnosticRouteIsFixable = (route: SlackRuntimeDiagnosticRoute) =>
    // The only auto-fixable issue is genuine drift: the route has
    // Mongo metadata but no OpenFGA tuple. listen=mention/message is
    // a deliberate admin choice, not a problem to "fix".
    route.route_metadata && !route.openfga_tuple;

  const fixDiagnosticRoute = async (route: SlackRuntimeDiagnosticRoute) => {
    if (!selected) return;
    if (!(route.route_metadata && !route.openfga_tuple)) return;
    setLoading(true);
    setMessage(null);
    try {
      const routeUrl = `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/routes`;
      const response = await fetch(routeUrl, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: route.agent_id }),
      });
      if (!response.ok) throw new Error(await response.text());
      await Promise.all([loadChannels(), loadRoutes(), loadDiagnostics()]);
      toast(`Removed stale route metadata for agent:${route.agent_id}.`, "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to fix agent:${route.agent_id}`);
    } finally {
      setLoading(false);
    }
  };

  const viewTitle: Record<SlackPanelView, string> = {
    channels: "Configured channels",
    onboard: "Onboard channels",
    advanced: "Advanced",
  };
  const viewDescription: Record<SlackPanelView, string> = {
    channels: "Channels CAIPE already knows about. Click a channel to manage its agents and diagnostics.",
    onboard: "Find Slack channels where the bot is installed and set them up.",
    advanced: "One-time YAML import and Slack bot runtime status. Most admins won't need this.",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {selfService ? "My Slack Channel Settings" : viewTitle[view]}
        </CardTitle>
        <CardDescription>
          {selfService
            ? "Manage bot routing behavior only for Slack channels where OpenFGA grants you channel admin access."
            : viewDescription[view]}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!selfService && (
          <div
            role="tablist"
            aria-label="Slack admin views"
            className="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-1"
          >
            {(Object.keys(viewTitle) as SlackPanelView[]).map((key) => (
              <Button
                key={key}
                role="tab"
                type="button"
                size="sm"
                variant={view === key ? "default" : "ghost"}
                aria-selected={view === key}
                onClick={() => setView(key)}
              >
                {viewTitle[key]}
              </Button>
            ))}
          </div>
        )}

        {(selfService || view === "onboard") && (
          <div className="space-y-2 rounded-md border p-3 text-sm text-muted-foreground">
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
            </div>
          </div>
        )}

        {!selfService && view === "advanced" && (
        <div
          role="region"
          aria-label="Advanced Setup - Import/Sync with Slackbot"
          data-section-tone="slate"
          className="rounded-md border border-slate-500/20 bg-slate-500/5 p-4 space-y-3"
        >
          <div>
            <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
              <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Import from Slackbot YAML
            </h3>
            <p className="text-xs text-muted-foreground">
              Inspect Slack bot runtime state, reload its in-memory cache, and run the one-time YAML→DB import.
            </p>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Route mode</div>
              <div className="font-medium">{slackRuntimeStatus?.route_mode ?? "unknown"}</div>
            </div>
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Static config</div>
              <div className="font-medium">
                {slackRuntimeStatus
                  ? `${slackRuntimeStatus.static_config.channels} channels / ${slackRuntimeStatus.static_config.routes} routes`
                  : "unknown"}
              </div>
            </div>
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Route cache</div>
              <div className="font-medium">
                {slackRuntimeStatus
                  ? `${slackRuntimeStatus.route_cache.cache_size} cached channel${slackRuntimeStatus.route_cache.cache_size === 1 ? "" : "s"}`
                  : "unknown"}
              </div>
              <div className="text-xs text-muted-foreground">
                TTL {slackRuntimeStatus?.route_cache.ttl_seconds ?? "?"}s
              </div>
            </div>
          </div>
          <div
            role="region"
            aria-label="Slackbot sync legend"
            className="grid gap-2 rounded-md border bg-background/50 p-3 text-xs text-muted-foreground md:grid-cols-2"
          >
            <div>
              <span className="font-medium text-foreground">Route mode:</span>{" "}
              shows whether the Slackbot reads routes from database, YAML, or both.
            </div>
            <div>
              <span className="font-medium text-foreground">Static config:</span>{" "}
              counts channel/routes currently loaded from Slackbot YAML.
            </div>
            <div>
              <span className="font-medium text-foreground">Route cache:</span>{" "}
              shows cached runtime channel routes and how soon they expire.
            </div>
            <div>
              <span className="font-medium text-foreground">Refresh Runtime Status:</span>{" "}
              reloads these status numbers from the running bot.
            </div>
            <div>
              <span className="font-medium text-foreground">Reload Bot Cache:</span>{" "}
              refreshes the running bot after UI route changes.
            </div>
            <div>
              <span className="font-medium text-foreground">Preview YAML Import:</span>{" "}
              shows planned changes without writing them.
            </div>
            <div className="md:col-span-2">
              <span className="font-medium text-foreground">Import from YAML Config:</span>{" "}
              writes YAML routes into CAIPE/OpenFGA.
            </div>
          </div>
          {runtimeSyncSummary && (
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div>
                {runtimeSyncSummary.dry_run
                  ? `Sync preview: ${runtimeSyncSummary.routes_planned} routes planned.`
                  : `Config sync applied: upserted ${runtimeSyncSummary.routes_upserted} routes.`}
              </div>
              Last sync {runtimeSyncSummary.dry_run ? "preview" : "apply"}:{" "}
              {runtimeSyncSummary.routes_planned} planned, {runtimeSyncSummary.routes_upserted} upserted,{" "}
              {runtimeSyncSummary.openfga_tuples_written} OpenFGA tuples.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={refreshSlackRuntimeStatus} disabled={disabled || loading}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh Runtime Status
            </Button>
            <Button type="button" variant="outline" onClick={reloadSlackBotRoutes} disabled={disabled || loading}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Reload Bot Cache
            </Button>
            <Button type="button" variant="outline" onClick={() => syncSlackBotConfig(true)} disabled={disabled || loading}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Preview YAML Import
            </Button>
            <Button type="button" onClick={() => syncSlackBotConfig(false)} disabled={disabled || loading}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Import from YAML Config
            </Button>
          </div>
        </div>
        )}

        <Dialog open={runtimeSyncModalOpen} onOpenChange={setRuntimeSyncModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {runtimeSyncModalMode === "preview"
                  ? "Slack Bot Config Sync Preview"
                  : "Slack Bot Config Sync Apply"}
              </DialogTitle>
              <DialogDescription>
                Preview reads the Slack bot&apos;s loaded static YAML config. Apply upserts matching
                MongoDB route metadata and channel-agent OpenFGA tuples without deleting UI-managed associations.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">
                  {runtimeSyncModalStatus === "loading"
                    ? runtimeSyncModalMode === "preview"
                      ? "Previewing..."
                      : "Applying..."
                    : runtimeSyncModalStatus === "success"
                      ? runtimeSyncModalMode === "preview"
                        ? "Preview complete"
                        : "Apply complete"
                      : runtimeSyncModalStatus === "error"
                        ? "Sync failed"
                        : "Ready"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {runtimeSyncModalStatus === "loading"
                    ? "Contacting the Slack bot admin API..."
                    : "Static config sync is upsert-only and leaves existing UI-managed associations in place."}
                </div>
              </div>

              {runtimeSyncModalError && (
                <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                  {runtimeSyncModalError}
                </div>
              )}

              {runtimeSyncSummary && (
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Channels</div>
                    <div className="font-medium">
                      {pluralize(runtimeSyncSummary.channels_seen, "channel")} scanned
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Planned routes</div>
                    <div className="font-medium">
                      {pluralize(runtimeSyncSummary.routes_planned, "route")} planned
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">MongoDB route metadata</div>
                    <div className="font-medium">
                      {pluralize(runtimeSyncSummary.routes_upserted, "route")} upserted
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">OpenFGA tuples</div>
                    <div className="font-medium">
                      {pluralize(runtimeSyncSummary.openfga_tuples_written, "OpenFGA tuple")} written
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRuntimeSyncModalOpen(false)}
                disabled={runtimeSyncModalStatus === "loading"}
              >
                Close
              </Button>
              {runtimeSyncModalMode === "preview" && runtimeSyncModalStatus === "success" && (
                <Button type="button" onClick={() => syncSlackBotConfig(false)} disabled={disabled || loading}>
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                  Import from YAML Config
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {!selfService && view === "onboard" && (
        <div
          role="region"
          aria-label="Default team and agent for new channels"
          data-section-tone="teal"
          className="rounded-md border border-teal-500/25 bg-teal-500/5 p-4 space-y-4"
        >
          <div>
            <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              Default team and agent for new channels
            </h3>
            <p className="text-xs text-muted-foreground">
              These pre-fill the picker for each discovered channel below. You can override per channel before applying.
            </p>
          </div>
          <div className="rounded-md border border-teal-500/15 bg-background/60 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">Last saved</span>
              {configuredDefaults?.source === "env" && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  from environment variable
                </span>
              )}
              {configuredDefaults?.source === "db" && configuredDefaults?.updated_at && (
                <span className="text-[10px] text-muted-foreground">
                  {new Date(configuredDefaults.updated_at).toLocaleString()}
                  {configuredDefaults?.updated_by ? ` · ${configuredDefaults.updated_by}` : ""}
                </span>
              )}
              {configuredDefaults?.source === "unset" && (
                <span className="text-[10px] text-muted-foreground">never saved</span>
              )}
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>
                <div className="text-muted-foreground">Onboarding team</div>
                <code>{configuredDefaults?.team_slug ? `team:${configuredDefaults.team_slug}` : "not configured"}</code>
              </div>
              <div>
                <div className="text-muted-foreground">Onboarding Dynamic Agent</div>
                <code>{configuredDefaults?.agent_id ? `agent:${configuredDefaults.agent_id}` : "not configured"}</code>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="slack-default-team">Preselected Team</Label>
              {/* Switched from native <select> to TeamPicker on
                  2026-05-27 — environments with hundreds of AWS-* /
                  SSO-* teams made the dropdown unusable. Same on-disk
                  contract (slug string); search by name or slug. */}
              <TeamPicker
                id="slack-default-team"
                value={defaultTeamSlug}
                onChange={setDefaultTeamSlug}
                disabled={disabled || teams.length === 0}
                placeholder={
                  teams.length === 0 ? "No teams configured" : "Select preselected team"
                }
                searchPlaceholder="Search teams..."
                options={teams.map<TeamPickerOption>((team) => ({
                  slug: team.slug,
                  name: team.name || team.slug,
                  id: team.id,
                  _id: team._id,
                }))}
              />
              {invalidDefaultTeamSlug && (
                <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
                  The saved default team <code>team:{invalidDefaultTeamSlug}</code> doesn&apos;t match any
                  current team. Pick one above. Update <code>SLACK_DEFAULT_TEAM_SLUG</code> in the
                  environment to make the new choice the default for next time.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="slack-default-agent">Preselected Dynamic Agent</Label>
              <select
                id="slack-default-agent"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={defaultAgentId}
                onChange={(event) => setDefaultAgentId(event.target.value)}
                disabled={disabled || dynamicAgents.length === 0}
              >
                <option value="">
                  {dynamicAgents.length === 0 ? "No enabled Dynamic Agents found" : "Select preselected Dynamic Agent"}
                </option>
                {sortedDynamicAgents.map((agent) => (
                  <option key={agent._id} value={agent._id}>
                    {agentLabel(agent)}
                  </option>
                ))}
              </select>
              {invalidDefaultAgentId && (
                <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
                  The saved default Dynamic Agent <code>agent:{invalidDefaultAgentId}</code> wasn&apos;t
                  found (or is disabled). Pick one above. Update <code>SLACK_DEFAULT_AGENT_ID</code> in
                  the environment to make the new choice the default for next time.
                </p>
              )}
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-md border border-teal-500/15 bg-background/60 p-3 text-sm">
            <input
              type="checkbox"
              checked={useSlackbotConfigDefaults}
              onChange={(event) => setUseSlackbotConfigDefaults(event.target.checked)}
              disabled={disabled}
            />
            <span>
              <span className="font-medium">Use existing Slackbot channel agents as defaults</span>
              <span className="block text-xs text-muted-foreground">
                Checked by default for migrations. Uncheck only if you want one selected Dynamic Agent for all discovered channels.
              </span>
            </span>
          </label>
          {/* Dedicated Save button — distinct from "Apply" on the
              import wizard. Persists to `platform_config`. The
              wizard's onboarding pipeline still uses whatever the
              admin has on screen, but you no longer need to run the
              pipeline just to durably remember a pick. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {associationDefaultsDirty && (
              <span
                role="status"
                className="text-[11px] text-amber-700 dark:text-amber-400"
              >
                Unsaved changes
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => void saveAssociationDefaults()}
              disabled={disabled || savingDefaults || !associationDefaultsDirty}
              aria-label="Save Slack onboarding defaults"
            >
              {savingDefaults ? "Saving…" : "Save defaults"}
            </Button>
          </div>
          {(teams.length === 0 || dynamicAgents.length === 0) && (
            <p className="text-xs text-muted-foreground">
              Configure a team or Dynamic Agent in the admin UI, then reload this page.
            </p>
          )}
        </div>
        )}

        {!selfService && view === "channels" && channels.length === 0 && (
          <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No channels configured yet.</p>
            <p className="mt-1">
              Switch to{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => setView("onboard")}
              >
                Onboard channels
              </button>{" "}
              to find Slack channels where the bot is installed and set them up.
            </p>
          </div>
        )}

        {(selfService || view === "channels") && channels.length > 0 && (
        <div
          role="region"
          aria-label="Configured Slack channels"
          className="rounded-md border bg-background/60 overflow-hidden"
        >
          {/* Cap at ~70% of the viewport so the table grows with the
              screen but never pushes the rest of the panel off the
              page. No min — short tables size to their rows so there's
              no dead whitespace below the last row. */}
          <div className="overflow-auto" style={{ maxHeight: "min(70vh, 100vh - 320px)" }}>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Channel</th>
                  <th className="px-3 py-2 text-left font-medium">Team</th>
                  <th className="px-3 py-2 text-left font-medium">Agents</th>
                  <th className="px-3 py-2 text-left font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((channel) => {
                    const key = `${channel.workspace_id}/${channel.channel_id}`;
                    const isSelected = key === selectedKey;
                    const grants = channel.active_grants ?? 0;
                    // Prefer the live diagnostics returned for the
                    // expanded row (they update as the admin clicks
                    // Fix-it / saves routes), otherwise use the
                    // server-summarized health from the list payload.
                    const warningsCount =
                      isSelected && diagnostics
                        ? diagnostics.warnings.length
                        : channel.health?.warnings_count;
                    const health =
                      typeof warningsCount === "number"
                        ? warningsCount > 0
                          ? {
                              label: `${warningsCount} issue${warningsCount === 1 ? "" : "s"}`,
                              className: "border-amber-300 bg-amber-50 text-amber-800",
                            }
                          : {
                              label: "healthy",
                              className: "border-emerald-300 bg-emerald-50 text-emerald-700",
                            }
                        : !channel.team_slug
                          ? { label: "no team", className: "border-amber-300 bg-amber-50 text-amber-800" }
                          : grants === 0
                            ? { label: "no agents", className: "border-amber-300 bg-amber-50 text-amber-800" }
                            : { label: "checking…", className: "border-slate-300 bg-slate-50 text-slate-600" };
                    const toggle = () => setSelectedKey(isSelected ? "" : key);
                    return (
                      <React.Fragment key={key}>
                        <tr
                          role="button"
                          tabIndex={0}
                          aria-expanded={isSelected}
                          onClick={toggle}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggle();
                            }
                          }}
                          className={cn(
                            "cursor-pointer border-t transition-colors hover:bg-muted/30 focus:bg-muted/30 focus:outline-none",
                            isSelected && "bg-muted/50",
                          )}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                  isSelected && "rotate-90",
                                )}
                                aria-hidden="true"
                              />
                              <div>
                                <div className="font-medium">#{channel.channel_name}</div>
                                <div className="text-xs text-muted-foreground">{channel.channel_id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {channel.team_slug ? (
                              <Badge variant="secondary">team:{channel.team_slug}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={grants === 0 ? "text-muted-foreground" : "font-medium"}>
                              {grants}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={health.className}>
                              {health.label}
                            </Badge>
                          </td>
                        </tr>
                        {isSelected && (
                          <tr className="border-t bg-muted/20">
                            <td colSpan={4} className="p-4">
                              <ChannelDetail
                                selected={channel}
                                diagnostics={diagnostics}
                                routes={routes}
                                dynamicAgents={dynamicAgents}
                                routeAgentId={routeAgentId}
                                setRouteAgentId={setRouteAgentId}
                                routeListen={routeListen}
                                setRouteListen={setRouteListen}
                                routePriority={routePriority}
                                setRoutePriority={setRoutePriority}
                                editingRouteAgentId={editingRouteAgentId}
                                resetRouteForm={resetRouteForm}
                                editRoute={editRoute}
                                saveRoute={saveRoute}
                                deleteRoute={setRoutePendingDelete}
                                fixDiagnosticRoute={fixDiagnosticRoute}
                                diagnosticRouteIsFixable={diagnosticRouteIsFixable}
                                disabled={disabled}
                                loading={loading}
                                selectedCanManage={selectedCanManage}
                                message={message}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                }
              </tbody>
            </table>
          </div>
        </div>
        )}

        {!selfService && view === "onboard" && (
        <ConnectorOnboardingWizard
          connectorName="Slack"
          provider="slack"
          isAdmin={!selfService}
          itemSingular="channel"
          itemPlural="channels"
          discoveredLabel="bot-member channel"
          findLabel="Find channels"
          refreshLabel="Refresh channels"
          loadingLabel="Finding channels…"
          emptyLabel="No bot-member channels were discovered."
          description="Find Slack channels where the bot is already installed, then set them up."
          discoveryStatusText={discoveryStatusText}
          discoveredCount={discoveredBotChannels.length}
          newCount={discoveredNewChannelCount}
          selectedCount={selectedDiscoveredImportRows.length}
          rows={discoveredImportRows.map((channel) => ({
            id: channel.id,
            name: `#${channel.name}`,
            secondary: [
              channel.id,
              typeof channel.num_members === "number" ? pluralize(channel.num_members, "member") : "",
            ].filter(Boolean).join(" · "),
            selected: channel.selected,
            teamSlug: channel.team_slug,
            agentId: channel.agent_id,
            isExisting: channel.is_existing,
            importLabel: `Import #${channel.name}`,
            teamLabel: `Team for #${channel.name}`,
            agentLabel: `Dynamic Agent for #${channel.name}`,
          }))}
          teams={teams.map((team) => ({ value: team.slug, label: team.name || team.slug }))}
          agents={sortedDynamicAgents.map((agent) => ({ value: agent._id, label: agent.name || agent._id }))}
          error={discoverDefaultsError}
          disabled={disabled}
          loading={loading}
          discovering={discoverDefaultsLoading}
          searchValue={discoverySearch}
          onSearchChange={setDiscoverySearch}
          enableBulkApply
          onDiscover={() => void discoverDefaults()}
          onSelectAll={() => setAllDiscoveredImportRowsSelected(true)}
          onClearSelection={() => setAllDiscoveredImportRowsSelected(false)}
          onRowChange={(channelId, updates) =>
            updateDiscoveredImportRow(channelId, {
              ...(typeof updates.selected === "boolean" ? { selected: updates.selected } : {}),
              ...(typeof updates.teamSlug === "string" ? { team_slug: updates.teamSlug } : {}),
              ...(typeof updates.agentId === "string" ? { agent_id: updates.agentId } : {}),
            })
          }
          onApply={() => void confirmMigrationDefaults(discoveredImportRows)}
        />
        )}

        <Dialog
          open={Boolean(routePendingDelete)}
          onOpenChange={(open) => {
            if (!open && !loading) setRoutePendingDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete channel-agent association?</DialogTitle>
              <DialogDescription>
                {routePendingDelete
                  ? `This removes agent:${routePendingDelete.agent_id} from the selected Slack channel.`
                  : "This removes the selected agent from the Slack channel."}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              The OpenFGA tuple will be deleted, and the saved Mongo route metadata for listen
              mode and priority will be deleted as well.
            </p>
            {routePendingDelete && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div>
                  <span className="font-medium">Listen:</span>{" "}
                  {routePendingDelete.users?.listen ?? "mention"}
                </div>
                <div>
                  <span className="font-medium">Priority:</span> {routePendingDelete.priority}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRoutePendingDelete(null)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={deleteRoute} disabled={loading}>
                {loading ? "Deleting..." : "Delete association"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
