"use client";

import { AlertCircle, CheckCircle2, CircleDashed, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DiscoveryCacheControls,
  type DiscoveryCacheProvider,
} from "@/components/admin/rebac/DiscoveryCacheControls";

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
  importLabel: string;
  teamLabel: string;
  agentLabel: string;
}

interface ConnectorOnboardingWizardProps {
  connectorName: string;
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
  discoveredLabel: string;
  findLabel: string;
  refreshLabel: string;
  loadingLabel: string;
  emptyLabel: string;
  description: string;
  discoveryStatusText: string;
  discoveredCount: number;
  newCount: number;
  selectedCount: number;
  routeModeDescription: string;
  rows: ConnectorOnboardingRow[];
  teams: ConnectorOnboardingOption[];
  agents: ConnectorOnboardingOption[];
  error: string | null;
  disabled: boolean;
  loading: boolean;
  discovering: boolean;
  onDiscover: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRowChange: (
    id: string,
    updates: Partial<Pick<ConnectorOnboardingRow, "selected" | "teamSlug" | "agentId">>,
  ) => void;
  onApply: () => void;
}

type ReadinessState = "ready" | "needs_setup" | "blocked" | "skipped";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function readinessFor(row: ConnectorOnboardingRow): {
  state: ReadinessState;
  label: string;
  detail: string;
} {
  if (row.isExisting) {
    return {
      state: "ready",
      label: "Setup completed",
      detail: row.selected
        ? "Will be verified and refreshed if selected."
        : "Setup completed in CAIPE; select to refresh.",
    };
  }
  if (!row.selected) {
    return { state: "skipped", label: "Skipped", detail: "Not selected for setup." };
  }
  if (!row.teamSlug) {
    return { state: "blocked", label: "Blocked", detail: "Choose a team before setup." };
  }
  if (!row.agentId) {
    return { state: "blocked", label: "Blocked", detail: "Choose a Dynamic Agent before setup." };
  }
  return { state: "needs_setup", label: "Needs setup", detail: "Will be imported, granted, and routed." };
}

