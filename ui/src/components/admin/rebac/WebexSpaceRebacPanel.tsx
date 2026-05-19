"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileUp,
  RefreshCw,
  RotateCw,
  Search,
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

interface WebexSpaceSummary {
  workspace_id: string;
  space_id: string;
  space_name: string;
  team_slug?: string;
  active_grants: number;
}

interface WebexSpaceAgentRoute {
  agent_id: string;
  enabled: boolean;
  priority: number;
  users?: {
    enabled?: boolean;
    listen?: "message" | "mention" | "all";
  };
}

interface WebexRuntimeDiagnosticRoute {
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

interface WebexRuntimeDiagnostics {
  openfga: {
    reachable: boolean;
    tuple_count: number;
    error?: string;
  };
  routes: WebexRuntimeDiagnosticRoute[];
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

interface WebexSpaceAssociationDefaults {
  team_slug: string;
  agent_id: string;
  create_routes?: boolean;
}

interface ManualWebexSpaceInput {
  id: string;
  name?: string;
}

interface WebexBotRuntimeStatus {
  route_mode: string;
  static_config: {
    spaces: number;
    routes: number;
  };
  route_cache: {
    ttl_seconds: number;
    cache_size: number;
    cached_spaces?: string[];
  };
  last_sync?: WebexBotRuntimeSyncSummary | null;
}

interface WebexBotRuntimeSyncSummary {
  dry_run: boolean;
  spaces_seen: number;
  routes_planned: number;
  routes_upserted: number;
  openfga_tuples_written: number;
}

interface DiscoveredWebexSpace {
  id: string;
  webex_room_id?: string;
  name: string;
  type?: string;
  is_locked?: boolean;
}

interface WebexSpaceImportRow extends DiscoveredWebexSpace {
  selected: boolean;
  team_slug: string;
  agent_id: string;
  is_existing: boolean;
}

function isWebexSpaceImportRow(
  space: ManualWebexSpaceInput | WebexSpaceImportRow
): space is WebexSpaceImportRow {
  return "selected" in space && "team_slug" in space && "agent_id" in space;
}

interface WebexSpaceDiscoveryPayload {
  spaces: DiscoveredWebexSpace[];
  next_cursor?: string | null;
  has_more?: boolean;
}

interface WebexDefaultsSummary {
  spaces_seen: number;
  spaces_manual?: number;
  spaces_onboarded?: number;
  spaces_assigned_team: number;
  space_grants_ensured: number;
  routes_ensured: number;
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

function normalizeRoutePriority(value: number): number {
  if (!Number.isFinite(value)) return 100;
  const rounded = Math.floor(value);
  return rounded >= 0 ? rounded : 100;
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${fallback}: ${response.status}`;
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
    const detail = typeof payload.error === "string"
      ? payload.error
      : typeof payload.message === "string"
        ? payload.message
        : "";
    return detail ? `${fallback}: ${detail}` : `${fallback}: ${response.status}`;
  } catch {
    return `${fallback}: ${text}`;
  }
}

function webexAssociationErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (message.includes("fetch failed")) {
    return `${message}. Check that the UI server can reach OpenFGA and MongoDB, especially OPENFGA_HTTP and OPENFGA_STORE_ID.`;
  }
  return message;
}

export function WebexSpaceRebacPanel({ disabled = false }: { disabled?: boolean }) {
  const { toast } = useToast();
  const [spaces, setSpaces] = useState<WebexSpaceSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [routes, setRoutes] = useState<WebexSpaceAgentRoute[]>([]);
  const [diagnostics, setDiagnostics] = useState<WebexRuntimeDiagnostics | null>(null);
  const [dynamicAgents, setDynamicAgents] = useState<DynamicAgentOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [routeAgentId, setRouteAgentId] = useState("");
  const [editingRouteAgentId, setEditingRouteAgentId] = useState<string | null>(null);
  const [routePendingDelete, setRoutePendingDelete] = useState<WebexSpaceAgentRoute | null>(null);
  const [defaultTeamSlug, setDefaultTeamSlug] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [configuredDefaults, setConfiguredDefaults] = useState<WebexSpaceAssociationDefaults | null>(null);
  const [webexRuntimeStatus, setWebexRuntimeStatus] = useState<WebexBotRuntimeStatus | null>(null);
  const [runtimeSyncSummary, setRuntimeSyncSummary] = useState<WebexBotRuntimeSyncSummary | null>(null);
  const [runtimeSyncModalOpen, setRuntimeSyncModalOpen] = useState(false);
  const [runtimeSyncModalMode, setRuntimeSyncModalMode] = useState<RuntimeSyncModalMode>("preview");
  const [runtimeSyncModalStatus, setRuntimeSyncModalStatus] = useState<RuntimeSyncModalStatus>("idle");
  const [runtimeSyncModalError, setRuntimeSyncModalError] = useState<string | null>(null);
  const [createDefaultRoutes, setCreateDefaultRoutes] = useState(true);
  const [discoverDefaultsLoading, setDiscoverDefaultsLoading] = useState(false);
  const [discoverDefaultsError, setDiscoverDefaultsError] = useState<string | null>(null);
  const [discoveredBotSpaces, setDiscoveredBotSpaces] = useState<DiscoveredWebexSpace[]>([]);
  const [discoveredImportRows, setDiscoveredImportRows] = useState<WebexSpaceImportRow[]>([]);
  const [routeListen, setRouteListen] = useState<"message" | "mention" | "all">("mention");
  const [routePriority, setRoutePriority] = useState(100);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [migrationConfirmOpen, setMigrationConfirmOpen] = useState(false);
  const [manualSpaceConfirmOpen, setManualSpaceConfirmOpen] = useState(false);
  const [manualSpaceId, setManualSpaceId] = useState("");
  const [manualSpaceName, setManualSpaceName] = useState("");
  const previousSelectedKeyRef = useRef("");

  const selected = useMemo(
    () => spaces.find((space) => `${space.workspace_id}/${space.space_id}` === selectedKey),
    [spaces, selectedKey]
  );
  const unassignedSpaceCount = useMemo(
    () => spaces.filter((space) => !space.team_slug).length,
    [spaces]
  );
  const configuredSpaceIds = useMemo(
    () => new Set(spaces.map((space) => space.space_id)),
    [spaces]
  );
  const discoveredNewSpaceCount = useMemo(
    () => discoveredBotSpaces.filter((space) => !configuredSpaceIds.has(space.id)).length,
    [configuredSpaceIds, discoveredBotSpaces]
  );
  const selectedDiscoveredImportRows = useMemo(
    () => discoveredImportRows.filter((space) => space.selected),
    [discoveredImportRows]
  );
  const discoveryStatusText = useMemo(() => {
    const base =
      discoveredBotSpaces.length > 0
        ? `${discoveredBotSpaces.length} bot-visible found · ${discoveredNewSpaceCount} new`
        : `${spaces.length} managed in CAIPE`;
    return `${base} · ${unassignedSpaceCount} missing team`;
  }, [discoveredBotSpaces.length, discoveredNewSpaceCount, spaces.length, unassignedSpaceCount]);
  const missingAssociationAutoFixAgentId = (
    routeAgentId.trim() ||
    defaultAgentId ||
    configuredDefaults?.agent_id ||
    ""
  ).trim();
  const diagnosticsMissingRouteableAgent = Boolean(
    diagnostics?.openfga.reachable &&
    diagnostics.openfga.tuple_count === 0 &&
    diagnostics.routes.length === 0
  );

  const loadSpaces = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/webex/spaces");
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<{ spaces: WebexSpaceSummary[] }>(await response.json());
      setSpaces(data.spaces ?? []);
      setSelectedKey((current) => {
        if (current) return current;
        const first = data.spaces?.[0];
        return first ? `${first.workspace_id}/${first.space_id}` : "";
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Webex spaces");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoutes = useCallback(async () => {
    if (!selected) return;
    const response = await fetch(
      `/api/admin/webex/spaces/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.space_id)}/routes`
    );
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ routes: WebexSpaceAgentRoute[] }>(await response.json());
    setRoutes(data.routes ?? []);
  }, [selected]);

  const loadDiagnostics = useCallback(async () => {
    if (!selected) return;
    const response = await fetch(
      `/api/admin/webex/spaces/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.space_id)}/diagnostics`
    );
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<WebexRuntimeDiagnostics>(await response.json());
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
    const response = await fetch("/api/admin/webex/spaces/defaults");
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<{ defaults: WebexSpaceAssociationDefaults }>(await response.json());
    setConfiguredDefaults(data.defaults ?? null);
    if (data.defaults?.team_slug) setDefaultTeamSlug((current) => current || data.defaults.team_slug);
    if (data.defaults?.agent_id) setDefaultAgentId((current) => current || data.defaults.agent_id);
    if (typeof data.defaults?.create_routes === "boolean") {
      setCreateDefaultRoutes(data.defaults.create_routes);
    }
  }, []);

  const loadWebexRuntimeStatus = useCallback(async () => {
    const response = await fetch("/api/admin/webex/runtime/status");
    if (!response.ok) throw new Error(await response.text());
    const data = apiData<WebexBotRuntimeStatus>(await response.json());
    setWebexRuntimeStatus(data);
  }, []);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

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
      setMessage(error instanceof Error ? error.message : "Failed to load Webex space association defaults")
    );
  }, [loadAssociationDefaults]);

  useEffect(() => {
    void loadWebexRuntimeStatus().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Webex bot runtime status")
    );
  }, [loadWebexRuntimeStatus]);

  useEffect(() => {
    void loadRoutes().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Webex space routes")
    );
  }, [loadRoutes]);

  useEffect(() => {
    setDiagnostics(null);
    void loadDiagnostics().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Failed to load Webex runtime diagnostics")
    );
  }, [loadDiagnostics]);

  const resetRouteForm = () => {
    setRouteAgentId("");
    setRouteListen("mention");
    setRoutePriority(100);
    setEditingRouteAgentId(null);
  };

  useEffect(() => {
    if (!selectedKey) return;
    if (previousSelectedKeyRef.current && previousSelectedKeyRef.current !== selectedKey) {
      resetRouteForm();
    }
    previousSelectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  const editRoute = (route: WebexSpaceAgentRoute) => {
    setRouteAgentId(route.agent_id);
    setRouteListen(route.users?.listen ?? "mention");
    setRoutePriority(normalizeRoutePriority(route.priority ?? 100));
    setEditingRouteAgentId(route.agent_id);
  };

  const saveRoute = async () => {
    if (!selected || !routeAgentId.trim()) return;
    const priority = normalizeRoutePriority(routePriority);
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
          priority,
          users: { enabled: true, listen: routeListen },
        },
      ];
      const response = await fetch(
        `/api/admin/webex/spaces/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.space_id)}/routes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routes: nextRoutes }),
        }
      );
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, "Failed to save Webex association"));
      }
      const data = apiData<{ routes: WebexSpaceAgentRoute[] }>(await response.json());
      setRoutes(data.routes ?? []);
      resetRouteForm();
      toast(
        editingRouteAgentId
          ? "Webex space-agent association updated."
          : "Webex space-agent association created.",
        "success"
      );
      await Promise.all([loadSpaces(), loadDiagnostics()]);
    } catch (error) {
      setMessage(webexAssociationErrorMessage(error, "Failed to save Webex association"));
    } finally {
      setLoading(false);
    }
  };

  const fixMissingRouteableAgent = async () => {
    if (!selected) return;
    const agentId = missingAssociationAutoFixAgentId;
    if (!agentId) {
      toast("Select a Dynamic Agent or configure a default Dynamic Agent to auto-fix this Webex space.", "warning");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const nextRoutes = [
        ...routes.filter((route) => route.agent_id !== agentId),
        {
          agent_id: agentId,
          enabled: true,
          priority: normalizeRoutePriority(routePriority),
          users: { enabled: true, listen: "all" as const },
        },
      ];
      const response = await fetch(
        `/api/admin/webex/spaces/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.space_id)}/routes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routes: nextRoutes }),
        }
      );
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, "Failed to auto-fix Webex association"));
      }
      const data = apiData<{ routes: WebexSpaceAgentRoute[] }>(await response.json());
      setRoutes(data.routes ?? []);
      setRouteAgentId("");
      setRouteListen("mention");
      setRoutePriority(100);
      await Promise.all([loadSpaces(), loadRoutes(), loadDiagnostics()]);
      toast(`Created Webex association for agent:${agentId}.`, "success");
    } catch (error) {
      setMessage(webexAssociationErrorMessage(error, "Failed to auto-fix Webex association"));
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
        `/api/admin/webex/spaces/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.space_id)}/routes`,
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
      await Promise.all([loadSpaces(), loadRoutes(), loadDiagnostics()]);
      toast("Webex space-agent association deleted.", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete Webex association");
    } finally {
      setLoading(false);
    }
  };

  const refreshDefaults = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([loadSpaces(), loadDynamicAgents(), loadTeams(), loadAssociationDefaults()]);
      toast("Webex space association default lists refreshed.", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to refresh Webex space association defaults");
    } finally {
      setLoading(false);
    }
  };

  const refreshWebexRuntimeStatus = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await loadWebexRuntimeStatus();
      toast("Webex bot runtime status refreshed.", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load Webex bot runtime status");
    } finally {
      setLoading(false);
    }
  };

  const reloadWebexBotRoutes = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/webex/runtime/reload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await response.text());
      await loadWebexRuntimeStatus();
      toast("Webex bot route cache reloaded.", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to reload Webex bot routes");
    } finally {
      setLoading(false);
    }
  };

  const syncWebexBotConfig = async (dryRun: boolean) => {
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
      const response = await fetch("/api/admin/webex/runtime/sync-from-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<WebexBotRuntimeSyncSummary>(await response.json());
      setRuntimeSyncSummary(data);
      setRuntimeSyncModalStatus("success");
      toast(
        dryRun
          ? `Sync preview: ${data.routes_planned} routes planned from ${data.spaces_seen} spaces.`
          : `Config sync applied: upserted ${data.routes_upserted} routes and wrote ${data.openfga_tuples_written} OpenFGA tuples.`,
        "success"
      );
      await Promise.all([loadWebexRuntimeStatus(), loadSpaces(), loadRoutes(), loadDiagnostics()]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to sync Webex bot config";
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

  const applyManualSpaceDefaults = () => {
    if (!defaultTeamSlug || !defaultAgentId || !manualSpaceId.trim()) return;
    setManualSpaceConfirmOpen(true);
  };

  const fetchBotSpaces = async (): Promise<DiscoveredWebexSpace[]> => {
    const discovered: DiscoveredWebexSpace[] = [];
    let cursor: string | null | undefined;
    let firstPage = true;
    do {
      const params = new URLSearchParams({ limit: "500" });
      if (firstPage) params.set("refresh", "1");
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/webex/available-spaces?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await response.text());
      const data = apiData<WebexSpaceDiscoveryPayload>(await response.json());
      discovered.push(...(data.spaces ?? []));
      cursor = data.has_more ? data.next_cursor : null;
      firstPage = false;
    } while (cursor);
    return discovered;
  };

  const discoverDefaults = async () => {
    setDiscoverDefaultsLoading(true);
    setDiscoverDefaultsError(null);
    setMessage(null);
    try {
      const discovered = await fetchBotSpaces();
      setDiscoveredBotSpaces(discovered);
      const hasNewSpaces = discovered.some((space) => !configuredSpaceIds.has(space.id));
      const fallbackTeamSlug = defaultTeamSlug || teams[0]?.slug || "";
      const fallbackAgentId = defaultAgentId || dynamicAgents[0]?._id || "";
      setDiscoveredImportRows(
        discovered.map((space) => {
          const isExisting = configuredSpaceIds.has(space.id);
          return {
            ...space,
            selected: hasNewSpaces ? !isExisting : true,
            team_slug: fallbackTeamSlug,
            agent_id: fallbackAgentId,
            is_existing: isExisting,
          };
        })
      );
      toast(`Found ${pluralize(discovered.length, "bot-visible space")}.`, "success");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to discover Webex bot-visible spaces";
      setDiscoverDefaultsError(errorMessage);
      setMessage(errorMessage);
      setDiscoveredImportRows([]);
    } finally {
      setDiscoverDefaultsLoading(false);
    }
  };

  const updateDiscoveredImportRow = (
    spaceId: string,
    updates: Partial<Pick<WebexSpaceImportRow, "selected" | "team_slug" | "agent_id">>
  ) => {
    setDiscoveredImportRows((rows) =>
      rows.map((row) => (row.id === spaceId ? { ...row, ...updates } : row))
    );
  };

  const setAllDiscoveredImportRowsSelected = (selected: boolean) => {
    setDiscoveredImportRows((rows) => rows.map((row) => ({ ...row, selected })));
  };

  const confirmMigrationDefaults = async (
    manualSpaces: ManualWebexSpaceInput[] | WebexSpaceImportRow[] = []
  ) => {
    const selectedImports = manualSpaces.filter((space) =>
      isWebexSpaceImportRow(space) ? space.selected : true
    );
    const hasDiscoveredImports = selectedImports.some(isWebexSpaceImportRow);
    const hasRowDefaults = selectedImports.every(
      (space) =>
        !isWebexSpaceImportRow(space) || (Boolean(space.team_slug) && Boolean(space.agent_id))
    );
    if (hasDiscoveredImports) {
      if (!hasRowDefaults || selectedImports.length === 0) return;
    } else if (!defaultTeamSlug || !defaultAgentId) {
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const groupedImports = new Map<string, ManualWebexSpaceInput[]>();
      selectedImports.forEach((space) => {
        const teamSlug =
          isWebexSpaceImportRow(space) && space.team_slug ? space.team_slug : defaultTeamSlug;
        const agentId =
          isWebexSpaceImportRow(space) && space.agent_id ? space.agent_id : defaultAgentId;
        const groupKey = `${teamSlug}\u0000${agentId}`;
        const current = groupedImports.get(groupKey) ?? [];
        current.push({
          id: space.id,
          name: space.name,
        });
        groupedImports.set(groupKey, current);
      });
      const requests =
        groupedImports.size > 0
          ? Array.from(groupedImports.entries()).map(([key, spacesForGroup]) => {
              const [teamSlug, agentId] = key.split("\u0000");
              return {
                team_slug: teamSlug ?? defaultTeamSlug,
                agent_id: agentId ?? defaultAgentId,
                create_routes: createDefaultRoutes,
                manual_spaces: spacesForGroup,
              };
            })
          : [
              {
                team_slug: defaultTeamSlug,
                agent_id: defaultAgentId,
                create_routes: createDefaultRoutes,
              },
            ];
      const results = await Promise.all(
        requests.map(async (body) => {
          const response = await fetch("/api/admin/webex/spaces/defaults", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!response.ok) throw new Error(await response.text());
          return apiData<{ summary: WebexDefaultsSummary }>(await response.json());
        })
      );
      const summary = results.reduce<WebexDefaultsSummary>(
        (acc, result) => ({
          spaces_seen: acc.spaces_seen + result.summary.spaces_seen,
          spaces_manual: (acc.spaces_manual ?? 0) + (result.summary.spaces_manual ?? 0),
          spaces_onboarded: (acc.spaces_onboarded ?? 0) + (result.summary.spaces_onboarded ?? 0),
          spaces_assigned_team: acc.spaces_assigned_team + result.summary.spaces_assigned_team,
          space_grants_ensured: acc.space_grants_ensured + result.summary.space_grants_ensured,
          routes_ensured: acc.routes_ensured + result.summary.routes_ensured,
          routes_preserved: (acc.routes_preserved ?? 0) + (result.summary.routes_preserved ?? 0),
        }),
        {
          spaces_seen: 0,
          spaces_manual: 0,
          spaces_onboarded: 0,
          spaces_assigned_team: 0,
          space_grants_ensured: 0,
          routes_ensured: 0,
          routes_preserved: 0,
        }
      );
      await Promise.all([
        loadSpaces(),
        loadRoutes(),
        loadDiagnostics(),
        loadAssociationDefaults(),
      ]);
      if (manualSpaces.length > 0 && !hasDiscoveredImports) {
        setManualSpaceId("");
        setManualSpaceName("");
        setManualSpaceConfirmOpen(false);
        toast(
          `Webex manual space defaults applied: onboarded ${summary.spaces_onboarded ?? 0} spaces, ensured ${summary.space_grants_ensured} space grants, ensured ${summary.routes_ensured} routes, preserved ${summary.routes_preserved ?? 0} existing routes.`,
          "success"
        );
      } else if (hasDiscoveredImports) {
        toast(
          `Discovered Webex spaces applied: onboarded ${summary.spaces_onboarded ?? 0} spaces, assigned ${summary.spaces_assigned_team} spaces, ensured ${summary.space_grants_ensured} space grants, ensured ${summary.routes_ensured} routes, preserved ${summary.routes_preserved ?? 0} existing routes.`,
          "success"
        );
      } else {
        toast(
          `Webex space association defaults applied: assigned ${summary.spaces_assigned_team} spaces, ensured ${summary.space_grants_ensured} space grants, ensured ${summary.routes_ensured} routes.`,
          "success"
        );
      }
      setMigrationConfirmOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply Webex space association defaults");
    } finally {
      setLoading(false);
    }
  };

  const diagnosticRouteIsFixable = (route: WebexRuntimeDiagnosticRoute) =>
    (route.route_metadata && !route.openfga_tuple) ||
    (route.openfga_tuple && route.listen !== "all");

  const fixDiagnosticRoute = async (route: WebexRuntimeDiagnosticRoute) => {
    if (!selected) return;
    setLoading(true);
    setMessage(null);
    try {
      const routeUrl = `/api/admin/webex/spaces/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.space_id)}/routes`;
      if (route.route_metadata && !route.openfga_tuple) {
        const response = await fetch(routeUrl, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: route.agent_id }),
        });
        if (!response.ok) {
          throw new Error(await responseErrorMessage(response, `Failed to fix agent:${route.agent_id}`));
        }
        await Promise.all([loadSpaces(), loadRoutes(), loadDiagnostics()]);
        toast(`Removed stale route metadata for agent:${route.agent_id}.`, "success");
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
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, `Failed to fix agent:${route.agent_id}`));
      }
      const data = apiData<{ routes: WebexSpaceAgentRoute[] }>(await response.json());
      setRoutes(data.routes ?? []);
      await Promise.all([loadSpaces(), loadRoutes(), loadDiagnostics()]);
      toast(`Updated agent:${route.agent_id} to listen to mentions and plain messages.`, "success");
    } catch (error) {
      setMessage(webexAssociationErrorMessage(error, `Failed to fix agent:${route.agent_id}`));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webex Spaces</CardTitle>
        <CardDescription>
          Control which Dynamic Agents a Webex space may invoke.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="order-0 rounded-md border p-3 text-sm text-muted-foreground">
          Webex authorization has two checks before dispatch: the space must have
          <code className="mx-1">can_use agent:&lt;id&gt;</code>, and the user's active
          team must also have <code className="mx-1">can_use agent:&lt;id&gt;</code>.
          If either check fails, the Webex bot denies the request before calling the agent.
        </div>

        <div
          role="region"
          aria-label="Advanced Setup - Import/Sync with Webex Bot"
          data-section-tone="slate"
          data-section-order="5"
          className="order-5 rounded-md border border-slate-500/20 bg-slate-500/5 p-4 space-y-3"
        >
          <div>
            <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
              <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Advanced Setup - Import/Sync with Webex Bot
            </h3>
            <p className="text-xs text-muted-foreground">
              Inspect the running Webex bot route cache, force a reload, or migrate the
              bot's static YAML space config into MongoDB/OpenFGA.
            </p>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Route mode</div>
              <div className="font-medium">{webexRuntimeStatus?.route_mode ?? "unknown"}</div>
            </div>
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Static config</div>
              <div className="font-medium">
                {webexRuntimeStatus
                  ? `${webexRuntimeStatus.static_config.spaces} spaces / ${webexRuntimeStatus.static_config.routes} routes`
                  : "unknown"}
              </div>
            </div>
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Route cache</div>
              <div className="font-medium">
                {webexRuntimeStatus
                  ? `${webexRuntimeStatus.route_cache.cache_size} cached space${webexRuntimeStatus.route_cache.cache_size === 1 ? "" : "s"}`
                  : "unknown"}
              </div>
              <div className="text-xs text-muted-foreground">
                TTL {webexRuntimeStatus?.route_cache.ttl_seconds ?? "?"}s
              </div>
            </div>
          </div>
          <div
            role="region"
            aria-label="Webex bot sync legend"
            className="grid gap-2 rounded-md border bg-background/50 p-3 text-xs text-muted-foreground md:grid-cols-2"
          >
            <div>
              <span className="font-medium text-foreground">Route mode:</span>{" "}
              shows whether the Webex bot reads routes from database, YAML, or both.
            </div>
            <div>
              <span className="font-medium text-foreground">Static config:</span>{" "}
              counts spaces/routes currently loaded from Webex bot YAML.
            </div>
            <div>
              <span className="font-medium text-foreground">Route cache:</span>{" "}
              shows cached runtime space routes and how soon they expire.
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
            <Button type="button" variant="outline" onClick={refreshWebexRuntimeStatus} disabled={disabled || loading}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh Runtime Status
            </Button>
            <Button type="button" variant="outline" onClick={reloadWebexBotRoutes} disabled={disabled || loading}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Reload Bot Cache
            </Button>
            <Button type="button" variant="outline" onClick={() => syncWebexBotConfig(true)} disabled={disabled || loading}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Preview YAML Import
            </Button>
            <Button type="button" onClick={() => syncWebexBotConfig(false)} disabled={disabled || loading}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Import from YAML Config
            </Button>
          </div>
        </div>

        <Dialog open={runtimeSyncModalOpen} onOpenChange={setRuntimeSyncModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {runtimeSyncModalMode === "preview"
                  ? "Webex Bot Config Sync Preview"
                  : "Webex Bot Config Sync Apply"}
              </DialogTitle>
              <DialogDescription>
                Preview reads the Webex bot's loaded static YAML config. Apply upserts matching
                MongoDB route metadata and space-agent OpenFGA tuples without deleting UI-managed associations.
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
                    ? "Contacting the Webex bot admin API..."
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
                    <div className="text-xs text-muted-foreground">Spaces</div>
                    <div className="font-medium">
                      {pluralize(runtimeSyncSummary.spaces_seen, "space")} scanned
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
                <Button type="button" onClick={() => syncWebexBotConfig(false)} disabled={disabled || loading}>
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                  Import from YAML Config
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div
          role="region"
          aria-label="Step 1: Discover and Setup"
          data-section-tone="sky"
          data-section-order="1"
          className="order-1 space-y-3 rounded-md border border-sky-500/25 bg-sky-500/5 p-4 text-sm"
        >
          <div>
            <h3 className="text-base font-semibold tracking-tight">Step 1: Discover and Setup</h3>
            <p className="text-xs text-muted-foreground">
              Find Webex spaces where the bot is already installed, then choose what to import.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void discoverDefaults()}
              disabled={disabled || loading || discoverDefaultsLoading}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {discoverDefaultsLoading
                ? "Finding Webex spaces..."
                : discoveredBotSpaces.length > 0
                  ? "Refresh Webex Spaces with Bot Integration"
                  : "Find Webex Spaces with Bot Integration"}
            </Button>
            <span
              role="status"
              aria-label={discoveryStatusText}
              className="text-xs text-muted-foreground"
            >
              {discoveryStatusText}
            </span>
          </div>
          {(discoverDefaultsError || discoveredBotSpaces.length > 0) && (
            <>
              <div>
                <div className="font-medium">Review spaces found by the bot</div>
                <p className="text-xs text-muted-foreground">
                  Select spaces to import, then choose team and Dynamic Agent per space.
                </p>
              </div>
              {discoverDefaultsError ? (
                <div className="text-destructive">{discoverDefaultsError}</div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {pluralize(discoveredBotSpaces.length, "bot-visible space")} discovered
                    </Badge>
                    <Badge variant="outline">
                      {pluralize(discoveredNewSpaceCount, "new space")} new
                    </Badge>
                    <Badge variant="outline">
                      {pluralize(selectedDiscoveredImportRows.length, "space")} selected
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Routes:{" "}
                      {createDefaultRoutes
                        ? "create missing defaults and preserve existing route metadata"
                        : "do not create Webex routes"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAllDiscoveredImportRowsSelected(true)}
                      disabled={loading || discoveredImportRows.length === 0}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAllDiscoveredImportRowsSelected(false)}
                      disabled={loading || discoveredImportRows.length === 0}
                    >
                      Clear selection
                    </Button>
                  </div>
                  <div className="max-h-[420px] overflow-auto rounded-md border bg-background/80">
                    <div className="grid min-w-[760px] grid-cols-[minmax(220px,1fr)_190px_220px_110px] gap-3 border-b bg-sky-500/5 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <div>Space</div>
                      <div>Team</div>
                      <div>Dynamic Agent</div>
                      <div>Status</div>
                    </div>
                    {discoveredImportRows.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground">
                        No bot-visible Webex spaces were discovered.
                      </div>
                    ) : (
                      discoveredImportRows.map((space) => (
                        <div
                          key={space.id}
                          className="grid min-w-[760px] grid-cols-[minmax(220px,1fr)_190px_220px_110px] gap-3 border-b px-3 py-3 last:border-b-0"
                        >
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              aria-label={`Import ${space.name}`}
                              checked={space.selected}
                              onChange={(event) =>
                                updateDiscoveredImportRow(space.id, {
                                  selected: event.target.checked,
                                })
                              }
                              disabled={loading}
                            />
                            <span>
                              <span className="font-medium">{space.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {space.id}
                                {space.type ? ` · ${space.type}` : ""}
                                {space.is_locked ? " · locked" : ""}
                              </span>
                            </span>
                          </label>
                          <select
                            aria-label={`Team for ${space.name}`}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            value={space.team_slug}
                            onChange={(event) =>
                              updateDiscoveredImportRow(space.id, {
                                team_slug: event.target.value,
                              })
                            }
                            disabled={loading || !space.selected}
                          >
                            {teams.map((team) => (
                              <option key={team.slug} value={team.slug}>
                                {team.name || team.slug}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Dynamic Agent for ${space.name}`}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            value={space.agent_id}
                            onChange={(event) =>
                              updateDiscoveredImportRow(space.id, {
                                agent_id: event.target.value,
                              })
                            }
                            disabled={loading || !space.selected}
                          >
                            {dynamicAgents.map((agent) => (
                              <option key={agent._id} value={agent._id}>
                                {agent.name || agent._id}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center">
                            <Badge variant={space.is_existing ? "outline" : "secondary"}>
                              {space.is_existing ? "Managed" : "New"}
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-3xl text-xs text-muted-foreground">
                  Existing UI-managed or config-synced route metadata is preserved. This action imports only
                  selected spaces, applies each selected row's team and agent, ensures space grants, and
                  creates missing default routes when route creation is enabled.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void confirmMigrationDefaults(discoveredImportRows)}
                    disabled={
                      loading ||
                      Boolean(discoverDefaultsError) ||
                      selectedDiscoveredImportRows.length === 0 ||
                      selectedDiscoveredImportRows.some((space) => !space.team_slug || !space.agent_id)
                    }
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {loading ? "Applying..." : "Apply discovered defaults"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <div
          role="region"
          aria-label="[Optional] Global Space Defaults"
          data-section-tone="teal"
          data-section-order="3"
          className="order-3 rounded-md border border-teal-500/25 bg-teal-500/5 p-4 space-y-4"
        >
          <div>
            <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              [Optional] Global Space Defaults
            </h3>
            <p className="text-xs text-muted-foreground">
              Use this to assign unconfigured Webex spaces to the configured default team
              and grant onboarded spaces access to the configured default Dynamic Agent.
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
              <Label htmlFor="webex-default-team">Default Team</Label>
              <select
                id="webex-default-team"
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
              <Label htmlFor="webex-default-agent">Default Dynamic Agent</Label>
              <select
                id="webex-default-agent"
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
            Create matching Webex routes for the default Dynamic Agent
          </label>
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div>
              <div className="text-sm font-medium">Manually add a Webex space</div>
              <p className="text-xs text-muted-foreground">
                Use this when the bot is already in a space but the bot token cannot list spaces.
                The space will be onboarded, assigned to the default team, granted the default
                Dynamic Agent, and optionally given matching route metadata.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="webex-manual-space-id">Manual Space ID</Label>
                <Input
                  id="webex-manual-space-id"
                  value={manualSpaceId}
                  onChange={(event) => setManualSpaceId(event.target.value)}
                  placeholder="space ID from Webex"
                  disabled={disabled || loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="webex-manual-space-name">Manual Space Name</Label>
                <Input
                  id="webex-manual-space-name"
                  value={manualSpaceName}
                  onChange={(event) => setManualSpaceName(event.target.value)}
                  placeholder="Optional display name"
                  disabled={disabled || loading}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={applyManualSpaceDefaults}
              disabled={disabled || loading || !defaultTeamSlug || !defaultAgentId || !manualSpaceId.trim()}
            >
              Add Space & Apply Defaults
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={applyMigrationDefaults}
              disabled={disabled || loading || !defaultTeamSlug || !defaultAgentId || spaces.length === 0}
            >
              {loading ? "Applying..." : "Apply Defaults To Webex Spaces"}
            </Button>
            <Button type="button" variant="outline" onClick={refreshDefaults} disabled={disabled || loading}>
              Refresh lists
            </Button>
            <span className="text-xs text-muted-foreground">
              {spaces.length} spaces loaded, {unassignedSpaceCount} without a team.
            </span>
          </div>
        </div>

        <Dialog open={migrationConfirmOpen} onOpenChange={setMigrationConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Apply Webex space association defaults?</DialogTitle>
              <DialogDescription>
                This will update {spaces.length} onboarded Webex space{spaces.length === 1 ? "" : "s"}.
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
                <span className="font-medium">Unassigned spaces:</span>{" "}
                {unassignedSpaceCount}
              </div>
              <div>
                <span className="font-medium">Routes:</span>{" "}
                {createDefaultRoutes ? "Create matching Webex routes" : "Do not create Webex routes"}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This ensures space grants and the default team grant in OpenFGA. Existing grants are left in place.
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
              <Button
                type="button"
                onClick={() => void confirmMigrationDefaults()}
                disabled={disabled || loading}
              >
                {loading ? "Applying..." : "Apply defaults"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={manualSpaceConfirmOpen} onOpenChange={setManualSpaceConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Webex space and apply defaults?</DialogTitle>
              <DialogDescription>
                This will onboard one manually entered Webex space and apply the selected defaults.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
              <div>
                <span className="font-medium">Space ID:</span>{" "}
                <code>{manualSpaceId.trim()}</code>
              </div>
              <div>
                <span className="font-medium">Space name:</span>{" "}
                {manualSpaceName.trim() || manualSpaceId.trim()}
              </div>
              <div>
                <span className="font-medium">Default team:</span>{" "}
                <code>team:{defaultTeamSlug}</code>
              </div>
              <div>
                <span className="font-medium">Default Dynamic Agent:</span>{" "}
                <code>agent:{defaultAgentId}</code>
              </div>
              <div>
                <span className="font-medium">Routes:</span>{" "}
                {createDefaultRoutes ? "Create a matching Webex route if one is missing" : "Do not create Webex routes"}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Existing route metadata for this space and agent is preserved, including routes created by Sync From Config.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setManualSpaceConfirmOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void confirmMigrationDefaults([
                    {
                      id: manualSpaceId.trim(),
                      name: manualSpaceName.trim() || undefined,
                    },
                  ])
                }
                disabled={disabled || loading || !manualSpaceId.trim()}
              >
                {loading ? "Applying..." : "Apply space defaults"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div
          role="region"
          aria-label="Step 2a: Verify Webex Space ReBAC"
          data-section-tone="violet"
          data-section-order="2"
          className="order-2 rounded-md border border-violet-500/25 bg-violet-500/5 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Step 2a: Verify Webex Space ReBAC</h3>
              <p className="text-xs text-muted-foreground">
                Preflight checks for the selected space using the same OpenFGA tuple and route metadata shape the Webex bot depends on.
              </p>
            </div>
            {diagnostics && (
              <Badge variant={diagnostics.warnings.length > 0 ? "outline" : "default"}>
                {diagnostics.warnings.length > 0 ? `${diagnostics.warnings.length} warning${diagnostics.warnings.length === 1 ? "" : "s"}` : "healthy"}
              </Badge>
            )}
          </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="webex-space-select">Space</Label>
            <select
              id="webex-space-select"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedKey}
              onChange={(event) => {
                setSelectedKey(event.target.value);
                setRoutePendingDelete(null);
              }}
              disabled={disabled || loading}
            >
              <option value="">Select a space</option>
              {spaces.map((space) => (
                <option
                  key={`${space.workspace_id}/${space.space_id}`}
                  value={`${space.workspace_id}/${space.space_id}`}
                >
                  {space.space_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Selected Scope</Label>
            <div className="rounded-md border p-3 text-sm">
              {selected ? (
                <>
                  <div className="font-medium">{selected.space_name}</div>
                  <div className="text-muted-foreground">
                    {selected.space_id}
                  </div>
                  {selected.team_slug && <Badge variant="secondary">team:{selected.team_slug}</Badge>}
                </>
              ) : (
                <span className="text-muted-foreground">No space selected</span>
              )}
            </div>
          </div>
        </div>

          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a Webex space to run diagnostics.</p>
          ) : !diagnostics ? (
            <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
          ) : (
            <>
              <div className="grid gap-2 text-sm md:grid-cols-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">OpenFGA</div>
                  <div className="font-medium">{diagnostics.openfga.reachable ? "reachable" : "unreachable"}</div>
                  <div className="text-xs text-muted-foreground">{diagnostics.openfga.tuple_count} space-agent tuples</div>
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
              {diagnosticsMissingRouteableAgent && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-500/40 bg-cyan-50 p-3 text-sm text-cyan-950 dark:bg-cyan-950/30 dark:text-cyan-100">
                  <div>
                    <div className="font-medium">Auto-fix missing Webex association</div>
                    <div className="text-xs">
                      Create an OpenFGA-backed route with listen mode <code>all</code> so the Webex
                      runtime has an agent to dispatch.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void fixMissingRouteableAgent()}
                    disabled={disabled || loading || !missingAssociationAutoFixAgentId}
                  >
                    {missingAssociationAutoFixAgentId
                      ? `Fix missing association with agent:${missingAssociationAutoFixAgentId}`
                      : "Select an agent to auto-fix"}
                  </Button>
                  {!missingAssociationAutoFixAgentId && (
                    <div className="basis-full text-xs">
                      Select a Dynamic Agent below or configure a default Dynamic Agent first.
                    </div>
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

        <div
          role="region"
          aria-label="Step 2b: Specify agent priority"
          data-section-tone="violet"
          data-section-order="2b"
          className="order-2 rounded-md border border-violet-500/25 bg-violet-500/5 p-4 space-y-3"
        >
          <div>
            <h3 className="text-base font-semibold tracking-tight">Step 2b: Specify agent priority</h3>
            <p className="text-xs text-muted-foreground">
              Creating an association writes the OpenFGA space <code>can_use agent</code>{" "}
              tuple. Listen mode and priority are saved as dependent route metadata.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="webex-route-agent-id">Dynamic Agent</Label>
              <select
                id="webex-route-agent-id"
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
              <Label htmlFor="webex-route-listen">Listen</Label>
              <select
                id="webex-route-listen"
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
              <Label htmlFor="webex-route-priority">Priority</Label>
              <Input
                id="webex-route-priority"
                type="number"
                value={routePriority}
                onChange={(event) => {
                  const next =
                    event.target.value === "" ? Number.NaN : Number(event.target.value);
                  setRoutePriority(normalizeRoutePriority(next));
                }}
                disabled={disabled || loading}
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
              <DialogTitle>Delete space-agent association?</DialogTitle>
              <DialogDescription>
                {routePendingDelete
                  ? `This removes agent:${routePendingDelete.agent_id} from the selected Webex space.`
                  : "This removes the selected agent from the Webex space."}
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
