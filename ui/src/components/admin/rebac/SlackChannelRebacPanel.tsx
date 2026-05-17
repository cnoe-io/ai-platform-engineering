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
import type { UniversalRebacResourceAction } from "@/types/rbac-universal";

interface SlackChannelSummary {
  workspace_id: string;
  channel_id: string;
  channel_name: string;
  team_slug?: string;
  active_grants: number;
}

interface SlackChannelGrant {
  resource: { type: string; id: string };
  actions: UniversalRebacResourceAction[];
  status: string;
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

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function agentLabel(agent: DynamicAgentOption): string {
  return `${agent.name || agent._id} (${agent._id})`;
}

export function SlackChannelRebacPanel({ disabled = false }: { disabled?: boolean }) {
  const [channels, setChannels] = useState<SlackChannelSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [grants, setGrants] = useState<SlackChannelGrant[]>([]);
  const [routes, setRoutes] = useState<SlackChannelAgentRoute[]>([]);
  const [dynamicAgents, setDynamicAgents] = useState<DynamicAgentOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [routeAgentId, setRouteAgentId] = useState("");
  const [defaultTeamSlug, setDefaultTeamSlug] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState("");
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
  const activeAgentGrants = useMemo(
    () => grants.filter((grant) => grant.resource.type === "agent"),
    [grants]
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

  const loadGrants = useCallback(async () => {
    if (!selected) return;
    const response = await fetch(
      `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/resources`
    );
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ grants: SlackChannelGrant[] }>(await response.json());
    setGrants(data.grants ?? []);
  }, [selected]);

  const loadRoutes = useCallback(async () => {
    if (!selected) return;
    const response = await fetch(
      `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/routes`
    );
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ routes: SlackChannelAgentRoute[] }>(await response.json());
    setRoutes(data.routes ?? []);
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
    void loadGrants().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channel grants")
    );
  }, [loadGrants]);

  useEffect(() => {
    void loadRoutes().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channel routes")
    );
  }, [loadRoutes]);

  const saveGrant = async () => {
    if (!selected || !resourceId.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const agentGrant: SlackChannelGrant = {
        resource: { type: "agent", id: resourceId.trim() },
        actions: ["use"],
        status: "active",
      };
      const nextGrants = [
        ...grants.filter(
          (grant) => !(grant.resource.type === "agent" && grant.resource.id === resourceId.trim())
        ),
        agentGrant,
      ];
      const response = await fetch(
        `/api/admin/slack/channels/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.channel_id)}/resources`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grants: nextGrants }),
        }
      );
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{ grants: SlackChannelGrant[] }>(await response.json());
      setGrants(data.grants ?? []);
      setResourceId("");
      setMessage("Slack channel grants updated.");
      await loadChannels();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Slack channel grant");
    } finally {
      setLoading(false);
    }
  };

  const saveRoute = async () => {
    if (!selected || !routeAgentId.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const agentId = routeAgentId.trim();
      const nextRoutes = [
        ...routes.filter((route) => route.agent_id !== agentId),
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
      setRouteAgentId("");
      setMessage("Slack route saved and matching OpenFGA channel grant created.");
      await Promise.all([loadChannels(), loadGrants()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save Slack route");
    } finally {
      setLoading(false);
    }
  };

  const refreshDefaults = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([loadChannels(), loadDynamicAgents(), loadTeams()]);
      setMessage("Migration default lists refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to refresh migration defaults");
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
      await Promise.all([loadChannels(), loadGrants(), loadRoutes()]);
      setMessage(
        `Migration defaults applied: assigned ${data.summary.channels_assigned_team} channels, ensured ${data.summary.channel_grants_ensured} channel grants, ensured ${data.summary.routes_ensured} routes.`
      );
      setMigrationConfirmOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply migration defaults");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack Channel Agent Grants</CardTitle>
        <CardDescription>
          Control which Dynamic Agents a Slack channel may invoke. Slack runtime only enforces
          Dynamic Agent access today.
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
            <Label>Migration Defaults</Label>
            <p className="text-xs text-muted-foreground">
              Use this during onboarding to assign unconfigured Slack channels to a default team and
              grant every onboarded channel access to a default Dynamic Agent.
            </p>
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
              <DialogTitle>Apply migration defaults?</DialogTitle>
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
                  {channel.channel_name} ({channel.active_grants} grants)
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

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="slack-resource-agent-id">Dynamic Agent</Label>
            <select
              id="slack-resource-agent-id"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
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
        </div>

        <Button onClick={saveGrant} disabled={disabled || loading || !selected || !resourceId.trim()}>
          {loading ? "Saving..." : "Grant Agent To Channel"}
        </Button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <div className="rounded-md border p-4 space-y-3">
          <div>
            <Label>Agent Routes</Label>
            <p className="text-xs text-muted-foreground">
              Creating a route automatically creates the matching channel <code>can_use agent</code> grant.
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
          <Button onClick={saveRoute} disabled={disabled || loading || !selected || !routeAgentId.trim()}>
            {loading ? "Saving..." : "Create Route + Grant"}
          </Button>
          {routes.length > 0 && (
            <div className="space-y-2">
              {routes.map((route) => (
                <div key={route.agent_id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <span>agent:{route.agent_id}</span>
                  <Badge>{route.users?.listen ?? "mention"} / priority {route.priority}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Active Agent Grants</Label>
          {activeAgentGrants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents granted to this channel yet.</p>
          ) : (
            <div className="space-y-2">
              {activeAgentGrants.map((grant) => (
                <div
                  key={`${grant.resource.type}:${grant.resource.id}:${grant.actions.join(",")}`}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <span>
                    {grant.resource.type}:{grant.resource.id}
                  </span>
                  <Badge>{grant.actions.join(", ")}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
