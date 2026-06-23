"use client";

import { ChevronRight,FileUp,HelpCircle,RefreshCw,RotateCw,Settings2 } from "lucide-react";
import React,{ useCallback,useEffect,useMemo,useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import {
Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip";
import { useSubtabParam } from "@/hooks/use-subtab-param";
import { cn } from "@/lib/utils";
import { routeStatusLabel } from "@/lib/rbac/connector-diagnostic-messages";
import { ConnectorOnboardingWizard } from "./ConnectorOnboardingWizard";
import type {
ConnectorAdminAdapter,
DiagnosticRoute,
DiscoveredItem,
DynamicAgentOption,
ItemAgentRoute,
ItemDiagnostics,
ItemSummary,
RuntimeStatus,
RuntimeSyncSummary,
SyncPreviewAgent,
SyncPreviewChannel,
TeamOption,
} from "./connector-admin-adapter";

type PanelView = "channels" | "onboard" | "advanced";
const PANEL_VIEWS: readonly PanelView[] = ["channels", "onboard", "advanced"];
type SyncModalMode = "preview" | "apply";
type SyncModalStatus = "idle" | "loading" | "success" | "error";

function HelpTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${label}`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-normal break-words text-xs">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function RuntimeTile({
  label,
  description,
  children,
}: {
  label: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <HelpTooltip label={label}>{description}</HelpTooltip>
      </div>
      {children}
    </div>
  );
}

function AdvancedActionButton({
  label,
  description,
  icon,
  onClick,
  disabled,
  variant = "outline",
}: {
  label: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={variant} onClick={onClick} disabled={disabled}>
          {icon}
          {label}
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-normal break-words text-xs">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}
function agentLabel(agent: DynamicAgentOption): string {
  return `${agent.name || agent._id} (${agent._id})`;
}
function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ── Sync preview breakdown ────────────────────────────────────────────────────
// Renders the full per-channel/agent detail returned by the import preview so
// admins can see every option (teams, listen modes, allow lists, overthink,
// escalation) before writing anything.

function summarizeEscalation(esc: SyncPreviewAgent["escalation"]): string[] {
  if (!esc) return [];
  const parts: string[] = [];
  if (esc.victorops?.enabled) parts.push(`VictorOps${esc.victorops.team ? ` (${esc.victorops.team})` : ""}`);
  if (esc.emoji?.enabled) parts.push(`emoji :${esc.emoji.name || "eyes"}:`);
  if (esc.users && esc.users.length > 0) parts.push(`ping ${pluralize(esc.users.length, "user")}`);
  if (esc.delete_admins && esc.delete_admins.length > 0) parts.push(`${pluralize(esc.delete_admins.length, "delete admin")}`);
  return parts;
}

function SyncPreviewSide({ label, side }: {
  label: string;
  side: SyncPreviewAgent["users"] | SyncPreviewAgent["bots"];
}) {
  if (!side) return null;
  const listLabel = label === "Users" ? "user_list" : "bot_list";
  const list = label === "Users"
    ? (side as SyncPreviewAgent["users"])?.user_list
    : (side as SyncPreviewAgent["bots"])?.bot_list;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Badge variant={side.enabled === false ? "outline" : "secondary"}>
        {side.enabled === false ? "disabled" : `listen: ${side.listen ?? "—"}`}
      </Badge>
      {side.overthink?.enabled && <Badge variant="outline">overthink</Badge>}
      {Array.isArray(list) && list.length > 0 && (
        <span className="text-xs text-muted-foreground">{listLabel}: {list.length}</span>
      )}
    </div>
  );
}

function SyncPreviewBreakdown({ channels }: { channels: SyncPreviewChannel[] }) {
  if (channels.length === 0) return null;
  const noTeamCount = channels.filter((c) => c.has_team === false).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What will be imported
        </div>
        {noTeamCount > 0 && (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            {pluralize(noTeamCount, "channel")} without a team
          </span>
        )}
      </div>
      {noTeamCount > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
          Channels marked <span className="font-medium">no team</span> import their agent routes, but the
          agent won&apos;t be invokable until the channel is assigned a team on the Onboard tab — Slack
          requires both a channel grant and a team grant.
        </div>
      )}
      <div className="max-h-72 space-y-2 overflow-auto rounded-md border bg-background/40 p-2">
        {channels.map((channel) => (
          <div key={`${channel.workspace_id ?? ""}/${channel.channel_id}`} className="rounded-md border bg-background/60 p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{channel.channel_name || channel.channel_id}</span>
              <span className="text-xs text-muted-foreground">{channel.channel_id}</span>
              {channel.has_team ? (
                <Badge variant="secondary">team:{channel.team_slug}</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">no team</Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{pluralize(channel.agents.length, "agent")}</span>
            </div>
            {channel.agents.length > 0 && (
              <div className="mt-2 space-y-2">
                {channel.agents.map((agent) => {
                  const escalation = summarizeEscalation(agent.escalation);
                  return (
                    <div key={agent.agent_id} className="rounded border bg-muted/20 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">agent:{agent.agent_id}</span>
                        {typeof agent.priority === "number" && (
                          <span className="text-xs text-muted-foreground">priority {agent.priority}</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <SyncPreviewSide label="Users" side={agent.users} />
                        <SyncPreviewSide label="Bots" side={agent.bots} />
                        {escalation.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground">Escalation</span>
                            {escalation.map((part) => <Badge key={part} variant="outline">{part}</Badge>)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function diagnosticsHasIssues(diagnostics: ItemDiagnostics | null): boolean {
  if (!diagnostics) return false;
  return (
    diagnostics.warnings.length > 0 ||
    diagnostics.openfga.reachable === false ||
    Boolean(diagnostics.last_runtime_error?.message) ||
    diagnostics.routes.length === 0 ||
    diagnostics.routes.some((route) => route.warnings.length > 0 || !route.openfga_tuple)
  );
}

function DiagnosticsPanel({
  adapter,
  selected,
  diagnostics,
  missingRouteableAgent,
  autoFixAgentId,
  fixDiagnosticRoute,
  fixAllDiagnosticIssues,
  batchFixAvailable,
  fixMissingRouteableAgent,
  disabled,
  loading,
  selectedCanManage,
}: {
  adapter: ConnectorAdminAdapter;
  selected: ItemSummary;
  diagnostics: ItemDiagnostics | null;
  missingRouteableAgent: boolean;
  autoFixAgentId: string;
  fixDiagnosticRoute: (route: DiagnosticRoute) => Promise<void> | void;
  fixAllDiagnosticIssues?: () => Promise<void> | void;
  batchFixAvailable?: boolean;
  fixMissingRouteableAgent: () => Promise<void> | void;
  disabled: boolean;
  loading: boolean;
  selectedCanManage: boolean;
}) {
  const hasIssues = diagnosticsHasIssues(diagnostics);
  const diagnosticsKey = `${selected.workspace_id}/${selected.item_id}/${diagnostics ? "loaded" : "loading"}/${hasIssues ? "issues" : "ok"}`;
  const [openState, setOpenState] = useState({ key: diagnosticsKey, open: hasIssues });
  const open = openState.key === diagnosticsKey ? openState.open : hasIssues;

  const summary = !diagnostics
    ? "Loading diagnostics..."
    : hasIssues
      ? `${diagnostics.warnings.length || diagnostics.routes.filter((route) => route.warnings.length > 0 || !route.openfga_tuple).length || 1} issue${diagnostics.warnings.length === 1 ? "" : "s"}`
      : `${diagnostics.openfga.tuple_count} authorized agent${diagnostics.openfga.tuple_count === 1 ? "" : "s"} · ${diagnostics.routes.length} route${diagnostics.routes.length === 1 ? "" : "s"} · healthy`;

  return (
    <div className="rounded-md border bg-background/60">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={() => setOpenState({ key: diagnosticsKey, open: !open })}
        aria-expanded={open}
      >
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Diagnostics</div>
          <div className="text-sm text-muted-foreground">{summary}</div>
        </div>
        <Badge variant={hasIssues ? "outline" : "secondary"} className={hasIssues ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>
          {hasIssues ? "review" : "healthy"}
        </Badge>
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          {!diagnostics ? (
            <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
          ) : (
            <>
              <div className="grid gap-2 text-sm md:grid-cols-3">
                <div className="rounded-md border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">Authorization</div>
                  <div className="font-medium">{diagnostics.openfga.reachable ? "reachable" : "unreachable"}</div>
                  <div className="text-xs text-muted-foreground">{diagnostics.openfga.tuple_count} authorized agent{diagnostics.openfga.tuple_count === 1 ? "" : "s"}</div>
                </div>
                <div className="rounded-md border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">Runtime routes</div>
                  <div className="font-medium">{diagnostics.routes.length}</div>
                  <div className="text-xs text-muted-foreground">Agents eligible to respond</div>
                </div>
                <div className="rounded-md border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">Last error</div>
                  <div className="font-medium">{diagnostics.last_runtime_error?.reason_code ?? "none"}</div>
                  <div className="text-xs text-muted-foreground">{diagnostics.last_runtime_error?.ts ?? "No recent runtime error"}</div>
                </div>
              </div>
              {diagnostics.warnings.length > 0 && (
                <div className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide">Issues found</div>
                    {batchFixAvailable && fixAllDiagnosticIssues && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void fixAllDiagnosticIssues()}
                        disabled={disabled || !selectedCanManage || loading}
                      >
                        Fix routing issues
                      </Button>
                    )}
                  </div>
                  {diagnostics.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
              )}
              {missingRouteableAgent && adapter.missingRouteableAgentAutoFix && (
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
                  {diagnostics.routes.map((route) => {
                    const labels = routeStatusLabel(route);
                    return (
                    <div key={route.agent_id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background/60 p-3 text-sm">
                      <span className="font-medium">{route.agent_id}</span>
                      <Badge variant={route.openfga_tuple ? "default" : "outline"}>
                        {labels.authBadge}
                      </Badge>
                      <Badge variant={route.route_metadata ? "secondary" : "outline"}>
                        {labels.routingBadge}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {labels.matchSummary}
                      </span>
                      {adapter.diagnosticRouteIsFixable(route) && (
                        <Button
                          type="button" variant="outline" size="sm" className="ml-auto"
                          onClick={() => void fixDiagnosticRoute(route)}
                          disabled={disabled || !selectedCanManage || loading}
                          aria-label={`Fix routing for ${route.agent_id}`}
                        >
                          Fix it
                        </Button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── ItemDetail subcomponent ───────────────────────────────────────────────────

interface ItemDetailProps {
  adapter: ConnectorAdminAdapter;
  selected: ItemSummary;
  diagnostics: ItemDiagnostics | null;
  routes: ItemAgentRoute[];
  dynamicAgents: DynamicAgentOption[];
  teams: TeamOption[];
  onRefresh: (nextRoutes?: ItemAgentRoute[]) => Promise<void> | void;
  onDeselect: () => void;
  setLoading: (loading: boolean) => void;
  setMessage: (message: string | null) => void;
  fixDiagnosticRoute: (route: DiagnosticRoute) => Promise<void> | void;
  fixAllDiagnosticIssues?: () => Promise<void> | void;
  batchFixAvailable?: boolean;
  fixMissingRouteableAgent: () => Promise<void> | void;
  disabled: boolean; loading: boolean; selectedCanManage: boolean; message: string | null;
}

function ItemDetail({
  adapter, selected, diagnostics, routes,
  dynamicAgents, teams, onRefresh, onDeselect, setLoading, setMessage,
  fixDiagnosticRoute, fixAllDiagnosticIssues, batchFixAvailable, fixMissingRouteableAgent, disabled, loading, selectedCanManage,
}: ItemDetailProps) {
  const diagnosticsMissingRouteableAgent =
    adapter.missingRouteableAgentAutoFix?.isApplicable(selected, diagnostics ?? {
      openfga: { reachable: false, tuple_count: 0 }, routes: [], warnings: [],
    }) ?? false;
  const autoFixAgentId = "";

  return (
    <div className="space-y-4">
      <DiagnosticsPanel
        adapter={adapter}
        selected={selected}
        diagnostics={diagnostics}
        missingRouteableAgent={diagnosticsMissingRouteableAgent}
        autoFixAgentId={autoFixAgentId}
        fixDiagnosticRoute={fixDiagnosticRoute}
        fixAllDiagnosticIssues={fixAllDiagnosticIssues}
        batchFixAvailable={batchFixAvailable}
        fixMissingRouteableAgent={fixMissingRouteableAgent}
        disabled={disabled}
        loading={loading}
        selectedCanManage={selectedCanManage}
      />

      {adapter.configuredDetailExtra?.({
        item: selected,
        routes,
        dynamicAgents,
        teams,
        disabled,
        loading,
        selectedCanManage,
        setLoading,
        setMessage,
        onRefresh,
        onDeselect,
        routesFor: adapter.api.routesFor,
        listApi: adapter.api.list,
      })}
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
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeSyncSummary, setRuntimeSyncSummary] = useState<RuntimeSyncSummary | null>(null);
  const [runtimeSyncModalOpen, setRuntimeSyncModalOpen] = useState(false);
  const [runtimeSyncModalMode, setRuntimeSyncModalMode] = useState<SyncModalMode>("preview");
  const [runtimeSyncModalStatus, setRuntimeSyncModalStatus] = useState<SyncModalStatus>("idle");
  const [runtimeSyncModalError, setRuntimeSyncModalError] = useState<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoveredItems, setDiscoveredItems] = useState<DiscoveredItem[]>([]);
  const [discoveredRows, setDiscoveredRows] = useState<Array<DiscoveredItem & { selected: boolean; team_slug: string; agent_id: string; is_existing: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Sub-tab (Configured / Onboard / Advanced) is mirrored to the `subtab` URL
  // param so admins can deep-link and refresh without losing their place. In
  // self-service mode there is no tab bar — the configured table always shows —
  // so `view` stays local there and the URL is left untouched.
  const [view, setView] = useSubtabParam(PANEL_VIEWS, "channels");
  const [configuredSearch, setConfiguredSearch] = useState("");
  const [discoverySearch, setDiscoverySearch] = useState("");

  const selected = useMemo(
    () => items.find((item) => adapter.itemKey(item) === selectedKey),
    [items, selectedKey, adapter],
  );
  const selectedCanManage = !selfService || selected?.can_manage === true;
  const unassignedCount = useMemo(() => items.filter((item) => !item.team_slug).length, [items]);
  const configuredItemIds = useMemo(() => new Set(items.map((item) => item.item_id)), [items]);
  const configuredItemsById = useMemo(() => new Map(items.map((item) => [item.item_id, item])), [items]);
  const filteredConfiguredItems = useMemo(() => {
    const query = configuredSearch.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [
        item.item_name,
        item.item_id,
        item.workspace_id,
        item.team_slug ?? "",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [configuredSearch, items]);
  const sortedDynamicAgents = useMemo(
    () => [...dynamicAgents].sort((a, b) => agentLabel(a).localeCompare(agentLabel(b))),
    [dynamicAgents],
  );
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

  const loadRuntimeStatus = useCallback(async () => {
    const res = await fetch(adapter.api.runtimeStatus);
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<Record<string, unknown>>(await res.json());
    setRuntimeStatus(adapter.parseRuntimeStatus(data));
  }, [adapter]);

  const refreshRuntimeStatus = async () => {
    setLoading(true); setMessage(null);
    try { await loadRuntimeStatus(); }
    catch (err) { setMessage(err instanceof Error ? err.message : `Failed to refresh ${adapter.connectorName} bot runtime status`); }
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
      if (!dryRun) {
        toast(
          `Config sync applied: upserted ${summary.routes_upserted} routes and wrote ${summary.openfga_tuples_written} OpenFGA tuples.`,
          "success"
        );
      }
      await Promise.all([loadRuntimeStatus(), loadItems(), loadRoutes(), loadDiagnostics()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to sync ${adapter.connectorName} bot config`;
      setRuntimeSyncModalError(msg); setRuntimeSyncModalStatus("error"); setMessage(msg);
    } finally { setLoading(false); }
  };

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
    toast(`Add an agent manually for this ${adapter.itemSingular}.`, "warning");
  };

  const batchFixAvailable = Boolean(
    selected &&
      diagnostics &&
      adapter.diagnosticIssuesBatchFixable?.({ diagnostics, routes }),
  );

  const fixAllDiagnosticIssues = adapter.fixAllDiagnosticIssues
    ? async () => {
        if (!selected || !diagnostics) return;
        setLoading(true);
        setMessage(null);
        try {
          const result = await adapter.fixAllDiagnosticIssues!({
            item: selected,
            diagnostics,
            routes,
          });
          if (result.nextRoutes) setRoutes(result.nextRoutes);
          await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
          toast(result.toast, "success");
        } catch (err) {
          setMessage(err instanceof Error ? err.message : "Failed to fix routing issues");
        } finally {
          setLoading(false);
        }
      }
    : undefined;

  // ── Discovery / onboarding ───────────────────────────────────────────────────

  const discoverItems = async () => {
    setDiscoverLoading(true); setDiscoverError(null); setMessage(null);
    try {
      const discovered: DiscoveredItem[] = [];
      let cursor: string | null = null;
      let page = 0;
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
      setDiscoveredRows(discovered.map((item) => {
        const existing = configuredItemsById.get(item.id);
        const isExisting = configuredItemIds.has(item.id);
        const isSetupComplete = Boolean(existing?.team_slug && (existing.active_grants ?? 0) > 0);
        // Slack: never auto-select (admin opts in per row).
        // Webex: auto-select new items when there are new ones to onboard.
        const autoSelect = adapter.discoveryAutoSelectNewItems
          ? (hasNewItems ? !isExisting : true)
          : false;
        return { ...item, selected: autoSelect, team_slug: "", agent_id: "", is_existing: isSetupComplete };
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
        defaultTeamSlug: "", defaultAgentId: "", createDefaultRoutes: true, fetchFn: fetch,
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
          <div role="region" aria-label={adapter.ariaLabels.advancedRegion} className="space-y-3">
            <div
              data-section-tone="slate"
              className="rounded-md border border-slate-500/20 bg-slate-500/5 p-4 space-y-3"
            >
              <div>
                <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
                  <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {adapter.copy.advancedHeading}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {adapter.copy.advancedSectionDescription ?? adapter.copy.advancedTabDescription}
                </p>
              </div>
              <div className={`grid gap-2 text-sm ${adapter.advancedExtraTiles ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
                <RuntimeTile
                  label="Route mode"
                  description={`Shows whether the ${adapter.copy.botNameInLegend} reads routes from database, YAML, or both.`}
                >
                  <div className="font-medium">{runtimeStatus?.route_mode ?? "unknown"}</div>
                </RuntimeTile>
                <RuntimeTile
                  label="Static config"
                  description={`Counts ${adapter.itemPlural}/routes currently loaded from ${adapter.copy.botNameInLegend} YAML.`}
                >
                  <div className="font-medium">{runtimeStatus ? adapter.staticConfigLabel({ items: Object.values(runtimeStatus.static_config)[0] ?? 0, routes: Object.values(runtimeStatus.static_config)[1] ?? 0 }) : "unknown"}</div>
                </RuntimeTile>
                <RuntimeTile
                  label="Route cache"
                  description={`Shows cached runtime ${adapter.itemSingular} routes and how soon they expire.`}
                >
                  <div className="font-medium">{runtimeStatus ? adapter.routeCacheLabel(runtimeStatus.route_cache.cache_size) : "unknown"}</div>
                  <div className="text-xs text-muted-foreground">TTL {runtimeStatus?.route_cache.ttl_seconds ?? "?"}s</div>
                </RuntimeTile>
                {runtimeStatus && adapter.advancedExtraTiles?.(runtimeStatus).map((tile) => (
                  <RuntimeTile key={tile.label} label={tile.label} description={tile.description}>
                    <div className="font-medium">{tile.value}</div>
                  </RuntimeTile>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AdvancedActionButton
                  label="Refresh Runtime Status"
                  description="Reloads these status numbers from the running bot."
                  icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void refreshRuntimeStatus()}
                  disabled={disabled || loading}
                />
                <AdvancedActionButton
                  label="Reload Bot Cache"
                  description="Refreshes the running bot after UI route changes."
                  icon={<RotateCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void reloadBotRoutes()}
                  disabled={disabled || loading}
                />
                <div className="inline-flex items-center gap-1">
                  <Button type="button" onClick={() => void syncBotConfig(true)} disabled={disabled || loading}><FileUp className="h-4 w-4" aria-hidden="true" />Import from YAML</Button>
                </div>
              </div>
            </div>
            {adapter.advancedTabExtraSection?.({ disabled })}
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
                    : "Static config sync is upsert-only and leaves existing UI-managed channel agents in place."}
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
              {runtimeSyncSummary?.channels && runtimeSyncSummary.channels.length > 0 && (
                <SyncPreviewBreakdown channels={runtimeSyncSummary.channels} />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuntimeSyncModalOpen(false)} disabled={runtimeSyncModalStatus === "loading"}>Close</Button>
              {runtimeSyncModalMode === "preview" && runtimeSyncModalStatus === "success" && (
                <Button type="button" onClick={() => void syncBotConfig(false)} disabled={disabled || loading}><FileUp className="h-4 w-4" aria-hidden="true" />Apply Import</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
            <div className="flex flex-col gap-2 border-b bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium">
                {filteredConfiguredItems.length === items.length
                  ? `${items.length} configured ${adapter.itemPlural}`
                  : `${filteredConfiguredItems.length} of ${items.length} ${adapter.itemPlural}`}
              </div>
              <div className="flex w-full gap-2 sm:max-w-sm">
                <Input
                  value={configuredSearch}
                  onChange={(event) => setConfiguredSearch(event.target.value)}
                  placeholder={`Search ${adapter.itemPlural}`}
                  aria-label={`Search configured ${adapter.itemPlural}`}
                  className="h-8"
                />
                {configuredSearch && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfiguredSearch("")}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
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
                  {filteredConfiguredItems.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No configured {adapter.itemPlural} match “{configuredSearch.trim()}”.
                      </td>
                    </tr>
                  )}
                  {filteredConfiguredItems.map((item) => {
                    const key = adapter.itemKey(item);
                    const isSelected = key === selectedKey;
                    const grants = item.active_grants ?? 0;
                    const warningsCount = isSelected && diagnostics
                      ? diagnostics.warnings.length : item.health?.warnings_count;
                    const health = !item.team_slug
                      ? { label: "no team", className: "border-amber-300 bg-amber-50 text-amber-800" }
                      : typeof warningsCount === "number"
                        ? warningsCount > 0
                          ? { label: `${warningsCount} issue${warningsCount === 1 ? "" : "s"}`, className: "border-amber-300 bg-amber-50 text-amber-800" }
                          : { label: "healthy", className: "border-emerald-300 bg-emerald-50 text-emerald-700" }
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
                                dynamicAgents={dynamicAgents}
                                teams={teams}
                                setLoading={setLoading}
                                setMessage={setMessage}
                                onRefresh={async (nextRoutes) => {
                                  if (nextRoutes) setRoutes(nextRoutes);
                                  await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
                                }}
                                onDeselect={() => setSelectedKey("")}
                                fixDiagnosticRoute={fixDiagnosticRoute}
                                fixAllDiagnosticIssues={fixAllDiagnosticIssues}
                                batchFixAvailable={batchFixAvailable}
                                fixMissingRouteableAgent={fixMissingRouteableAgent}
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

      </CardContent>
    </Card>
  );
}
