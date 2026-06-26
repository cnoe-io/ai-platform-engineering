"use client";

import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  DiscoveryCacheControls,
  type DiscoveryCacheProvider,
} from "@/components/admin/rebac/DiscoveryCacheControls";
import {
  AgentPicker,
  type AgentPickerOption,
} from "@/components/ui/agent-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { Input } from "@/components/ui/input";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { cn } from "@/lib/utils";

export interface ConnectorOnboardingOption {
  value: string;
  label: string;
}

export interface ConnectorOnboardingRow {
  id: string;
  name: string;
  secondary: string;
  selected: boolean;
  teamSlug: string;
  agentId: string;
  isExisting: boolean;
  teamRequired?: boolean;
  selectable?: boolean;
  importLabel: string;
  teamLabel: string;
  agentLabel: string;
}

interface ConnectorOnboardingWizardProps {
  /** Kept on the type for backward compat with existing call sites; the
   * wizard's labels now derive from itemSingular/itemPlural so this is
   * no longer read internally. */
  connectorName?: string;
  /**
   * Machine-readable connector id used to scope the inline discovery
   * cache controls. Drives which `/api/admin/<provider>/available-...`
   * route the "Force refresh" button invalidates. Optional so existing
   * callers (and tests) that don't render the cache controls keep
   * working; callers that pass it get the inline popover next to the
   * Find button.
   */
  provider?: DiscoveryCacheProvider;
  /** Whether the current viewer can edit platform config. Falls back to
   * read-only mode in the popover when false. */
  isAdmin?: boolean;
  itemSingular: string;
  itemPlural: string;
  header?: ReactNode;
  discoveredLabel: string;
  findLabel: string;
  refreshLabel: string;
  loadingLabel: string;
  emptyLabel: string;
  description: string;
  discoveryStatusText: string;
  discoveredCount: number;
  configuredCount: number;
  newCount: number;
  selectedCount: number;
  rows: ConnectorOnboardingRow[];
  teams: ConnectorOnboardingOption[];
  agents: ConnectorOnboardingOption[];
  error: string | null;
  disabled: boolean;
  loading: boolean;
  discovering: boolean;
  /** True after at least one live discovery API fetch (not configured-only seed). */
  discoveryLiveFetched?: boolean;
  /** True while configured items are loading into the discovery table (Webex seed). */
  initialLoading?: boolean;
  initialLoadingLabel?: string;
  onDiscover: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRowChange: (
    id: string,
    updates: Partial<
      Pick<ConnectorOnboardingRow, "selected" | "teamSlug" | "agentId">
    >,
  ) => void;
  onApply: () => void;
  /** When provided, render a search box that filters the visible rows by
   * substring match against `row.name`/`row.secondary`. Optional so
   * existing callers (Webex) keep their current behavior unchanged. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** When true, search filters via the BFF (`q=`) and rows are not client-filtered. */
  serverSideSearch?: boolean;
  searchDisabled?: boolean;
  discoveryHasMore?: boolean;
  discoveryLoadingMore?: boolean;
  onLoadMore?: () => void;
  discoveryTotalMatches?: number | null;
  /** When provided, render a "Apply to selected rows" toolbar that lets
   * the admin pick a team + agent and stamp them onto every selected
   * row in one click. Bulk values are local to the toolbar; they only
   * affect rows when the admin clicks Apply. */
  enableBulkApply?: boolean;
}

type ReadinessState = "ready" | "needs_setup" | "blocked" | "skipped";

function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function rowIsSelectable(row: ConnectorOnboardingRow): boolean {
  return row.selectable !== false;
}

function rowNeedsTeam(row: ConnectorOnboardingRow): boolean {
  return row.teamRequired !== false;
}

function readinessFor(row: ConnectorOnboardingRow): {
  state: ReadinessState;
  label: string;
} {
  if (!rowIsSelectable(row)) {
    return { state: "skipped", label: "Personal DM" };
  }
  if (row.isExisting) {
    return { state: "ready", label: "Configured" };
  }
  if (!row.selected) {
    return { state: "skipped", label: "Not selected" };
  }
  if (rowNeedsTeam(row) && !row.teamSlug && !row.agentId) {
    return { state: "blocked", label: "Pick team and agent" };
  }
  if (rowNeedsTeam(row) && !row.teamSlug) {
    return { state: "blocked", label: "Pick a team" };
  }
  if (!row.agentId) {
    return { state: "blocked", label: "Pick an agent" };
  }
  return { state: "needs_setup", label: "Ready to set up" };
}

