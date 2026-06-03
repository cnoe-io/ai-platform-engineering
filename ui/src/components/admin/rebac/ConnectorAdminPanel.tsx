"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileUp, RefreshCw, RotateCw, Settings2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { AgentPicker, type AgentPickerOption } from "@/components/ui/agent-picker";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { cn } from "@/lib/utils";
import { ConnectorOnboardingWizard } from "./ConnectorOnboardingWizard";
import type {
  ConnectorAdminAdapter,
  DiagnosticRoute,
  DiscoveredItem,
  ItemAgentRoute,
  ItemDiagnostics,
  ItemSummary,
  RuntimeStatus,
  RuntimeSyncSummary,
} from "./connector-admin-adapter";

interface DynamicAgentOption { _id: string; name: string }
interface TeamOption { _id?: string; id?: string; slug: string; name: string }
interface AssociationDefaults {
  team_slug: string; agent_id: string; create_routes?: boolean;
  updated_at?: string; updated_by?: string; source?: "db" | "env" | "unset";
}

type PanelView = "channels" | "onboard" | "advanced";
type SyncModalMode = "preview" | "apply";
type SyncModalStatus = "idle" | "loading" | "success" | "error";

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}
function agentLabel(agent: DynamicAgentOption): string {
  return `${agent.name || agent._id} (${agent._id})`;
}
function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ── ItemDetail subcomponent ───────────────────────────────────────────────────

interface ItemDetailProps {
  adapter: ConnectorAdminAdapter;
  selected: ItemSummary;
  diagnostics: ItemDiagnostics | null;
  routes: ItemAgentRoute[];
  dynamicAgents: DynamicAgentOption[];
  defaultAgentId: string;
  routeAgentId: string; setRouteAgentId: (v: string) => void;
  routeListen: "message" | "mention" | "all"; setRouteListen: (v: "message" | "mention" | "all") => void;
  routePriority: number; setRoutePriority: (v: number) => void;
  editingRouteAgentId: string | null;
  resetRouteForm: () => void;
  editRoute: (route: ItemAgentRoute) => void;
  saveRoute: () => Promise<void> | void;
  deleteRoute: (route: ItemAgentRoute) => void;
  fixDiagnosticRoute: (route: DiagnosticRoute) => Promise<void> | void;
  fixMissingRouteableAgent: () => Promise<void> | void;
  disabled: boolean; loading: boolean; selectedCanManage: boolean; message: string | null;
}