function readinessClass(state: ReadinessState): string {
  if (state === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (state === "needs_setup") return "border-amber-300 bg-amber-50 text-amber-800";
  if (state === "blocked") return "border-red-300 bg-red-50 text-red-700";
  return "border-slate-300 bg-slate-50 text-slate-600";
}

function ReadinessIcon({ state }: { state: ReadinessState }) {
  if (state === "ready") return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  if (state === "needs_setup") return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  if (state === "blocked") return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  return <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function ConnectorOnboardingWizard({
  connectorName,
  provider,
  isAdmin = false,
  itemSingular,
  itemPlural,
  discoveredLabel,
  findLabel,
  refreshLabel,
  loadingLabel,
  emptyLabel,
  description,
  discoveryStatusText,
  discoveredCount,
  newCount,
  selectedCount,
  routeModeDescription,
  rows,
  teams,
  agents,
  error,
  disabled,
  loading,
  discovering,
  onDiscover,
  onSelectAll,
  onClearSelection,
  onRowChange,
  onApply,
}: ConnectorOnboardingWizardProps) {
  const selectedRows = rows.filter((row) => row.selected);
  const blockedRows = selectedRows.filter((row) => {
    const readiness = readinessFor(row);
    return readiness.state === "blocked";
  });
  const applyDisabled = disabled || loading || Boolean(error) || selectedRows.length === 0 || blockedRows.length > 0;
  const disabledReason =
    selectedRows.length === 0
      ? `Select at least one ${itemSingular} to set up.`
      : blockedRows.length > 0
        ? `${pluralize(blockedRows.length, itemSingular)} need a team or Dynamic Agent before setup.`
        : null;

  return (
    <div
      role="region"
      aria-label="Step 1: Discover and Setup"
      data-section-tone="sky"
      data-section-order="1"
      className="order-1 space-y-4 rounded-md border border-sky-500/25 bg-sky-500/5 p-4 text-sm"
    >
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">Step 1: Discover and Setup</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="rounded-lg border bg-background/70 p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Onboarding path</div>
        <div className="grid gap-2 sm:grid-cols-4">
          {["Discover", "Configure", "Apply", "Verify"].map((step, index) => (
            <div key={step} className="flex items-center gap-2 rounded-md border bg-card/80 px-3 py-2 text-xs">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/10 font-semibold text-sky-700">
                {index + 1}
              </span>
              {step}
            </div>
          ))}
        </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onDiscover}
          disabled={disabled || loading || discovering}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {discovering ? loadingLabel : discoveredCount > 0 ? refreshLabel : findLabel}
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
          className="text-xs text-muted-foreground"
        >
          {discoveryStatusText}
        </span>
        </div>

        {(error || discoveredCount > 0) && (
          <>
          <div>
            <div className="font-medium">Review {itemPlural} found by the bot</div>
            <p className="text-xs text-muted-foreground">
              Select {itemPlural} to import, then choose team and Dynamic Agent per {itemSingular}.
            </p>
          </div>
          {error ? (
            <div className="text-destructive">{error}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{pluralize(discoveredCount, discoveredLabel)} discovered</Badge>
                <Badge variant="outline">{pluralize(newCount, `new ${itemSingular}`)} new</Badge>
                <Badge variant="outline">{pluralize(selectedCount, itemSingular)} selected</Badge>
                <span className="text-xs text-muted-foreground">Routes: {routeModeDescription}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onSelectAll} disabled={loading || rows.length === 0}>
                  Select all
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onClearSelection} disabled={loading || rows.length === 0}>
                  Clear selection
                </Button>
              </div>
              <div className="max-h-[460px] overflow-auto rounded-md border bg-background/80">
                <div className="grid min-w-[860px] grid-cols-[minmax(240px,1fr)_190px_220px_190px] gap-3 border-b bg-sky-500/5 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div>{itemSingular[0].toUpperCase() + itemSingular.slice(1)}</div>
                  <div>Team</div>
                  <div>Dynamic Agent</div>
                  <div>Setup readiness</div>
                </div>
                {rows.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground">{emptyLabel}</div>
                ) : (
                  rows.map((row) => {
                    const readiness = readinessFor(row);
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          "grid min-w-[860px] grid-cols-[minmax(240px,1fr)_190px_220px_190px] gap-3 border-b px-3 py-3 last:border-b-0",
                          readiness.state === "blocked" && "bg-red-500/5",
                          readiness.state === "needs_setup" && "bg-amber-500/5",
                        )}
                      >
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            aria-label={row.importLabel}
                            checked={row.selected}
                            onChange={(event) => onRowChange(row.id, { selected: event.target.checked })}
                            disabled={loading}
                          />
                          <span>
                            <span className="font-medium">{row.name}</span>
                            <span className="block text-xs text-muted-foreground">{row.secondary}</span>
                          </span>
                        </label>
                        <select
                          aria-label={row.teamLabel}
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={row.teamSlug}
                          onChange={(event) => onRowChange(row.id, { teamSlug: event.target.value })}
                          disabled={loading || !row.selected}
                        >
                          {!row.teamSlug && <option value="">Select team</option>}
                          {teams.map((team) => (
                            <option key={team.value} value={team.value}>
                              {team.label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={row.agentLabel}
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={row.agentId}
                          onChange={(event) => onRowChange(row.id, { agentId: event.target.value })}
                          disabled={loading || !row.selected}
                        >
                          {agents.map((agent) => (
                            <option key={agent.value} value={agent.value}>
                              {agent.label}
                            </option>
                          ))}
                        </select>
                        <div className="space-y-1">
                          <Badge variant="outline" className={cn("w-fit gap-1.5", readinessClass(readiness.state))}>
                            <ReadinessIcon state={readiness.state} />
                            {readiness.label}
                          </Badge>
                          <div className="text-xs text-muted-foreground">{readiness.detail}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-3xl text-xs text-muted-foreground">
              This setup imports only selected {itemPlural}, applies each row&apos;s team and agent, ensures grants,
              and creates missing default routes when route creation is enabled.
            </p>
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={onDiscover} disabled={disabled || loading || discovering}>
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Refresh setup status
                </Button>
                <Button type="button" onClick={onApply} disabled={applyDisabled}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {loading ? "Applying..." : `Set up selected ${connectorName} ${itemPlural}`}
                </Button>
              </div>
              {applyDisabled && disabledReason && (
                <div className="max-w-xs text-right text-xs text-muted-foreground">{disabledReason}</div>
              )}
            </div>
          </div>
          </>
        )}
    </div>
  );
}