function readinessClass(state: ReadinessState): string {
  // "Ready to set up" reads as a positive, calm green now that the copy
  // explains it's a queued action rather than a problem. "Configured"
  // (already done) is a softer slate so the eye lands on rows that
  // actually need the admin's attention.
  if (state === "ready") return "border-slate-300 bg-slate-50 text-slate-700";
  if (state === "needs_setup")
    return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (state === "blocked") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-slate-300 bg-slate-50 text-slate-600";
}

function ReadinessIcon({ state }: { state: ReadinessState }) {
  if (state === "ready")
    return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  if (state === "needs_setup")
    return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  if (state === "blocked")
    return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  return <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function ConnectorOnboardingWizard({
  provider,
  isAdmin = false,
  itemSingular,
  itemPlural,
  header,
  findLabel,
  refreshLabel,
  loadingLabel,
  emptyLabel,
  description,
  discoveryStatusText,
  discoveredCount,
  newCount,
  selectedCount,
  rows,
  teams,
  agents,
  error,
  disabled,
  loading,
  discovering,
  discoveryLiveFetched = false,
  initialLoading = false,
  initialLoadingLabel = "Loading…",
  onDiscover,
  onSelectAll,
  onClearSelection,
  onRowChange,
  onApply,
  searchValue,
  onSearchChange,
  enableBulkApply = false,
  serverSideSearch = false,
  searchDisabled = false,
  discoveryHasMore = false,
  discoveryLoadingMore = false,
  onLoadMore,
  discoveryTotalMatches = null,
}: ConnectorOnboardingWizardProps) {
  const search = searchValue ?? "";
  const normalizedSearch = search.trim().toLowerCase();
  const visibleRows =
    serverSideSearch || !normalizedSearch
      ? rows
      : rows.filter((row) =>
          `${row.name} ${row.secondary}`
            .toLowerCase()
            .includes(normalizedSearch),
        );
  const selectedRows = rows.filter(
    (row) => row.selected && rowIsSelectable(row),
  );
  const blockedRows = selectedRows.filter(
    (row) => readinessFor(row).state === "blocked",
  );
  // Rows that will actually be set up when the admin clicks Apply: selected
  // and not blocked (they have both a team and an agent). Blocked rows are
  // skipped rather than blocking the whole batch, so one unconfigured row
  // can't strand the rows that are already ready to go.
  const readyRows = selectedRows.filter(
    (row) => readinessFor(row).state !== "blocked",
  );
  const applyDisabled =
    disabled || loading || Boolean(error) || readyRows.length === 0;
  const disabledReason =
    selectedRows.length === 0
      ? `Select at least one ${itemSingular} to set up.`
      : readyRows.length === 0
        ? `${pluralize(blockedRows.length, itemSingular)} need a team or Dynamic Agent before setup.`
        : null;
  // When some (but not all) selected rows are blocked, we still let the
  // admin apply the ready ones and just tell them which got skipped.
  const skipNote =
    !applyDisabled && blockedRows.length > 0
      ? `${pluralize(blockedRows.length, itemSingular)} will be skipped (need a team or Dynamic Agent).`
      : null;
  // Bulk-apply toolbar local state. The picks here only affect rows when
  // the admin clicks the dedicated Apply button — they don't quietly
  // overwrite per-row picks the moment the dropdown changes.
  const [bulkTeamSlug, setBulkTeamSlug] = useState("");
  const [bulkAgentId, setBulkAgentId] = useState("");
  const applyBulkToSelected = () => {
    selectedRows.forEach((row) => {
      const updates: Partial<
        Pick<ConnectorOnboardingRow, "teamSlug" | "agentId">
      > = {};
      if (bulkTeamSlug) updates.teamSlug = bulkTeamSlug;
      if (bulkAgentId) updates.agentId = bulkAgentId;
      if (Object.keys(updates).length > 0) onRowChange(row.id, updates);
    });
  };
  const bulkApplyDisabled =
    loading || selectedRows.length === 0 || (!bulkTeamSlug && !bulkAgentId);
  const discoveryBusy = discovering || initialLoading;
  const discoveryBusyLabel = discovering ? loadingLabel : initialLoadingLabel;
  const showFullDiscoveryLoading = discoveryBusy && rows.length === 0;
  const showDiscoveryResults =
    (error || discoveredCount > 0 || rows.length > 0) &&
    !showFullDiscoveryLoading;
  const showProgressBadges = newCount > 0 || selectedCount > 0;

  return (
    <div
      role="region"
      aria-label={`Configure ${itemPlural}`}
      data-section-tone="sky"
      className="space-y-3 rounded-md border bg-background/60 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {header ? (
          <div className="min-w-0">{header}</div>
        ) : (
          <div className="min-w-0" title={description}>
            <h3 className="text-base font-semibold tracking-tight">
              Configure {itemPlural}
            </h3>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDiscover}
            disabled={disabled || discoveryBusy}
          >
            {discovering ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}
            {discovering
              ? loadingLabel
              : discoveryLiveFetched
                ? refreshLabel
                : findLabel}
          </Button>
          {provider && (
            <DiscoveryCacheControls
              provider={provider}
              isAdmin={isAdmin}
              // After a force-refresh, kick off another discovery query so
              // the wizard reflects the fresh server-side snapshot without
              // the admin having to click "Find ..." again.
              onAfterRefresh={onDiscover}
            />
          )}
          <span
            role="status"
            aria-label={discoveryStatusText}
            className="hidden text-xs text-muted-foreground lg:inline"
          >
            {discoveryStatusText}
          </span>
        </div>
      </div>

      {showFullDiscoveryLoading && (
        <div
          role="status"
          aria-live="polite"
          aria-label={discoveryBusyLabel}
          data-testid="discovery-loading"
          className="flex min-h-[10rem] items-center justify-center rounded-md border border-dashed bg-muted/10 px-4 py-8"
        >
          <CAIPESpinner size="md" message={discoveryBusyLabel} />
        </div>
      )}

      {showDiscoveryResults && (
        <>
          {error ? (
            <div className="text-destructive">{error}</div>
          ) : (
            <>
              <div
                className={cn(
                  "flex flex-wrap items-center gap-2",
                  !showProgressBadges && "lg:hidden",
                )}
              >
                {newCount > 0 && (
                  <Badge variant="outline">New: {newCount}</Badge>
                )}
                {selectedCount > 0 && (
                  <Badge variant="outline">Selected: {selectedCount}</Badge>
                )}
                <span className="text-xs text-muted-foreground lg:hidden">
                  {discoveryStatusText}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onSearchChange && (
                  <label className="flex min-w-[18rem] max-w-xl flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring">
                    <Search
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      type="search"
                      aria-label={`Search ${itemPlural}`}
                      placeholder={`Search ${itemPlural} by name or ID...`}
                      value={search}
                      onChange={(event) => onSearchChange(event.target.value)}
                      disabled={searchDisabled}
                      className="h-auto min-w-0 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                    />
                    {normalizedSearch && !searchDisabled && (
                      <button
                        type="button"
                        aria-label={`Clear ${itemPlural} search`}
                        onClick={() => onSearchChange("")}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </label>
                )}
                {normalizedSearch && (
                  <span className="text-xs text-muted-foreground">
                    {serverSideSearch && discoveryTotalMatches !== null
                      ? `${visibleRows.length} shown · ${discoveryTotalMatches} match${discoveryTotalMatches === 1 ? "" : "es"}`
                      : `${visibleRows.length} of ${rows.length} ${itemPlural}`}
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSelectAll}
                  disabled={loading || rows.length === 0}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClearSelection}
                  disabled={loading || rows.length === 0}
                >
                  Clear selection
                </Button>
              </div>
              {enableBulkApply && (
                <div
                  role="region"
                  aria-label="Apply team and agent to selected rows"
                  className="flex flex-wrap items-end gap-2 rounded-md border bg-background/80 p-3"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Bulk apply to selected
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Pick a team and/or agent, then click Apply. Per-row picks
                      below override these.
                    </span>
                  </div>
                  <div className="min-w-[200px]">
                    <TeamPicker
                      ariaLabel="Bulk team for selected rows"
                      triggerClassName="h-9 text-sm"
                      value={bulkTeamSlug}
                      onChange={setBulkTeamSlug}
                      disabled={loading}
                      placeholder="Team (optional)"
                      searchPlaceholder="Search teams..."
                      options={teams.map<TeamPickerOption>((team) => ({
                        slug: team.value,
                        name: team.label,
                      }))}
                    />
                  </div>
                  <div className="min-w-[200px]">
                    <AgentPicker
                      ariaLabel="Bulk Dynamic Agent for selected rows"
                      triggerClassName="h-9 text-sm"
                      value={bulkAgentId}
                      onChange={setBulkAgentId}
                      disabled={loading}
                      placeholder="Agent (optional)"
                      searchPlaceholder="Search agents..."
                      options={agents.map<AgentPickerOption>((agent) => ({
                        value: agent.value,
                        label: agent.label,
                      }))}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={applyBulkToSelected}
                    disabled={bulkApplyDisabled}
                  >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    Apply to {pluralize(selectedRows.length, "selected row")}
                  </Button>
                </div>
              )}
              <div className="relative">
                {discovering && (
                  <div
                    role="status"
                    aria-live="polite"
                    aria-label={loadingLabel}
                    data-testid="discovery-loading-overlay"
                    className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/85 backdrop-blur-[1px]"
                  >
                    <CAIPESpinner size="md" message={loadingLabel} />
                  </div>
                )}
                <div className="max-h-[460px] overflow-auto rounded-md border bg-background/80">
                  <div className="grid min-w-[860px] grid-cols-[minmax(240px,1fr)_190px_220px_190px] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <div>
                      {itemSingular[0].toUpperCase() + itemSingular.slice(1)}
                    </div>
                    <div>Team</div>
                    <div>Dynamic Agent</div>
                    <div>Status</div>
                  </div>
                  {visibleRows.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      {rows.length === 0
                        ? emptyLabel
                        : `No ${itemPlural} match "${search}".`}
                    </div>
                  ) : (
                    visibleRows.map((row) => {
                      const readiness = readinessFor(row);
                      return (
                        <div
                          key={row.id}
                          className={cn(
                            "grid min-w-[860px] grid-cols-[minmax(240px,1fr)_190px_220px_190px] gap-3 border-b px-3 py-3 last:border-b-0",
                            readiness.state === "blocked" && "bg-amber-500/5",
                            readiness.state === "needs_setup" &&
                              "bg-emerald-500/5",
                          )}
                        >
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              aria-label={row.importLabel}
                              checked={
                                rowIsSelectable(row) ? row.selected : false
                              }
                              onChange={(event) =>
                                onRowChange(row.id, {
                                  selected: event.target.checked,
                                })
                              }
                              disabled={loading || !rowIsSelectable(row)}
                            />
                            <span>
                              <span className="font-medium">{row.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {row.secondary}
                              </span>
                            </span>
                          </label>
                          {/* assisted-by Codex Codex-sonnet-4-6 */}
                          {/* Editing a selectable row implies intent to set it up, so the checkbox follows. */}
                          {rowNeedsTeam(row) ? (
                            <TeamPicker
                              ariaLabel={row.teamLabel}
                              triggerClassName="h-9 text-sm"
                              value={row.teamSlug}
                              onChange={(value) =>
                                onRowChange(row.id, {
                                  teamSlug: value,
                                  selected: true,
                                })
                              }
                              disabled={loading || !rowIsSelectable(row)}
                              placeholder="Select team"
                              searchPlaceholder="Search teams..."
                              options={teams.map<TeamPickerOption>((team) => ({
                                slug: team.value,
                                name: team.label,
                              }))}
                            />
                          ) : (
                            <Badge
                              variant="outline"
                              className="w-fit border-slate-300 bg-slate-50 text-slate-700"
                            >
                              Personal DM
                            </Badge>
                          )}
                          {rowIsSelectable(row) ? (
                            <AgentPicker
                              ariaLabel={row.agentLabel}
                              triggerClassName="h-9 text-sm"
                              value={row.agentId}
                              onChange={(value) =>
                                onRowChange(row.id, {
                                  agentId: value,
                                  selected: true,
                                })
                              }
                              disabled={loading || !rowIsSelectable(row)}
                              placeholder="Select agent"
                              searchPlaceholder="Search agents..."
                              options={agents.map<AgentPickerOption>(
                                (agent) => ({
                                  value: agent.value,
                                  label: agent.label,
                                }),
                              )}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Direct user routing
                            </span>
                          )}
                          <div className="space-y-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                "w-fit gap-1.5",
                                readinessClass(readiness.state),
                              )}
                            >
                              <ReadinessIcon state={readiness.state} />
                              {readiness.label}
                            </Badge>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                {onLoadMore && discoveryHasMore && (
                  <div className="flex justify-center border-t bg-muted/20 px-3 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onLoadMore}
                      disabled={searchDisabled || discoveryLoadingMore}
                    >
                      {discoveryLoadingMore ? (
                        <>
                          <Loader2
                            className="mr-2 h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                          Loading more…
                        </>
                      ) : (
                        `Load more ${itemPlural}`
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div />
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onDiscover}
                  disabled={disabled || discoveryBusy}
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Refresh
                </Button>
                <Button
                  type="button"
                  onClick={onApply}
                  disabled={applyDisabled}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {loading
                    ? "Setting up..."
                    : `Set up ${pluralize(readyRows.length, itemSingular)}`}
                </Button>
              </div>
              {applyDisabled && disabledReason && (
                <div className="max-w-xs text-right text-xs text-muted-foreground">
                  {disabledReason}
                </div>
              )}
              {skipNote && (
                <div className="max-w-xs text-right text-xs text-amber-600">
                  {skipNote}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
