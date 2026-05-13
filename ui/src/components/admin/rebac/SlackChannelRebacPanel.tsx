"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UniversalRebacResourceAction } from "@/types/rbac-universal";

type GrantType = "agent" | "tool" | "knowledge_base" | "skill" | "task";

interface SlackChannelSummary {
  workspace_id: string;
  channel_id: string;
  channel_name: string;
  team_slug?: string;
  active_grants: number;
}

interface SlackChannelGrant {
  resource: { type: GrantType; id: string };
  actions: UniversalRebacResourceAction[];
  status: string;
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

export function SlackChannelRebacPanel({ disabled = false }: { disabled?: boolean }) {
  const [channels, setChannels] = useState<SlackChannelSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [grants, setGrants] = useState<SlackChannelGrant[]>([]);
  const [resourceType, setResourceType] = useState<GrantType>("agent");
  const [resourceId, setResourceId] = useState("");
  const [action, setAction] = useState<UniversalRebacResourceAction>("use");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => channels.find((channel) => `${channel.workspace_id}/${channel.channel_id}` === selectedKey),
    [channels, selectedKey]
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

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    void loadGrants().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Slack channel grants")
    );
  }, [loadGrants]);

  const saveGrant = async () => {
    if (!selected || !resourceId.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const nextGrants = [
        ...grants.filter(
          (grant) => !(grant.resource.type === resourceType && grant.resource.id === resourceId.trim())
        ),
        { resource: { type: resourceType, id: resourceId.trim() }, actions: [action], status: "active" },
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack Channel Resource Grants</CardTitle>
        <CardDescription>
          Grant each Slack channel access to multiple agents, tools, and knowledge bases. Runtime
          Slack requests must pass both this channel grant and the user's resource grant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
                    {selected.workspace_id}/{selected.channel_id}
                  </div>
                  {selected.team_slug && <Badge variant="secondary">team:{selected.team_slug}</Badge>}
                </>
              ) : (
                <span className="text-muted-foreground">No channel selected</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Resource Type</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value as GrantType)}
              disabled={disabled}
            >
              <option value="agent">Agent</option>
              <option value="tool">Tool</option>
              <option value="knowledge_base">Knowledge base</option>
              <option value="skill">Skill</option>
              <option value="task">Task</option>
            </select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="slack-resource-id">Resource ID</Label>
            <Input
              id="slack-resource-id"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              placeholder="incident-agent"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label>Action</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={action}
              onChange={(event) => setAction(event.target.value as UniversalRebacResourceAction)}
              disabled={disabled}
            >
              <option value="use">use</option>
              <option value="read">read</option>
              <option value="call">call</option>
              <option value="ingest">ingest</option>
            </select>
          </div>
        </div>

        <Button onClick={saveGrant} disabled={disabled || loading || !selected || !resourceId.trim()}>
          {loading ? "Saving..." : "Grant Resource To Channel"}
        </Button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <div className="space-y-2">
          <Label>Active Grants</Label>
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resources granted to this channel yet.</p>
          ) : (
            <div className="space-y-2">
              {grants.map((grant) => (
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
