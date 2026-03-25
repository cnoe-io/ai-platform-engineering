"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Plus, Trash2, AlertTriangle, Layers } from "lucide-react";

interface ChannelMapping {
  _id: string;
  slack_channel_id: string;
  channel_name: string;
  team_id: string;
  team_name?: string;
  slack_workspace_id?: string;
  created_by?: string;
  created_at?: string;
  active: boolean;
}

interface TeamOption {
  _id: string;
  name: string;
}

interface SlackChannelMappingTabProps {
  isAdmin: boolean;
}

export function SlackChannelMappingTab({ isAdmin }: SlackChannelMappingTabProps) {
  const [mappings, setMappings] = useState<ChannelMapping[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newChannelId, setNewChannelId] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newTeamId, setNewTeamId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mapRes, teamRes] = await Promise.all([
        fetch("/api/admin/slack/channel-mappings"),
        fetch("/api/admin/teams"),
      ]);
      const mapJson = await mapRes.json();
      const teamJson = await teamRes.json();

      if (!mapJson.success) throw new Error(mapJson.error || "Failed to load mappings");
      setMappings(mapJson.data?.items ?? mapJson.data ?? []);

      if (teamJson.success) {
        setTeams(
          (teamJson.data?.teams ?? []).map((t: TeamOption) => ({
            _id: t._id,
            name: t.name,
          }))
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!newChannelId.trim() || !newTeamId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/slack/channel-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slack_channel_id: newChannelId.trim(),
          channel_name: newChannelName.trim() || newChannelId.trim(),
          team_id: newTeamId,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Create failed");
      setNewChannelId("");
      setNewChannelName("");
      setNewTeamId("");
      setShowAdd(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm("Remove this channel-to-team mapping?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/slack/channel-mappings?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Delete failed");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Channel-to-team mappings
          </CardTitle>
          <CardDescription>
            Map Slack channels to teams so the bot scopes requests to the correct team context
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setShowAdd(!showAdd)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add mapping
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        {showAdd && isAdmin && (
          <div className="mb-4 p-4 border border-border rounded-lg bg-muted/30 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Slack Channel ID</label>
                <input
                  type="text"
                  value={newChannelId}
                  onChange={(e) => setNewChannelId(e.target.value)}
                  placeholder="C0123456789"
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Channel name</label>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="#general"
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Team</label>
                <select
                  value={newTeamId}
                  onChange={(e) => setNewTeamId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select team...</option>
                  {teams.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!newChannelId.trim() || !newTeamId || creating}
                onClick={handleCreate}
                className="gap-1"
              >
                {creating && <Loader2 className="h-3 w-3 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        )}

        {loading && mappings.length === 0 ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-md bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th className="p-3 whitespace-nowrap">Channel</th>
                  <th className="p-3 whitespace-nowrap">Channel ID</th>
                  <th className="p-3 whitespace-nowrap">Team</th>
                  <th className="p-3 whitespace-nowrap">Created by</th>
                  <th className="p-3 whitespace-nowrap">Created</th>
                  <th className="p-3 whitespace-nowrap">Status</th>
                  {isAdmin && <th className="p-3 whitespace-nowrap text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m._id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="p-3 font-medium">{m.channel_name || "—"}</td>
                    <td className="p-3 font-mono text-xs">{m.slack_channel_id}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        {m.team_name || m.team_id}
                        {!m.team_name && m.active && (
                          <span title="Team may have been deleted">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{m.created_by || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3">
                      {m.active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                          Inactive
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="p-3 text-right">
                        {m.active && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive"
                            disabled={busyId === m._id}
                            onClick={() => void handleRemove(m._id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {mappings.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                No channel-to-team mappings configured yet.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
