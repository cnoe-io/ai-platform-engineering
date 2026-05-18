"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

interface SlackChannelSummary {
  workspace_id: string;
  channel_id: string;
  channel_name: string;
  team_slug?: string;
  active_grants: number;
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

export function SlackChannelRebacPanel({ disabled = false }: { disabled?: boolean }) {
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
  const [configuredDefaults, setConfiguredDefaults] = useState<SlackChannelAssociationDefaults | null>(null);
  const [slackRuntimeStatus, setSlackRuntimeStatus] = useState<SlackBotRuntimeStatus | null>(null);
  const [runtimeSyncSummary, setRuntimeSyncSummary] = useState<SlackBotRuntimeSyncSummary | null>(null);
  const [runtimeSyncModalOpen, setRuntimeSyncModalOpen] = useState(false);
  const [runtimeSyncModalMode, setRuntimeSyncModalMode] = useState<RuntimeSyncModalMode>("preview");
  const [runtimeSyncModalStatus, setRuntimeSyncModalStatus] = useState<RuntimeSyncModalStatus>("idle");
  const [runtimeSyncModalError, setRuntimeSyncModalError] = useState<string | null>(null);
  const [createDefaultRoutes, setCreateDefaultRoutes] = useState(true);
  const [routeListen, setRouteListen] = useState<"message" | "mention" | "all">("mention");
  const [routePriority, setRoutePriority] = useState(100);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [migrationConfirmOpen, setMigrationConfirmOpen] = useState(false);

  const selected = useMemo(
    () => channels.find((channel) => `${channel.workspace_id}/${channel.channel_id}` === selectedKey),
    [channels, selectedKey]
  );
  const unassignedChannelCount = useMemo(
    () => channels.filter((channel) => !channel.team_slug).length,
    [channels]
  );

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/slack/channels");
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{ channels: SlackChannelSummary[] }>(await response.json());
      setChannels(data.channels ?? []);
      if (!selectedKey && data.channels?.[0]) {
        setSelectedKey(`${data.channels[0].workspace_id}/${data.channels[0].channel_id}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channels");
    } finally {
      setLoading(false);
    }
  }, [selectedKey]);

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
    if (data.defaults?.team_slug) setDefaultTeamSlug((current) => current || data.defaults.team_slug);
    if (data.defaults?.agent_id) setDefaultAgentId((current) => current || data.defaults.agent_id);
    if (typeof data.defaults?.create_routes === "boolean") {
      setCreateDefaultRoutes(data.defaults.create_routes);
    }
  }, []);

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
    void loadTeams().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load teams")
    );
  }, [loadTeams]);

  useEffect(() => {
    void loadAssociationDefaults().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channel association defaults")
    );
  }, [loadAssociationDefaults]);

  useEffect(() => {
    void loadSlackRuntimeStatus().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack bot runtime status")
    );
  }, [loadSlackRuntimeStatus]);

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
      setMessage(
        editingRouteAgentId
          ? "Slack channel-agent association updated."
          : "Slack channel-agent association created."
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
      setMessage("Slack channel-agent association deleted.");
      await Promise.all([loadChannels(), loadRoutes(), loadDiagnostics()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete Slack association");
    } finally {
      setLoading(false);
    }
  };

  const refreshDefaults = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([loadChannels(), loadDynamicAgents(), loadTeams(), loadAssociationDefaults()]);
      setMessage("Slack channel association default lists refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to refresh Slack channel association defaults");
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
      setMessage("Slack bot route cache reloaded.");
      await loadSlackRuntimeStatus();
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
      setMessage(
        dryRun
          ? `Sync preview: ${data.routes_planned} routes planned from ${data.channels_seen} channels.`
          : `Config sync applied: upserted ${data.routes_upserted} routes and wrote ${data.openfga_tuples_written} OpenFGA tuples.`
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

  const applyMigrationDefaults = () => {
    if (!defaultTeamSlug || !defaultAgentId) return;
    setMigrationConfirmOpen(true);
  };

  const confirmMigrationDefaults = async () => {
    if (!defaultTeamSlug || !defaultAgentId) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/slack/channels/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_slug: defaultTeamSlug,
          agent_id: defaultAgentId,
          create_routes: createDefaultRoutes,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{
        summary: {
          channels_seen: number;
          channels_assigned_team: number;
          channel_grants_ensured: number;
          routes_ensured: number;
        };
      }>(await response.json());
      await Promise.all([loadChannels(), loadRoutes(), loadDiagnostics()]);
      setMessage(
        `Slack channel association defaults applied: assigned ${data.summary.channels_assigned_team} channels, ensured ${data.summary.channel_grants_ensured} channel grants, ensured ${data.summary.routes_ensured} routes.`
      );
      setMigrationConfirmOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply Slack channel association defaults");
    } finally {
      setLoading(false);
    }
  };

  const diagnosticRouteIsFixable = (route: SlackRuntimeDiagnosticRoute) =>
    (route.route_metadata && !route.openfga_tuple) ||
    (route.openfga_tuple && route.listen !== "all");

  const fixDiagnosticRoute = async (route: SlackRuntimeDiagnosticRoute) => {
    if (!selected) return;
    setLoading(true);
    setMessage(null);
    try {
      const routeUrl = `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/routes`;
      if (route.route_metadata && !route.openfga_tuple) {
        const response = await fetch(routeUrl, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: route.agent_id }),
        });
        if (!response.ok) throw new Error(await response.text());
        setMessage(`Removed stale route metadata for agent:${route.agent_id}.`);
        await Promise.all([loadChannels(), loadRoutes(), loadDiagnostics()]);
        return;
      }

      const currentRoute = routes.find((candidate) => candidate.agent_id === route.agent_id);
      const nextRoutes = [
        ...routes.filter((candidate) => candidate.agent_id !== route.agent_id),
        {
          agent_id: route.agent_id,
          enabled: true,
          priority: currentRoute?.priority ?? 100,
          users: { enabled: true, listen: "all" as const },
        },
      ];
      const response = await fetch(routeUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: nextRoutes }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{ routes: SlackChannelAgentRoute[] }>(await response.json());
      setRoutes(data.routes ?? []);
      setMessage(`Updated agent:${route.agent_id} to listen to mentions and plain messages.`);
      await Promise.all([loadChannels(), loadDiagnostics()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to fix agent:${route.agent_id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack Channel Agent Associations</CardTitle>
        <CardDescription>
          Control which Dynamic Agents a Slack channel may invoke. OpenFGA is the source of
          truth; Mongo stores only dependent listen and priority metadata.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          Slack authorization has two checks before dispatch: the channel must have
          <code className="mx-1">can_use agent:&lt;id&gt;</code>, and the user's active
          team must also have <code className="mx-1">can_use agent:&lt;id&gt;</code>.
          If either check fails, the Slack bot denies the request before calling the agent.
        </div>

        <div className="rounded-md border p-4 space-y-3">
          <div>
            <Label>Slack Bot Runtime Sync</Label>
            <p className="text-xs text-muted-foreground">
              Inspect the running Slack bot route cache, force a reload, or migrate the
              bot's static YAML channel config into MongoDB/OpenFGA.
            </p>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Route mode</div>
              <div className="font-medium">{slackRuntimeStatus?.route_mode ?? "unknown"}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Static config</div>
              <div className="font-medium">
                {slackRuntimeStatus
                  ? `${slackRuntimeStatus.static_config.channels} channels / ${slackRuntimeStatus.static_config.routes} routes`
                  : "unknown"}
              </div>
            </div>
            <div className="rounded-md border p-3">
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
            <Button type="button" variant="outline" onClick={loadSlackRuntimeStatus} disabled={disabled || loading}>
              Refresh Runtime Status
            </Button>
            <Button type="button" variant="outline" onClick={reloadSlackBotRoutes} disabled={disabled || loading}>
              Reload Slack Bot Routes
            </Button>
            <Button type="button" variant="outline" onClick={() => syncSlackBotConfig(true)} disabled={disabled || loading}>
              Preview Sync From Config
            </Button>
            <Button type="button" onClick={() => syncSlackBotConfig(false)} disabled={disabled || loading}>
              Apply Sync From Config
            </Button>
          </div>
        </div>

        <Dialog open={runtimeSyncModalOpen} onOpenChange={setRuntimeSyncModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {runtimeSyncModalMode === "preview"
                  ? "Slack Bot Config Sync Preview"
                  : "Slack Bot Config Sync Apply"}
              </DialogTitle>
              <DialogDescription>
                Preview reads the Slack bot's loaded static YAML config. Apply upserts matching
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
                  Apply This Sync
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="rounded-md border p-4 space-y-3">
          <div>
            <Label>Slack Channel Association Default</Label>
            <p className="text-xs text-muted-foreground">
              Use this to assign unconfigured Slack channels to the configured default team
              and grant onboarded channels access to the configured default Dynamic Agent.
            </p>
          </div>
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs md:grid-cols-2">
            <div>
              <div className="text-muted-foreground">Current default team</div>
              <code>{configuredDefaults?.team_slug ? `team:${configuredDefaults.team_slug}` : "not configured"}</code>
            </div>
            <div>
              <div className="text-muted-foreground">Current default Dynamic Agent</div>
              <code>{configuredDefaults?.agent_id ? `agent:${configuredDefaults.agent_id}` : "not configured"}</code>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="slack-default-team">Default Team</Label>
              <select
                id="slack-default-team"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={defaultTeamSlug}
                onChange={(event) => setDefaultTeamSlug(event.target.value)}
                disabled={disabled || teams.length === 0}
              >
                <option value="">{teams.length === 0 ? "No teams configured" : "Select default team"}</option>
                {teams.map((team) => (
                  <option key={team.slug || team.id || team._id} value={team.slug}>
                    {team.name || team.slug} ({team.slug})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slack-default-agent">Default Dynamic Agent</Label>
              <select
                id="slack-default-agent"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={defaultAgentId}
                onChange={(event) => setDefaultAgentId(event.target.value)}
                disabled={disabled || dynamicAgents.length === 0}
              >
                <option value="">
                  {dynamicAgents.length === 0 ? "No enabled Dynamic Agents found" : "Select default Dynamic Agent"}
                </option>
                {dynamicAgents.map((agent) => (
                  <option key={agent._id} value={agent._id}>
                    {agentLabel(agent)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {(teams.length === 0 || dynamicAgents.length === 0) && (
            <p className="text-xs text-muted-foreground">
              Configure a team or Dynamic Agent in the admin UI, then use Refresh lists to reload this menu.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createDefaultRoutes}
              onChange={(event) => setCreateDefaultRoutes(event.target.checked)}
              disabled={disabled}
            />
            Create matching Slack routes for the default Dynamic Agent
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={applyMigrationDefaults}
              disabled={disabled || loading || !defaultTeamSlug || !defaultAgentId || channels.length === 0}
            >
              {loading ? "Applying..." : "Apply Defaults To Slack Channels"}
            </Button>
            <Button type="button" variant="outline" onClick={refreshDefaults} disabled={disabled || loading}>
              Refresh lists
            </Button>
            <span className="text-xs text-muted-foreground">
              {channels.length} channels loaded, {unassignedChannelCount} without a team.
            </span>
          </div>
        </div>

        <Dialog open={migrationConfirmOpen} onOpenChange={setMigrationConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Apply Slack channel association defaults?</DialogTitle>
              <DialogDescription>
                This will update {channels.length} onboarded Slack channel{channels.length === 1 ? "" : "s"}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
              <div>
                <span className="font-medium">Default team:</span>{" "}
                <code>team:{defaultTeamSlug}</code>
              </div>
              <div>
                <span className="font-medium">Default Dynamic Agent:</span>{" "}
                <code>agent:{defaultAgentId}</code>
              </div>
              <div>
                <span className="font-medium">Unassigned channels:</span>{" "}
                {unassignedChannelCount}
              </div>
              <div>
                <span className="font-medium">Routes:</span>{" "}
                {createDefaultRoutes ? "Create matching Slack routes" : "Do not create Slack routes"}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This ensures channel grants and the default team grant in OpenFGA. Existing grants are left in place.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMigrationConfirmOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="button" onClick={confirmMigrationDefaults} disabled={loading}>
                {loading ? "Applying..." : "Apply defaults"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="slack-channel-select">Channel</Label>
            <select
              id="slack-channel-select"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              <option value="">Select a channel</option>
              {channels.map((channel) => (
                <option
                  key={`${channel.workspace_id}/${channel.channel_id}`}
                  value={`${channel.workspace_id}/${channel.channel_id}`}
                >
                  {channel.channel_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Selected Scope</Label>
            <div className="rounded-md border p-3 text-sm">
              {selected ? (
                <>
                  <div className="font-medium">{selected.channel_name}</div>
                  <div className="text-muted-foreground">
                    {selected.channel_id}
                  </div>
                  {selected.team_slug && <Badge variant="secondary">team:{selected.team_slug}</Badge>}
                </>
              ) : (
                <span className="text-muted-foreground">No channel selected</span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-md border p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Label>Slack Runtime Diagnostics</Label>
              <p className="text-xs text-muted-foreground">
                Preflight checks for the selected channel using the same OpenFGA tuple and route metadata shape the Slack bot depends on.
              </p>
            </div>
            {diagnostics && (
              <Badge variant={diagnostics.warnings.length > 0 ? "outline" : "default"}>
                {diagnostics.warnings.length > 0 ? `${diagnostics.warnings.length} warning${diagnostics.warnings.length === 1 ? "" : "s"}` : "healthy"}
              </Badge>
            )}
          </div>
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a Slack channel to run diagnostics.</p>
          ) : !diagnostics ? (
            <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
          ) : (
            <>
              <div className="grid gap-2 text-sm md:grid-cols-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">OpenFGA</div>
                  <div className="font-medium">{diagnostics.openfga.reachable ? "reachable" : "unreachable"}</div>
                  <div className="text-xs text-muted-foreground">{diagnostics.openfga.tuple_count} channel-agent tuples</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Runtime Routes</div>
                  <div className="font-medium">{diagnostics.routes.length}</div>
                  <div className="text-xs text-muted-foreground">OpenFGA-backed candidates</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Last Error</div>
                  <div className="font-medium">{diagnostics.last_runtime_error?.reason_code ?? "none"}</div>
                  <div className="text-xs text-muted-foreground">{diagnostics.last_runtime_error?.ts ?? "No recent runtime error"}</div>
                </div>
              </div>
              {diagnostics.warnings.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
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
                    <div key={route.agent_id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
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
                          disabled={disabled || loading}
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

        <div className="rounded-md border p-4 space-y-3">
          <div>
            <Label>Channel-Agent Associations</Label>
            <p className="text-xs text-muted-foreground">
              Creating an association writes the OpenFGA channel <code>can_use agent</code>{" "}
              tuple. Listen mode and priority are saved as dependent route metadata.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="slack-route-agent-id">Dynamic Agent</Label>
              <select
                id="slack-route-agent-id"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={routeAgentId}
                onChange={(event) => setRouteAgentId(event.target.value)}
                disabled={disabled || dynamicAgents.length === 0}
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
                disabled={disabled}
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
                disabled={disabled}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveRoute} disabled={disabled || loading || !selected || !routeAgentId.trim()}>
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span>agent:{route.agent_id}</span>
                    <Badge>{route.users?.listen ?? "mention"} / priority {route.priority}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => editRoute(route)}
                      disabled={disabled || loading}
                      aria-label={`Edit agent:${route.agent_id}`}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setRoutePendingDelete(route)}
                      disabled={disabled || loading}
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
