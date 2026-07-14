"use client";

import { Loader2, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { DynamicAgentOption } from "./connector-admin-adapter";

type DmAccessMode = "disabled" | "allowlist" | "all_users";

interface BotOption {
  id: string;
  name: string;
  available: boolean;
}

interface DirectUserRow {
  keycloak_user_id: string;
  email: string;
  display_name: string;
  webex_user_id: string | null;
  enabled: boolean;
  configured: boolean;
  expected_webex_email: string;
  agent_id: string;
}

interface DirectUsersResponse {
  users: DirectUserRow[];
  deployment_id: string;
  bot_id: string;
  dm_access_mode: DmAccessMode;
  default_agent_id: string | null;
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${fallback}: ${response.status}`;
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
    const detail = typeof payload.error === "string" ? payload.error
      : typeof payload.message === "string" ? payload.message : "";
    return detail || `${fallback}: ${response.status}`;
  } catch {
    return text;
  }
}

export function WebexDirectUsersPanel({ disabled = false }: { disabled?: boolean }) {
  const { toast } = useToast();
  const [bots, setBots] = useState<BotOption[]>([]);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [agents, setAgents] = useState<DynamicAgentOption[]>([]);
  const [data, setData] = useState<DirectUsersResponse | null>(null);
  const [rows, setRows] = useState<DirectUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/admin/webex/bots", { cache: "no-store" }),
      fetch("/api/dynamic-agents?enabled_only=true", { cache: "no-store" }),
    ]).then(async ([botsResponse, agentsResponse]) => {
      if (!botsResponse.ok) throw new Error(await responseError(botsResponse, "Failed to load Webex bots"));
      if (!agentsResponse.ok) throw new Error(await responseError(agentsResponse, "Failed to load agents"));
      const botData = apiData<{ bots: BotOption[] }>(await botsResponse.json());
      const agentData = apiData<{ items: DynamicAgentOption[] }>(await agentsResponse.json());
      if (!active) return;
      const nextBots = botData.bots ?? [];
      setBots(nextBots);
      setSelectedBotId((current) =>
        nextBots.some((bot) => bot.id === current && bot.available)
          ? current
          : nextBots.find((bot) => bot.available)?.id ?? "",
      );
      setAgents(agentData.items ?? []);
    }).catch((reason) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : "Failed to load 1:1 settings");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  const loadUsers = useCallback(async (botId: string) => {
    if (!botId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ bot_id: botId });
      const response = await fetch(`/api/admin/webex/direct-users?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response, "Failed to load deployment users"));
      const next = apiData<DirectUsersResponse>(await response.json());
      setData(next);
      setRows(next.users ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load deployment users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBotId) void loadUsers(selectedBotId);
  }, [loadUsers, selectedBotId]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => `${row.display_name} ${row.email}`.toLowerCase().includes(query));
  }, [rows, search]);

  const updateRow = (userId: string, patch: Partial<DirectUserRow>) => {
    setRows((current) => current.map((row) => row.keycloak_user_id === userId ? { ...row, ...patch } : row));
  };

  const saveRow = async (row: DirectUserRow) => {
    if (!data) return;
    if (!selectedBotId) {
      toast("Select a Webex bot first.", "error");
      return;
    }
    if (row.enabled && !row.agent_id) {
      toast("Select an agent before enabling this user.", "error");
      return;
    }
    setSavingUserId(row.keycloak_user_id);
    try {
      const shouldDelete = data.dm_access_mode === "allowlist" ? !row.enabled : !row.agent_id;
      const response = await fetch("/api/admin/webex/direct-users", {
        method: shouldDelete ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_id: selectedBotId,
          keycloak_user_id: row.keycloak_user_id,
          agent_id: row.agent_id,
          expected_webex_email: row.expected_webex_email,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Failed to save 1:1 access"));
      toast(shouldDelete ? `Removed 1:1 routing for ${row.email}.` : `Saved 1:1 routing for ${row.email}.`, "success");
      await loadUsers(selectedBotId);
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Failed to save 1:1 access", "error");
    } finally {
      setSavingUserId(null);
    }
  };

  const modeLabel = data?.dm_access_mode === "all_users" ? "All deployment users"
    : data?.dm_access_mode === "allowlist" ? "Allowlist" : "Disabled";

  return (
    <div className="space-y-3" role="region" aria-label="Webex 1:1 message access">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-64 flex-col gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Webex bot</span>
            <select
              className="h-8 bg-transparent text-sm font-medium outline-none"
              value={selectedBotId}
              onChange={(event) => {
                setSelectedBotId(event.target.value);
                setData(null);
                setRows([]);
              }}
              disabled={disabled || savingUserId !== null}
              aria-label="Webex bot"
            >
              <option value="">Select a bot</option>
              {bots.filter((bot) => bot.available).map((bot) => (
                <option key={bot.id} value={bot.id}>{bot.name}</option>
              ))}
            </select>
          </label>
          <Badge variant={data?.dm_access_mode === "disabled" ? "outline" : "secondary"}>{modeLabel}</Badge>
          {data && <span className="pb-1 text-xs text-muted-foreground">Deployment: {data.deployment_id}</span>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadUsers(selectedBotId)} disabled={disabled || loading || !selectedBotId}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}
      {data?.dm_access_mode === "disabled" && (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          Direct messages are disabled for this deployment.
        </div>
      )}

      <div className="rounded-md border bg-background/60">
        <div className="border-b p-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search deployment users" aria-label="Search deployment users" />
        </div>
        {loading ? (
          <div className="flex min-h-40 items-center justify-center"><CAIPESpinner size="sm" /></div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/90 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-24 px-3 py-2 text-left font-medium">Allowed</th>
                  <th className="px-3 py-2 text-left font-medium">User</th>
                  <th className="px-3 py-2 text-left font-medium">Webex identity</th>
                  <th className="px-3 py-2 text-left font-medium">Agent</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const saving = savingUserId === row.keycloak_user_id;
                  const modeDisabled = data?.dm_access_mode === "disabled";
                  return (
                    <tr key={row.keycloak_user_id} className="border-t align-middle">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={row.enabled}
                          onChange={(event) => updateRow(row.keycloak_user_id, { enabled: event.target.checked })}
                          disabled={disabled || modeDisabled || data?.dm_access_mode === "all_users" || saving}
                          aria-label={`Allow direct messages for ${row.email}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.display_name}</div>
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          className="h-8 min-w-56"
                          value={row.expected_webex_email}
                          onChange={(event) => updateRow(row.keycloak_user_id, { expected_webex_email: event.target.value })}
                          disabled={disabled || modeDisabled || saving}
                          aria-label={`Webex email for ${row.email}`}
                        />
                        <div className="mt-1 text-xs text-muted-foreground">{row.webex_user_id ? "Linked" : "Not linked yet"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-8 min-w-56 rounded-md border bg-background px-2 text-sm"
                          value={row.agent_id}
                          onChange={(event) => updateRow(row.keycloak_user_id, { agent_id: event.target.value })}
                          disabled={disabled || modeDisabled || saving || (!row.enabled && data?.dm_access_mode === "allowlist")}
                          aria-label={`Agent for ${row.email}`}
                        >
                          <option value="">{data?.dm_access_mode === "all_users" ? "Deployment default" : "Select an agent"}</option>
                          {agents.map((agent) => <option key={agent._id} value={agent._id}>{agent.name || agent._id}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" size="icon" variant="ghost" title="Save 1:1 access" onClick={() => void saveRow(row)} disabled={disabled || modeDisabled || saving}>
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                          <span className="sr-only">Save 1:1 access for {row.email}</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No deployment users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