function ItemDetail({
  adapter, selected, diagnostics, routes, dynamicAgents, defaultAgentId,
  routeAgentId, setRouteAgentId, routeListen, setRouteListen, routePriority, setRoutePriority,
  editingRouteAgentId, resetRouteForm, editRoute, saveRoute, deleteRoute,
  fixDiagnosticRoute, fixMissingRouteableAgent, disabled, loading, selectedCanManage, message,
}: ItemDetailProps) {
  const diagnosticsMissingRouteableAgent =
    adapter.missingRouteableAgentAutoFix?.isApplicable(selected, diagnostics ?? {
      openfga: { reachable: false, tuple_count: 0 }, routes: [], warnings: [],
    }) ?? false;
  const autoFixAgentId = (defaultAgentId || "").trim();

  return (
    <div className="space-y-4">
      {/* Diagnostics */}
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
                <div className="text-xs text-muted-foreground">{diagnostics.openfga.tuple_count} {adapter.itemSingular}-agent tuples</div>
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
                {diagnostics.warnings.map((w) => <div key={w}>{w}</div>)}
              </div>
            )}
            {diagnosticsMissingRouteableAgent && adapter.missingRouteableAgentAutoFix && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-500/40 bg-cyan-50 p-3 text-sm text-cyan-950 dark:bg-cyan-950/30 dark:text-cyan-100">
                <div>
                  <div className="font-medium">{adapter.missingRouteableAgentAutoFix.title}</div>
                  <div className="text-xs">{adapter.missingRouteableAgentAutoFix.description}</div>
                </div>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => void fixMissingRouteableAgent()}
                  disabled={disabled || !selectedCanManage || loading || !autoFixAgentId}
                >
                  {adapter.missingRouteableAgentAutoFix.buttonLabel(autoFixAgentId)}
                </Button>
                {!autoFixAgentId && (
                  <div className="basis-full text-xs">{adapter.missingRouteableAgentAutoFix.noAgentHelpText}</div>
                )}
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
                    {adapter.diagnosticRouteIsFixable(route) && (
                      <Button
                        type="button" variant="outline" size="sm" className="ml-auto"
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

      {/* Manual route editing — Slack only */}
      {adapter.manualRouteEditing && (
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agents</div>
          {adapter.manualRouteFormHint?.(selected)}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="connector-route-agent-id">Dynamic Agent</Label>
              <AgentPicker
                id="connector-route-agent-id"
                ariaLabel="Dynamic Agent"
                value={routeAgentId}
                onChange={setRouteAgentId}
                disabled={disabled || !selectedCanManage || dynamicAgents.length === 0}
                placeholder={dynamicAgents.length === 0 ? "No enabled Dynamic Agents found" : "Select Dynamic Agent"}
                options={dynamicAgents.map<AgentPickerOption>((a) => ({ value: a._id, label: a.name || a._id }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="connector-route-listen">Listen</Label>
              <select
                id="connector-route-listen"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={routeListen}
                onChange={(e) => setRouteListen(e.target.value as "message" | "mention" | "all")}
                disabled={disabled || !selectedCanManage}
              >
                <option value="mention">mention</option>
                <option value="message">message</option>
                <option value="all">all</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="connector-route-priority">Priority</Label>
              <Input id="connector-route-priority" type="number" value={routePriority}
                onChange={(e) => setRoutePriority(Number(e.target.value))}
                disabled={disabled || !selectedCanManage} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void saveRoute()} disabled={disabled || !selectedCanManage || loading || !routeAgentId.trim()}>
              {loading ? "Saving..." : editingRouteAgentId ? "Update Association" : "Create Association"}
            </Button>
            {editingRouteAgentId && (
              <Button type="button" variant="outline" onClick={resetRouteForm} disabled={loading}>Cancel edit</Button>
            )}
          </div>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          {routes.length > 0 && (
            <div className="space-y-2">
              {routes.map((route) => (
                <div key={route.agent_id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/60 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>agent:{route.agent_id}</span>
                    <Badge>{route.users?.listen ?? "mention"} / priority {route.priority}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => editRoute(route)}
                      disabled={disabled || !selectedCanManage || loading} aria-label={`Edit agent:${route.agent_id}`}>Edit</Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => deleteRoute(route)}
                      disabled={disabled || !selectedCanManage || loading} aria-label={`Delete agent:${route.agent_id}`}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ConnectorAdminPanel ───────────────────────────────────────────────────────

export function ConnectorAdminPanel({
  adapter,
  disabled = false,
  selfService = false,
}: {
  adapter: ConnectorAdminAdapter;
  disabled?: boolean;
  selfService?: boolean;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [routes, setRoutes] = useState<ItemAgentRoute[]>([]);
  const [diagnostics, setDiagnostics] = useState<ItemDiagnostics | null>(null);
  const [dynamicAgents, setDynamicAgents] = useState<DynamicAgentOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [routeAgentId, setRouteAgentId] = useState("");
  const [editingRouteAgentId, setEditingRouteAgentId] = useState<string | null>(null);
  const [routePendingDelete, setRoutePendingDelete] = useState<ItemAgentRoute | null>(null);
  const [defaultTeamSlug, setDefaultTeamSlug] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [invalidDefaultTeamSlug, setInvalidDefaultTeamSlug] = useState<string | null>(null);
  const [invalidDefaultAgentId, setInvalidDefaultAgentId] = useState<string | null>(null);
  const [configuredDefaults, setConfiguredDefaults] = useState<AssociationDefaults | null>(null);
  const [useSlackbotConfigDefaults, setUseSlackbotConfigDefaults] = useState(true);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeSyncSummary, setRuntimeSyncSummary] = useState<RuntimeSyncSummary | null>(null);
  const [runtimeSyncModalOpen, setRuntimeSyncModalOpen] = useState(false);
  const [runtimeSyncModalMode, setRuntimeSyncModalMode] = useState<SyncModalMode>("preview");
  const [runtimeSyncModalStatus, setRuntimeSyncModalStatus] = useState<SyncModalStatus>("idle");
  const [runtimeSyncModalError, setRuntimeSyncModalError] = useState<string | null>(null);
  const [createDefaultRoutes, setCreateDefaultRoutes] = useState(true);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoveredItems, setDiscoveredItems] = useState<DiscoveredItem[]>([]);
  const [discoveredRows, setDiscoveredRows] = useState<Array<DiscoveredItem & { selected: boolean; team_slug: string; agent_id: string; is_existing: boolean }>>([]);
  const [routeListen, setRouteListen] = useState<"message" | "mention" | "all">("mention");
  const [routePriority, setRoutePriority] = useState(100);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>("channels");
  const [discoverySearch, setDiscoverySearch] = useState("");

  const selected = useMemo(
    () => items.find((item) => adapter.itemKey(item) === selectedKey),
    [items, selectedKey, adapter],
  );
  const selectedCanManage = !selfService || selected?.can_manage === true;
  const unassignedCount = useMemo(() => items.filter((item) => !item.team_slug).length, [items]);
  const configuredItemIds = useMemo(() => new Set(items.map((item) => item.item_id)), [items]);
  const configuredItemsById = useMemo(() => new Map(items.map((item) => [item.item_id, item])), [items]);
  const sortedDynamicAgents = useMemo(
    () => [...dynamicAgents].sort((a, b) => agentLabel(a).localeCompare(agentLabel(b))),
    [dynamicAgents],
  );
  const dynamicAgentIds = useMemo(() => new Set(dynamicAgents.map((a) => a._id)), [dynamicAgents]);
  const teamSlugSet = useMemo(() => new Set(teams.map((t) => t.slug).filter(Boolean) as string[]), [teams]);
  const fallbackAgentId = useMemo(() => {
    if (defaultAgentId && dynamicAgentIds.has(defaultAgentId)) return defaultAgentId;
    return "";
  }, [defaultAgentId, dynamicAgentIds]);
  const associationDefaultsDirty = useMemo(() => {
    const savedTeam = configuredDefaults?.team_slug ?? "";
    const savedAgent = configuredDefaults?.agent_id ?? "";
    const savedCreateRoutes = typeof configuredDefaults?.create_routes === "boolean" ? configuredDefaults.create_routes : true;
    return savedTeam !== defaultTeamSlug || savedAgent !== defaultAgentId || savedCreateRoutes !== createDefaultRoutes;
  }, [configuredDefaults, defaultTeamSlug, defaultAgentId, createDefaultRoutes]);
  const discoveredNewCount = useMemo(
    () => discoveredItems.filter((item) => !configuredItemIds.has(item.id)).length,
    [configuredItemIds, discoveredItems],
  );
  const selectedDiscoveredRows = useMemo(
    () => discoveredRows.filter((row) => row.selected && row.team_slug && row.agent_id),
    [discoveredRows],
  );

  // ── Data loaders ────────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(`${adapter.api.list}?health=1`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const rows = adapter.parseListResponse(json);
      const parsed = rows.map((r) => adapter.parseListItem(r)).filter((x): x is ItemSummary => x !== null);
      setItems(parsed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to load ${adapter.itemPlural}`);
    } finally { setLoading(false); }
  }, [adapter]);

  const loadRoutes = useCallback(async () => {
    if (!selected) return;
    const res = await fetch(adapter.api.routesFor(selected.workspace_id, selected.item_id));
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ routes: ItemAgentRoute[] }>(await res.json());
    setRoutes(data.routes ?? []);
  }, [selected, adapter]);

  const loadDiagnostics = useCallback(async () => {
    if (!selected) return;
    const res = await fetch(adapter.api.diagnosticsFor(selected.workspace_id, selected.item_id));
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<ItemDiagnostics>(await res.json());
    setDiagnostics(data);
  }, [selected, adapter]);

  const loadDynamicAgents = useCallback(async () => {
    const res = await fetch("/api/dynamic-agents?enabled_only=true");
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ items: DynamicAgentOption[] }>(await res.json());
    setDynamicAgents(data.items ?? []);
  }, []);

  const loadTeams = useCallback(async () => {
    const res = await fetch("/api/admin/teams");
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ teams: TeamOption[] }>(await res.json());
    setTeams(data.teams ?? []);
  }, []);

  const loadAssociationDefaults = useCallback(async () => {
    const res = await fetch(adapter.api.defaults);
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ defaults: AssociationDefaults }>(await res.json());
    setConfiguredDefaults(data.defaults ?? null);
    if (data.defaults) {
      setDefaultTeamSlug(data.defaults.team_slug ?? "");
      setDefaultAgentId(data.defaults.agent_id ?? "");
      if (typeof data.defaults.create_routes === "boolean") setCreateDefaultRoutes(data.defaults.create_routes);
    }
  }, [adapter]);

  const saveAssociationDefaults = useCallback(async () => {
    setSavingDefaults(true); setMessage(null);
    try {
      const res = await fetch(adapter.api.defaults, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_slug: defaultTeamSlug, agent_id: defaultAgentId, create_routes: createDefaultRoutes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = apiData<{ defaults: AssociationDefaults }>(await res.json());
      setConfiguredDefaults(data.defaults ?? null);
      if (data.defaults) {
        setDefaultTeamSlug(data.defaults.team_slug ?? "");
        setDefaultAgentId(data.defaults.agent_id ?? "");
        if (typeof data.defaults.create_routes === "boolean") setCreateDefaultRoutes(data.defaults.create_routes);
      }
      toast("Onboarding defaults saved.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save onboarding defaults";
      setMessage(msg); toast(msg, "error");
    } finally { setSavingDefaults(false); }
  }, [adapter, defaultTeamSlug, defaultAgentId, createDefaultRoutes, toast]);

  const loadRuntimeStatus = useCallback(async () => {
    const res = await fetch(adapter.api.runtimeStatus);
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<Record<string, unknown>>(await res.json());
    setRuntimeStatus(adapter.parseRuntimeStatus(data));
  }, [adapter]);

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => {
    void loadDynamicAgents().catch((e) =>
      setMessage(e instanceof Error ? e.message : "Failed to load Dynamic Agents"));
  }, [loadDynamicAgents]);
  useEffect(() => {
    if (selfService) return;
    void loadTeams().catch((e) => setMessage(e instanceof Error ? e.message : "Failed to load teams"));
  }, [loadTeams, selfService]);
  useEffect(() => {
    if (selfService) return;
    void loadAssociationDefaults().catch((e) =>
      setMessage(e instanceof Error ? e.message : `Failed to load ${adapter.connectorName} association defaults`));
  }, [loadAssociationDefaults, selfService, adapter.connectorName]);
  useEffect(() => {
    if (selfService) return;
    void loadRuntimeStatus().catch((e) =>
      setMessage(e instanceof Error ? e.message : `Failed to load ${adapter.connectorName} bot runtime status`));
  }, [loadRuntimeStatus, selfService, adapter.connectorName]);
  const connectorName = adapter.connectorName;
  const itemSingular = adapter.itemSingular;
  useEffect(() => {
    void loadRoutes().catch((e) =>
      setMessage(e instanceof Error ? e.message : `Failed to load ${connectorName} ${itemSingular} routes`));
  }, [loadRoutes, connectorName, itemSingular]);
  useEffect(() => {
    setDiagnostics(null);
    void loadDiagnostics().catch((e) =>
      setMessage(e instanceof Error ? e.message : `Failed to load ${connectorName} runtime diagnostics`));
  }, [loadDiagnostics, connectorName]);

  // Validate default agent/team after catalog loads
  useEffect(() => {
    if (selfService || dynamicAgents.length === 0 || !defaultAgentId) return;
    if (!dynamicAgentIds.has(defaultAgentId)) {
      setInvalidDefaultAgentId(defaultAgentId); setDefaultAgentId("");
    } else if (invalidDefaultAgentId) { setInvalidDefaultAgentId(null); }
  }, [selfService, dynamicAgents.length, dynamicAgentIds, defaultAgentId, invalidDefaultAgentId]);
  useEffect(() => {
    if (selfService || teams.length === 0 || !defaultTeamSlug) return;
    if (!teamSlugSet.has(defaultTeamSlug)) {
      setInvalidDefaultTeamSlug(defaultTeamSlug); setDefaultTeamSlug("");
    } else if (invalidDefaultTeamSlug) { setInvalidDefaultTeamSlug(null); }
  }, [selfService, teams.length, teamSlugSet, defaultTeamSlug, invalidDefaultTeamSlug]);

  // ── Route form helpers ───────────────────────────────────────────────────────

  const resetRouteForm = () => {
    setRouteAgentId(""); setRouteListen("mention"); setRoutePriority(100); setEditingRouteAgentId(null);
  };
  const editRoute = (route: ItemAgentRoute) => {
    setRouteAgentId(route.agent_id);
    setRouteListen(route.users?.listen ?? "mention");
    setRoutePriority(route.priority ?? 100);
    setEditingRouteAgentId(route.agent_id);
  };

  const saveRoute = async () => {
    if (!selected || !routeAgentId.trim()) return;
    setLoading(true); setMessage(null);
    try {
      const agentId = routeAgentId.trim();
      const nextRoutes: ItemAgentRoute[] = [
        ...routes.filter((r) => r.agent_id !== agentId && r.agent_id !== editingRouteAgentId),
        { agent_id: agentId, enabled: true, priority: routePriority, users: { enabled: true, listen: routeListen } },
      ];
      const res = await fetch(adapter.api.routesFor(selected.workspace_id, selected.item_id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: nextRoutes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = apiData<{ routes: ItemAgentRoute[] }>(await res.json());
      setRoutes(data.routes ?? []);
      resetRouteForm();
      toast(editingRouteAgentId
        ? `${adapter.connectorName} ${adapter.itemSingular}-agent association updated.`
        : `${adapter.connectorName} ${adapter.itemSingular}-agent association created.`, "success");
      await Promise.all([loadItems(), loadDiagnostics()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to save ${adapter.connectorName} association`);
    } finally { setLoading(false); }
  };

  const deleteRouteConfirmed = async () => {
    if (!selected || !routePendingDelete) return;
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(adapter.api.routesFor(selected.workspace_id, selected.item_id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: routePendingDelete.agent_id }),
      });
      if (!res.ok) throw new Error(await res.text());
      if (editingRouteAgentId === routePendingDelete.agent_id) resetRouteForm();
      setRoutePendingDelete(null);
      toast(`${adapter.connectorName} ${adapter.itemSingular}-agent association deleted.`, "success");
      await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to delete ${adapter.connectorName} association`);
    } finally { setLoading(false); }
  };

  // ── Runtime / advanced tab actions ──────────────────────────────────────────

  const refreshRuntimeStatus = async () => {
    setLoading(true); setMessage(null);
    try { await loadRuntimeStatus(); toast(`${adapter.connectorName} bot runtime status refreshed.`, "success"); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Failed to load runtime status"); }
    finally { setLoading(false); }
  };

  const reloadBotRoutes = async () => {
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(adapter.api.runtimeReload, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(await res.text());
      await loadRuntimeStatus();
      toast(`${adapter.connectorName} bot route cache reloaded.`, "success");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Failed to reload bot routes"); }
    finally { setLoading(false); }
  };

  const syncBotConfig = async (dryRun: boolean) => {
    setRuntimeSyncModalOpen(true); setRuntimeSyncModalMode(dryRun ? "preview" : "apply");
    setRuntimeSyncModalStatus("loading"); setRuntimeSyncModalError(null);
    if (dryRun) setRuntimeSyncSummary(null);
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(adapter.api.runtimeSyncFromConfig, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dry_run: dryRun }),
      });
      if (!res.ok) throw new Error(await res.text());
      const raw = apiData<Record<string, unknown>>(await res.json());
      const summary = adapter.parseRuntimeSyncSummary(raw);
      setRuntimeSyncSummary(summary); setRuntimeSyncModalStatus("success");
      toast(dryRun
        ? `Sync preview: ${summary.routes_planned} routes planned from ${summary.items_seen} ${adapter.itemPlural}.`
        : `Config sync applied: upserted ${summary.routes_upserted} routes and wrote ${summary.openfga_tuples_written} OpenFGA tuples.`,
        "success");
      await Promise.all([loadRuntimeStatus(), loadItems(), loadRoutes(), loadDiagnostics()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to sync ${adapter.connectorName} bot config`;
      setRuntimeSyncModalError(msg); setRuntimeSyncModalStatus("error"); setMessage(msg);
    } finally { setLoading(false); }
  };

  // ── Diagnostic fix actions ───────────────────────────────────────────────────

  const fixDiagnosticRoute = async (route: DiagnosticRoute) => {
    if (!selected) return;
    setLoading(true); setMessage(null);
    try {
      const result = await adapter.fixDiagnosticRoute({ item: selected, route, routes });
      if (result.nextRoutes) setRoutes(result.nextRoutes);
      await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
      toast(result.toast, "success");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to fix agent:${route.agent_id}`);
    } finally { setLoading(false); }
  };

  const fixMissingRouteableAgent = async () => {
    if (!selected) return;
    const agentId = (defaultAgentId || "").trim();
    if (!agentId) { toast(`Select a Dynamic Agent or configure a default Dynamic Agent to auto-fix this ${adapter.itemSingular}.`, "warning"); return; }
    setLoading(true); setMessage(null);
    try {
      const nextRoutes: ItemAgentRoute[] = [
        ...routes.filter((r) => r.agent_id !== agentId),
        { agent_id: agentId, enabled: true, priority: 100, users: { enabled: true, listen: "all" } },
      ];
      const res = await fetch(adapter.api.routesFor(selected.workspace_id, selected.item_id), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routes: nextRoutes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = apiData<{ routes: ItemAgentRoute[] }>(await res.json());
      setRoutes(data.routes ?? []);
      await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
      toast(`Created ${adapter.connectorName} association for agent:${agentId}.`, "success");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to auto-fix association");
    } finally { setLoading(false); }
  };

  // ── Discovery / onboarding ───────────────────────────────────────────────────

  const discoverItems = async () => {
    setDiscoverLoading(true); setDiscoverError(null); setMessage(null);
    try {
      const discovered: DiscoveredItem[] = [];
      let cursor: string | null = null;
      let page = 0;
      const legacySuggestions = adapter.legacyConfigAgentPrefill && useSlackbotConfigDefaults
        ? await adapter.legacyConfigAgentPrefill.fetchSuggestions(fetch).catch(() => ({}))
        : {};
      do {
        const url = adapter.api.discoveryUrl(page, cursor);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const pageData = adapter.parseDiscoveryPage(await res.json());
        discovered.push(...pageData.items);
        cursor = pageData.hasMore ? pageData.nextCursor : null;
        page++;
      } while (cursor);
      setDiscoveredItems(discovered);
      const hasNewItems = discovered.some((item) => !configuredItemIds.has(item.id));
      // Smart fallback for automatic team/agent selection: when the admin
      // hasn't saved onboarding defaults but there's exactly one manageable
      // team and/or one enabled agent, prefill that sole option so discovered
      // rows come up "Ready to set up" instead of blocked on "Pick team/agent".
      // Only for connectors that auto-select (Webex); Slack stays fully
      // opt-in per row, so it must not prefill team/agent here.
      const enableSmartFallback = Boolean(adapter.discoveryAutoSelectNewItems);
      const soleTeamSlug = enableSmartFallback && teams.length === 1 ? (teams[0].slug ?? "") : "";
      const soleAgentId = enableSmartFallback && sortedDynamicAgents.length === 1 ? sortedDynamicAgents[0]._id : "";
      const effectiveTeamSlug = defaultTeamSlug || soleTeamSlug;
      const effectiveAgentId = fallbackAgentId || soleAgentId;
      setDiscoveredRows(discovered.map((item) => {
        const existing = configuredItemsById.get(item.id);
        const isExisting = configuredItemIds.has(item.id);
        const isSetupComplete = Boolean(existing?.team_slug && (existing.active_grants ?? 0) > 0);
        const resolvedAgentId = (() => {
          const leg = legacySuggestions[item.id]?.trim();
          if (leg && dynamicAgentIds.has(leg)) return leg;
          return effectiveAgentId;
        })();
        // Only auto-select rows that are actually ready to onboard (have both
        // a team and an agent). Auto-selecting blocked rows produced a wall of
        // un-appliable "Pick team and agent" rows. Slack never auto-selects
        // (discoveryAutoSelectNewItems is unset → opt-in per row).
        const isReady = Boolean(effectiveTeamSlug && resolvedAgentId);
        const autoSelect = adapter.discoveryAutoSelectNewItems
          ? isReady && (hasNewItems ? !isExisting : true)
          : false;
        return { ...item, selected: autoSelect, team_slug: effectiveTeamSlug, agent_id: resolvedAgentId, is_existing: isSetupComplete };
      }));
      toast(`Found ${pluralize(discovered.length, adapter.copy.discoveryDiscoveredLabel)}.`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to discover ${adapter.connectorName} ${adapter.itemPlural}`;
      setDiscoverError(msg); setMessage(msg); setDiscoveredRows([]);
    } finally { setDiscoverLoading(false); }
  };

  const updateDiscoveredRow = (itemId: string, updates: Partial<{ selected: boolean; team_slug: string; agent_id: string }>) => {
    setDiscoveredRows((rows) => rows.map((row) => row.id === itemId ? { ...row, ...updates } : row));
  };
  const setAllRowsSelected = (sel: boolean) => {
    setDiscoveredRows((rows) => rows.map((row) => ({ ...row, selected: sel })));
  };

  const applyOnboarding = async () => {
    setLoading(true); setMessage(null);
    try {
      const result = await adapter.applyOnboarding({
        rows: discoveredRows.map((r) => ({ id: r.id, name: r.name, teamSlug: r.team_slug, agentId: r.agent_id, selected: r.selected })),
        defaultTeamSlug, defaultAgentId, createDefaultRoutes, fetchFn: fetch,
      });
      await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
      const appliedIds = new Set(discoveredRows.filter((r) => r.selected).map((r) => r.id));
      setDiscoveredRows((rows) => rows.map((row) => appliedIds.has(row.id) ? { ...row, is_existing: true, selected: false } : row));
      toast(result.toastMessage, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to apply ${adapter.connectorName} onboarding`;
      setMessage(msg); toast(msg, "error");
    } finally { setLoading(false); }
  };

  // ── Derived display values ────────────────────────────────────────────────────

  const discoveryStatusText = adapter.discoveryStatusText({
    discoveredCount: discoveredItems.length,
    newCount: discoveredNewCount,
    configuredCount: items.length,
    unassignedCount: unassignedCount,
  });

  const viewTitle: Record<PanelView, string> = {
    channels: adapter.copy.configuredTabTitle,
    onboard: adapter.copy.onboardTabTitle,
    advanced: adapter.copy.advancedTabTitle,
  };
  const viewDescription: Record<PanelView, string> = {
    channels: adapter.copy.configuredTabDescription,
    onboard: adapter.copy.onboardTabDescription,
    advanced: adapter.copy.advancedTabDescription,
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <CardTitle>{selfService ? adapter.copy.selfServiceTitle : viewTitle[view]}</CardTitle>
        <CardDescription>
          {selfService ? adapter.copy.selfServiceDescription : viewDescription[view]}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Tab bar */}
        {!selfService && (
          <div role="tablist" aria-label={adapter.ariaLabels.tablist}
            className="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-1">
            {(Object.keys(viewTitle) as PanelView[]).map((key) => (
              <Button key={key} role="tab" type="button" size="sm"
                variant={view === key ? "default" : "ghost"}
                aria-selected={view === key} onClick={() => setView(key)}>
                {viewTitle[key]}
              </Button>
            ))}
          </div>
        )}

        {/* Auth disclaimer */}
        {(selfService || view === "onboard") && (
          <div className="space-y-2 rounded-md border p-3 text-sm text-muted-foreground">
            {adapter.authzDisclaimer}
          </div>
        )}

        {/* Advanced tab */}
        {!selfService && view === "advanced" && (
          <div role="region" aria-label={adapter.ariaLabels.advancedRegion}
            data-section-tone="slate"
            className="rounded-md border border-slate-500/20 bg-slate-500/5 p-4 space-y-3">
            <div>
              <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
                <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {adapter.copy.advancedHeading}
              </h3>
              <p className="text-xs text-muted-foreground">{adapter.copy.advancedTabDescription}</p>
            </div>
            <div className={`grid gap-2 text-sm ${adapter.advancedExtraTiles ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
              <div className="rounded-md border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">Route mode</div>
                <div className="font-medium">{runtimeStatus?.route_mode ?? "unknown"}</div>
              </div>
              <div className="rounded-md border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">Static config</div>
                <div className="font-medium">{runtimeStatus ? adapter.staticConfigLabel({ items: Object.values(runtimeStatus.static_config)[0] ?? 0, routes: Object.values(runtimeStatus.static_config)[1] ?? 0 }) : "unknown"}</div>
              </div>
              <div className="rounded-md border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">Route cache</div>
                <div className="font-medium">{runtimeStatus ? adapter.routeCacheLabel(runtimeStatus.route_cache.cache_size) : "unknown"}</div>
                <div className="text-xs text-muted-foreground">TTL {runtimeStatus?.route_cache.ttl_seconds ?? "?"}s</div>
              </div>
              {runtimeStatus && adapter.advancedExtraTiles?.(runtimeStatus).map((tile) => (
                <div key={tile.label} className="rounded-md border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">{tile.label}</div>
                  <div className="font-medium">{tile.value}</div>
                </div>
              ))}
            </div>
            <div role="region" aria-label={adapter.ariaLabels.advancedLegend}
              className="grid gap-2 rounded-md border bg-background/50 p-3 text-xs text-muted-foreground md:grid-cols-2">
              <div><span className="font-medium text-foreground">Route mode:</span> shows whether the {adapter.copy.botNameInLegend} reads routes from database, YAML, or both.</div>
              <div><span className="font-medium text-foreground">Static config:</span> counts {adapter.itemPlural}/routes currently loaded from {adapter.copy.botNameInLegend} YAML.</div>
              <div><span className="font-medium text-foreground">Route cache:</span> shows cached runtime {adapter.itemSingular} routes and how soon they expire.</div>
              {adapter.advancedExtraLegendRows?.().map((row) => (
                <div key={row.label}><span className="font-medium text-foreground">{row.label}:</span> {row.description}</div>
              ))}
              <div><span className="font-medium text-foreground">Refresh Runtime Status:</span> reloads these status numbers from the running bot.</div>
              <div><span className="font-medium text-foreground">Reload Bot Cache:</span> refreshes the running bot after UI route changes.</div>
              <div><span className="font-medium text-foreground">Preview YAML Import:</span> shows planned changes without writing them.</div>
              <div className="md:col-span-2"><span className="font-medium text-foreground">Import from YAML Config:</span> writes YAML routes into CAIPE/OpenFGA.</div>
            </div>
            {runtimeSyncSummary && (
              <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div>{runtimeSyncSummary.dry_run ? `Sync preview: ${runtimeSyncSummary.routes_planned} routes planned.` : `Config sync applied: upserted ${runtimeSyncSummary.routes_upserted} routes.`}</div>
                Last sync {runtimeSyncSummary.dry_run ? "preview" : "apply"}: {runtimeSyncSummary.routes_planned} planned, {runtimeSyncSummary.routes_upserted} upserted, {runtimeSyncSummary.openfga_tuples_written} OpenFGA tuples.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => void refreshRuntimeStatus()} disabled={disabled || loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh Runtime Status</Button>
              <Button type="button" variant="outline" onClick={() => void reloadBotRoutes()} disabled={disabled || loading}><RotateCw className="h-4 w-4" aria-hidden="true" />Reload Bot Cache</Button>
              <Button type="button" variant="outline" onClick={() => void syncBotConfig(true)} disabled={disabled || loading}><FileUp className="h-4 w-4" aria-hidden="true" />Preview YAML Import</Button>
              <Button type="button" onClick={() => void syncBotConfig(false)} disabled={disabled || loading}><FileUp className="h-4 w-4" aria-hidden="true" />Import from YAML Config</Button>
            </div>
          </div>
        )}

        {/* Sync modal */}
        <Dialog open={runtimeSyncModalOpen} onOpenChange={setRuntimeSyncModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{adapter.syncDialogueTitle(runtimeSyncModalMode)}</DialogTitle>
              <DialogDescription>{adapter.syncDialogueDescription}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">
                  {runtimeSyncModalStatus === "loading" ? (runtimeSyncModalMode === "preview" ? "Previewing..." : "Applying...")
                    : runtimeSyncModalStatus === "success" ? (runtimeSyncModalMode === "preview" ? "Preview complete" : "Apply complete")
                    : runtimeSyncModalStatus === "error" ? "Sync failed" : "Ready"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {runtimeSyncModalStatus === "loading" ? `Contacting the ${adapter.connectorName} bot admin API...`
                    : "Static config sync is upsert-only and leaves existing UI-managed associations in place."}
                </div>
              </div>
              {runtimeSyncModalError && <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{runtimeSyncModalError}</div>}
              {runtimeSyncSummary && (
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{adapter.syncSummaryItemsLabel}</div><div className="font-medium">{pluralize(runtimeSyncSummary.items_seen, adapter.itemSingular)} scanned</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Planned routes</div><div className="font-medium">{pluralize(runtimeSyncSummary.routes_planned, "route")} planned</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">MongoDB route metadata</div><div className="font-medium">{pluralize(runtimeSyncSummary.routes_upserted, "route")} upserted</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">OpenFGA tuples</div><div className="font-medium">{pluralize(runtimeSyncSummary.openfga_tuples_written, "OpenFGA tuple")} written</div></div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuntimeSyncModalOpen(false)} disabled={runtimeSyncModalStatus === "loading"}>Close</Button>
              {runtimeSyncModalMode === "preview" && runtimeSyncModalStatus === "success" && (
                <Button type="button" onClick={() => void syncBotConfig(false)} disabled={disabled || loading}><FileUp className="h-4 w-4" aria-hidden="true" />Import from YAML Config</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Onboarding defaults — shown on Onboard tab */}
        {!selfService && view === "onboard" && (
          <div role="region" aria-label={adapter.ariaLabels.onboardingDefaultsRegion}
            data-section-tone="teal"
            className="rounded-md border border-teal-500/25 bg-teal-500/5 p-4 space-y-4">
            <div>
              <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                {adapter.copy.onboardingDefaultsHeading}
              </h3>
              <p className="text-xs text-muted-foreground">{adapter.copy.onboardingDefaultsDescription}</p>
            </div>
            <div className="rounded-md border border-teal-500/15 bg-background/60 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">Last saved</span>
                {configuredDefaults?.source === "env" && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">from environment variable</span>}
                {configuredDefaults?.source === "db" && configuredDefaults.updated_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(configuredDefaults.updated_at).toLocaleString()}
                    {configuredDefaults.updated_by ? ` · ${configuredDefaults.updated_by}` : ""}
                  </span>
                )}
                {configuredDefaults?.source === "unset" && <span className="text-[10px] text-muted-foreground">never saved</span>}
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div><div className="text-muted-foreground">Onboarding team</div><code>{configuredDefaults?.team_slug ? `team:${configuredDefaults.team_slug}` : "not configured"}</code></div>
                <div><div className="text-muted-foreground">Onboarding Dynamic Agent</div><code>{configuredDefaults?.agent_id ? `agent:${configuredDefaults.agent_id}` : "not configured"}</code></div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${adapter.connectorName.toLowerCase()}-default-team`}>Preselected Team</Label>
                <TeamPicker
                  id={`${adapter.connectorName.toLowerCase()}-default-team`}
                  value={defaultTeamSlug} onChange={setDefaultTeamSlug}
                  disabled={disabled || teams.length === 0}
                  placeholder={teams.length === 0 ? "No teams configured" : "Select preselected team"}
                  searchPlaceholder="Search teams..."
                  options={teams.map<TeamPickerOption>((t) => ({ slug: t.slug, name: t.name || t.slug, id: t.id, _id: t._id }))}
                />
                {invalidDefaultTeamSlug && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
                    The saved default team <code>team:{invalidDefaultTeamSlug}</code> doesn&apos;t match any current team. Pick one above.
                    {adapter.copy.invalidTeamEnvHint ? ` ${adapter.copy.invalidTeamEnvHint}` : ""}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${adapter.connectorName.toLowerCase()}-default-agent`}>Preselected Dynamic Agent</Label>
                <AgentPicker
                  id={`${adapter.connectorName.toLowerCase()}-default-agent`}
                  ariaLabel="Preselected Dynamic Agent"
                  value={defaultAgentId}
                  onChange={setDefaultAgentId}
                  disabled={disabled || dynamicAgents.length === 0}
                  placeholder={dynamicAgents.length === 0 ? "No enabled Dynamic Agents found" : "Select preselected Dynamic Agent"}
                  options={sortedDynamicAgents.map<AgentPickerOption>((a) => ({ value: a._id, label: a.name || a._id }))}
                />
                {invalidDefaultAgentId && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
                    The saved default Dynamic Agent <code>agent:{invalidDefaultAgentId}</code> wasn&apos;t found (or is disabled). Pick one above.
                    {adapter.copy.invalidAgentEnvHint ? ` ${adapter.copy.invalidAgentEnvHint}` : ""}
                  </p>
                )}
              </div>
            </div>
            {/* Legacy Slackbot YAML prefill checkbox — Slack only */}
            {adapter.legacyConfigAgentPrefill && (
              <label className="flex items-start gap-2 rounded-md border border-teal-500/15 bg-background/60 p-3 text-sm">
                <input type="checkbox" checked={useSlackbotConfigDefaults}
                  onChange={(e) => setUseSlackbotConfigDefaults(e.target.checked)} disabled={disabled} />
                <span>
                  <span className="font-medium">Use existing Slackbot channel agents as defaults</span>
                  <span className="block text-xs text-muted-foreground">{adapter.legacyConfigAgentPrefill.description}</span>
                </span>
              </label>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {associationDefaultsDirty && <span role="status" className="text-[11px] text-amber-700 dark:text-amber-400">Unsaved changes</span>}
              <Button type="button" size="sm" variant="default"
                onClick={() => void saveAssociationDefaults()}
                disabled={disabled || savingDefaults || !associationDefaultsDirty}
                aria-label={`Save ${adapter.connectorName} onboarding defaults`}>
                {savingDefaults ? "Saving…" : "Save defaults"}
              </Button>
            </div>
            {(teams.length === 0 || dynamicAgents.length === 0) && (
              <p className="text-xs text-muted-foreground">Configure a team or Dynamic Agent in the admin UI, then reload this page.</p>
            )}
          </div>
        )}

        {/* Empty state */}
        {!selfService && view === "channels" && items.length === 0 && (
          <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No {adapter.itemPlural} configured yet.</p>
            <p className="mt-1">Switch to <button type="button" className="underline underline-offset-2" onClick={() => setView("onboard")}>Onboard {adapter.itemPlural}</button> to find {adapter.connectorName} {adapter.itemPlural} where the bot is installed and set them up.</p>
          </div>
        )}

        {/* Configured items table */}
        {(selfService || view === "channels") && items.length > 0 && (
          <div role="region" aria-label={adapter.ariaLabels.configuredRegion}
            className="rounded-md border bg-background/60 overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: "min(70vh, 100vh - 320px)" }}>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{adapter.itemSingular.charAt(0).toUpperCase() + adapter.itemSingular.slice(1)}</th>
                    <th className="px-3 py-2 text-left font-medium">Team</th>
                    <th className="px-3 py-2 text-left font-medium">Agents</th>
                    <th className="px-3 py-2 text-left font-medium">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const key = adapter.itemKey(item);
                    const isSelected = key === selectedKey;
                    const grants = item.active_grants ?? 0;
                    const warningsCount = isSelected && diagnostics
                      ? diagnostics.warnings.length : item.health?.warnings_count;
                    const health = typeof warningsCount === "number"
                      ? warningsCount > 0
                        ? { label: `${warningsCount} issue${warningsCount === 1 ? "" : "s"}`, className: "border-amber-300 bg-amber-50 text-amber-800" }
                        : { label: "healthy", className: "border-emerald-300 bg-emerald-50 text-emerald-700" }
                      : !item.team_slug
                        ? { label: "no team", className: "border-amber-300 bg-amber-50 text-amber-800" }
                        : grants === 0
                          ? { label: "no agents", className: "border-amber-300 bg-amber-50 text-amber-800" }
                          : { label: "checking…", className: "border-slate-300 bg-slate-50 text-slate-600" };
                    const toggle = () => setSelectedKey(isSelected ? "" : key);
                    return (
                      <React.Fragment key={key}>
                        <tr role="button" tabIndex={0} aria-expanded={isSelected} onClick={toggle}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                          className={cn("cursor-pointer border-t transition-colors hover:bg-muted/30 focus:bg-muted/30 focus:outline-none", isSelected && "bg-muted/50")}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isSelected && "rotate-90")} aria-hidden="true" />
                              <div>
                                <div className="font-medium">{item.item_name}</div>
                                <div className="text-xs text-muted-foreground">{item.item_id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">{item.team_slug ? <Badge variant="secondary">team:{item.team_slug}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-2"><span className={grants === 0 ? "text-muted-foreground" : "font-medium"}>{grants}</span></td>
                          <td className="px-3 py-2"><Badge variant="outline" className={health.className}>{health.label}</Badge></td>
                        </tr>
                        {isSelected && (
                          <tr className="border-t bg-muted/20">
                            <td colSpan={4} className="p-4">
                              <ItemDetail
                                adapter={adapter} selected={item} diagnostics={diagnostics} routes={routes}
                                dynamicAgents={dynamicAgents} defaultAgentId={defaultAgentId}
                                routeAgentId={routeAgentId} setRouteAgentId={setRouteAgentId}
                                routeListen={routeListen} setRouteListen={setRouteListen}
                                routePriority={routePriority} setRoutePriority={setRoutePriority}
                                editingRouteAgentId={editingRouteAgentId} resetRouteForm={resetRouteForm}
                                editRoute={editRoute} saveRoute={saveRoute} deleteRoute={setRoutePendingDelete}
                                fixDiagnosticRoute={fixDiagnosticRoute} fixMissingRouteableAgent={fixMissingRouteableAgent}
                                disabled={disabled} loading={loading} selectedCanManage={selectedCanManage} message={message}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Onboarding wizard */}
        {!selfService && view === "onboard" && (
          <ConnectorOnboardingWizard
            connectorName={adapter.connectorName}
            provider={adapter.discoveryCacheProvider}
            isAdmin={!selfService}
            itemSingular={adapter.itemSingular}
            itemPlural={adapter.itemPlural}
            discoveredLabel={adapter.copy.discoveryDiscoveredLabel}
            findLabel={adapter.copy.discoveryFindLabel}
            refreshLabel={adapter.copy.discoveryRefreshLabel}
            loadingLabel={adapter.copy.discoveryLoadingLabel}
            emptyLabel={adapter.copy.discoveryEmptyLabel}
            description={adapter.copy.discoveryDescription}
            discoveryStatusText={discoveryStatusText}
            discoveredCount={discoveredItems.length}
            newCount={discoveredNewCount}
            selectedCount={selectedDiscoveredRows.length}
            rows={discoveredRows.map((row) => ({
              id: row.id,
              name: row.name,
              secondary: row.secondary,
              selected: row.selected,
              teamSlug: row.team_slug,
              agentId: row.agent_id,
              isExisting: row.is_existing,
              importLabel: `Import ${row.name}`,
              teamLabel: `Team for ${row.name}`,
              agentLabel: `Dynamic Agent for ${row.name}`,
            }))}
            teams={teams.map((t) => ({ value: t.slug, label: t.name || t.slug }))}
            agents={sortedDynamicAgents.map((a) => ({ value: a._id, label: a.name || a._id }))}
            error={discoverError}
            disabled={disabled}
            loading={loading}
            discovering={discoverLoading}
            searchValue={discoverySearch}
            onSearchChange={setDiscoverySearch}
            enableBulkApply
            onDiscover={() => void discoverItems()}
            onSelectAll={() => setAllRowsSelected(true)}
            onClearSelection={() => setAllRowsSelected(false)}
            onRowChange={(id, updates) => updateDiscoveredRow(id, {
              ...(typeof updates.selected === "boolean" ? { selected: updates.selected } : {}),
              ...(typeof updates.teamSlug === "string" ? { team_slug: updates.teamSlug } : {}),
              ...(typeof updates.agentId === "string" ? { agent_id: updates.agentId } : {}),
            })}
            onApply={() => void applyOnboarding()}
          />
        )}

        {/* Delete confirmation dialog */}
        <Dialog open={Boolean(routePendingDelete)} onOpenChange={(open) => { if (!open && !loading) setRoutePendingDelete(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {adapter.itemSingular}-agent association?</DialogTitle>
              <DialogDescription>
                {routePendingDelete ? `This removes agent:${routePendingDelete.agent_id} from the selected ${adapter.connectorName} ${adapter.itemSingular}.` : `This removes the selected agent from the ${adapter.connectorName} ${adapter.itemSingular}.`}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">The OpenFGA tuple will be deleted, and the saved Mongo route metadata for listen mode and priority will be deleted as well.</p>
            {routePendingDelete && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div><span className="font-medium">Listen:</span> {routePendingDelete.users?.listen ?? "mention"}</div>
                <div><span className="font-medium">Priority:</span> {routePendingDelete.priority}</div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRoutePendingDelete(null)} disabled={loading}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => void deleteRouteConfirmed()} disabled={loading}>{loading ? "Deleting..." : "Delete association"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
