"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  KeycloakInvariant,
  KeycloakInvariantStatus,
} from "@/lib/rbac/keycloak-invariants";

import { explainInvariant } from "./invariant-explanations";
import {
  buildTeamScopeMatrix,
  filterTeamScopeRows,
  TEAM_SCOPE_KIND_DESCRIPTIONS,
  TEAM_SCOPE_KIND_LABELS,
  TEAM_SCOPE_KIND_ORDER,
  type TeamScopeKind,
  type TeamScopeRow,
} from "./team-scope-matrix";

/**
 * Matrix view of the `team-scope` invariant family — replaces the
 * flat list inside the Keycloak Migration Health Panel for **every**
 * realm size, not just large ones. (We deliberately do not gate this
 * behind a team-count threshold; one code path = one mental model =
 * less to test and maintain.)
 *
 * Layout, top to bottom:
 *
 *   ┌─ summary strip ─────────────────────────────────────────────┐
 *   │ N teams · X pass · Y fail · Z unknown · [Reconcile all]     │
 *   └─────────────────────────────────────────────────────────────┘
 *   ┌─ advisory (team-personal DM-mode), if present ──────────────┐
 *   │ ⓘ ... + Manual pill + copy button                            │
 *   └─────────────────────────────────────────────────────────────┘
 *   ┌─ filter bar ────────────────────────────────────────────────┐
 *   │ [search slug…] [☐ failing only] [chips: Mapper · Slack · …] │
 *   └─────────────────────────────────────────────────────────────┘
 *   ┌─ matrix table ──────────────────────────────────────────────┐
 *   │ slug ↓ │ Mapper⚒ │ Slack⚒ │ Webex⚒ │ Audience⚒ │ Fix │  ⌃   │
 *   │ team-… │   ●     │   ●    │   ●    │   ●       │ [Fix] │ >  │
 *   │  └ expanded: 4 full invariant rows (with HelpCircle etc.)   │
 *   │ team-… │   ●     │   ●    │   ●    │   N/A     │ [Fix] │ >  │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Each column header carries a per-kind Fix affordance that fires the
 * same global reconcile migration but pins the spinner to the header
 * row, so admins see "fixing Slack-bot bindings" instead of a generic
 * "reconciling…" pulse. The honesty callout under the matrix makes
 * this explicit so nobody thinks the per-kind / per-team Fix buttons
 * are doing a narrower repair than they actually are.
 *
 * All filters are local UI state — the underlying matrix and its
 * counts always reflect the full unfiltered set, so the summary
 * strip and the Copy diagnostics JSON never become a function of
 * the admin's filter choices.
 */
export function KeycloakTeamScopeMatrix({
  items,
  reconciling,
  reconcileOriginId,
  onFixOne,
  hideSummaryStrip = false,
}: {
  items: KeycloakInvariant[];
  reconciling: boolean;
  /** `null` while idle or a "Reconcile all" run; otherwise the originId of the row that initiated the fix. */
  reconcileOriginId: string | null;
  onFixOne: (originId: string) => void | Promise<void>;
  /**
   * Suppress the matrix's own summary strip. Set when the matrix is
   * rendered inside an outer accordion whose header already shows
   * the pass/fail counts — keeps the panel from doubling up on the
   * same information.
   */
  hideSummaryStrip?: boolean;
}) {
  const matrix = useMemo(() => buildTeamScopeMatrix(items), [items]);

  const [slugQuery, setSlugQuery] = useState("");
  const [failingOnly, setFailingOnly] = useState(false);
  const [failureKinds, setFailureKinds] = useState<TeamScopeKind[]>([]);
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());

  const filteredRows = useMemo(
    () =>
      filterTeamScopeRows({
        rows: matrix.rows,
        slugQuery,
        failingOnly,
        failureKinds,
      }),
    [matrix.rows, slugQuery, failingOnly, failureKinds],
  );

  const toggleKindChip = (kind: TeamScopeKind) => {
    setFailureKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const toggleExpanded = (slug: string) => {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  if (matrix.rows.length === 0 && matrix.advisory === null) {
    // No teams emitted any team-scope invariants — show a non-zero
    // message so admins don't see a blank rectangle and wonder if the
    // panel is broken. This happens during cold start before the
    // first reconcile run.
    return (
      <div
        className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
        data-testid="team-scope-matrix-empty"
      >
        No team scopes have been reconciled yet. Run{" "}
        <span className="font-mono text-xs">Reconcile all</span> at the top of
        the card to provision them from MongoDB.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="team-scope-matrix">
      {!hideSummaryStrip && <TeamScopeSummaryStrip matrix={matrix} />}

      {matrix.advisory && (
        <TeamScopeAdvisoryRow advisory={matrix.advisory} />
      )}

      <TeamScopeFilterBar
        slugQuery={slugQuery}
        setSlugQuery={setSlugQuery}
        failingOnly={failingOnly}
        setFailingOnly={setFailingOnly}
        failureKinds={failureKinds}
        toggleKindChip={toggleKindChip}
        matrix={matrix}
        totalRows={matrix.rows.length}
        visibleRows={filteredRows.length}
      />

      {/*
        The honesty callout. We want admins to know up-front that
        per-team / per-kind Fix buttons all drive the same global
        reconcile — the difference is only which row's spinner
        activates. Without this people assume the buttons are
        scoped repairs.
      */}
      <p className="text-[11px] text-muted-foreground">
        Per-team and per-kind <span className="font-medium">Fix</span> buttons
        all run the same global Keycloak reconcile migration; the only
        difference is which row's <span className="font-mono">Fixing…</span>{" "}
        indicator activates. Use them to narrow your visual focus, not to
        narrow the actual repair scope.
      </p>

      <TeamScopeMatrixTable
        rows={filteredRows}
        totalRows={matrix.rows.length}
        expandedSlugs={expandedSlugs}
        onToggleExpanded={toggleExpanded}
        reconciling={reconciling}
        reconcileOriginId={reconcileOriginId}
        onFixOne={onFixOne}
        matrix={matrix}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Summary strip (the one thing happy-path admins ever look at)
// ────────────────────────────────────────────────────────────────────

function TeamScopeSummaryStrip({
  matrix,
}: {
  matrix: ReturnType<typeof buildTeamScopeMatrix>;
}) {
  const { teams, pass_count, fail_count, unknown_count } = matrix.summary;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs"
      data-testid="team-scope-summary"
    >
      <span className="font-medium" data-testid="team-scope-summary-teams">
        {teams} {teams === 1 ? "team" : "teams"}
      </span>
      <span className="text-muted-foreground">·</span>
      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
        {pass_count} pass
      </Badge>
      <Badge
        variant="outline"
        className={cn(
          fail_count > 0
            ? "border-red-300 text-red-700"
            : "border-muted text-muted-foreground",
        )}
      >
        {fail_count} fail
      </Badge>
      {unknown_count > 0 && (
        <Badge variant="outline" className="border-amber-300 text-amber-700">
          {unknown_count} unknown
        </Badge>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Advisory row (team_personal.dm_mode_known_limitation)
// ────────────────────────────────────────────────────────────────────

function TeamScopeAdvisoryRow({
  advisory,
}: {
  advisory: KeycloakInvariant;
}) {
  const explanation = explainInvariant(advisory.id);
  // Render the full detail (the BFF emits a multi-sentence detail
  // on this one) inline because the structural DM-mode limitation
  // is the one thing in this panel that genuinely needs prose to
  // understand. Hiding it behind a tooltip would be wrong.
  return (
    <div
      className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      data-testid="team-scope-advisory"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          <span>{advisory.description}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Explain ${advisory.description}: ${explanation.title}`}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-amber-700 transition-colors hover:text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  data-testid={`team-scope-advisory-explain`}
                >
                  <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={6}
                className="whitespace-normal max-w-sm w-max text-left font-normal leading-snug p-3"
              >
                <div className="space-y-1">
                  <p className="font-semibold text-popover-foreground">
                    {explanation.title}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {explanation.body}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            Manual
          </Badge>
          <CopyButton
            value={() =>
              `${advisory.description}\nID: ${advisory.id}\n${
                advisory.detail ?? ""
              }`
            }
            label="Copy advisory text"
            className="text-amber-900 hover:text-amber-900"
          />
        </div>
      </div>
      {advisory.detail && (
        <p className="leading-snug text-[11px]">{advisory.detail}</p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Filter bar (search + failing-only + failure-kind chips)
// ────────────────────────────────────────────────────────────────────

function TeamScopeFilterBar({
  slugQuery,
  setSlugQuery,
  failingOnly,
  setFailingOnly,
  failureKinds,
  toggleKindChip,
  matrix,
  totalRows,
  visibleRows,
}: {
  slugQuery: string;
  setSlugQuery: (v: string) => void;
  failingOnly: boolean;
  setFailingOnly: (v: boolean) => void;
  failureKinds: TeamScopeKind[];
  toggleKindChip: (kind: TeamScopeKind) => void;
  matrix: ReturnType<typeof buildTeamScopeMatrix>;
  totalRows: number;
  visibleRows: number;
}) {
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[180px]">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Search slug…"
            value={slugQuery}
            onChange={(e) => setSlugQuery(e.target.value)}
            className="h-8 pl-7 text-xs"
            aria-label="Filter teams by slug"
            data-testid="team-scope-slug-search"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={failingOnly}
            onChange={(e) => setFailingOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input"
            data-testid="team-scope-failing-only"
          />
          <span>Failing only</span>
        </label>
        <span
          className="ml-auto text-[11px] text-muted-foreground"
          data-testid="team-scope-row-count"
        >
          {visibleRows === totalRows
            ? `${totalRows} ${totalRows === 1 ? "team" : "teams"}`
            : `${visibleRows} of ${totalRows} teams`}
        </span>
      </div>
      {/* Per-failure-kind chips. Each chip shows the kind label and
          its failing+unknown count; clicking toggles the chip and
          composes with the other filters with AND semantics (see
          `filterTeamScopeRows`). */}
      <div
        className="flex flex-wrap items-center gap-1.5"
        data-testid="team-scope-kind-chips"
      >
        {TEAM_SCOPE_KIND_ORDER.map((kind) => {
          const sum = matrix.kind_summary[kind];
          const issueCount = sum.fail_count + sum.unknown_count;
          const active = failureKinds.includes(kind);
          const hasIssues = issueCount > 0;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKindChip(kind)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : hasIssues
                    ? "border-red-300 text-red-700 hover:bg-red-50"
                    : "border-muted text-muted-foreground hover:bg-muted",
              )}
              data-testid={`team-scope-kind-chip-${kind}`}
              aria-pressed={active}
              disabled={!hasIssues && !active}
              title={
                hasIssues
                  ? `${issueCount} ${TEAM_SCOPE_KIND_LABELS[kind]} ${issueCount === 1 ? "issue" : "issues"}`
                  : `No ${TEAM_SCOPE_KIND_LABELS[kind]} issues`
              }
            >
              {TEAM_SCOPE_KIND_LABELS[kind]}
              {hasIssues && <span className="ml-1">·{issueCount}</span>}
            </button>
          );
        })}
        {failureKinds.length > 0 && (
          <button
            type="button"
            onClick={() => {
              failureKinds.forEach(toggleKindChip);
            }}
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
            data-testid="team-scope-clear-kind-chips"
          >
            Clear kinds
          </button>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Matrix table
// ────────────────────────────────────────────────────────────────────

function TeamScopeMatrixTable({
  rows,
  totalRows,
  expandedSlugs,
  onToggleExpanded,
  reconciling,
  reconcileOriginId,
  onFixOne,
  matrix,
}: {
  rows: TeamScopeRow[];
  totalRows: number;
  expandedSlugs: Set<string>;
  onToggleExpanded: (slug: string) => void;
  reconciling: boolean;
  reconcileOriginId: string | null;
  onFixOne: (originId: string) => void | Promise<void>;
  matrix: ReturnType<typeof buildTeamScopeMatrix>;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground"
        data-testid="team-scope-matrix-no-matches"
      >
        No teams match the current filters.{" "}
        {totalRows > 0 && <>Try clearing the search or chips above.</>}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border">
      <table
        className="w-full border-collapse text-xs"
        data-testid="team-scope-matrix-table"
      >
        <colgroup>
          <col />
          {TEAM_SCOPE_KIND_ORDER.map((kind) => (
            <col key={kind} className="w-[80px]" />
          ))}
          <col className="w-[64px]" />
          <col className="w-[28px]" />
        </colgroup>
        <thead className="bg-muted/40">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Team slug</th>
            {TEAM_SCOPE_KIND_ORDER.map((kind) => (
              <KindHeaderCell
                key={kind}
                kind={kind}
                summary={matrix.kind_summary[kind]}
                reconciling={reconciling}
                reconcileOriginId={reconcileOriginId}
                onFixOne={onFixOne}
              />
            ))}
            <th className="px-2 py-1.5 text-left font-medium">Fix</th>
            <th aria-label="Expand" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TeamScopeMatrixRow
              key={row.slug}
              row={row}
              isExpanded={expandedSlugs.has(row.slug)}
              onToggleExpanded={() => onToggleExpanded(row.slug)}
              reconciling={reconciling}
              reconcileOriginId={reconcileOriginId}
              onFixOne={onFixOne}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PER_KIND_FIX_ORIGIN_PREFIX = "team-scope-kind:";
const PER_TEAM_FIX_ORIGIN_PREFIX = "team-scope-team:";

function KindHeaderCell({
  kind,
  summary,
  reconciling,
  reconcileOriginId,
  onFixOne,
}: {
  kind: TeamScopeKind;
  summary: { fail_count: number; unknown_count: number };
  reconciling: boolean;
  reconcileOriginId: string | null;
  onFixOne: (originId: string) => void | Promise<void>;
}) {
  const issueCount = summary.fail_count + summary.unknown_count;
  const originId = `${PER_KIND_FIX_ORIGIN_PREFIX}${kind}`;
  const isThisHeaderFixing = reconciling && reconcileOriginId === originId;
  return (
    <th
      className="px-2 py-1.5 text-left font-medium"
      data-testid={`team-scope-kind-header-${kind}`}
    >
      <div className="flex items-center gap-1">
        <span>{TEAM_SCOPE_KIND_LABELS[kind]}</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Explain ${TEAM_SCOPE_KIND_LABELS[kind]}`}
                className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <HelpCircle className="h-3 w-3" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={6}
              className="whitespace-normal max-w-sm w-max text-left font-normal leading-snug p-3"
            >
              <div className="space-y-1">
                <p className="font-semibold text-popover-foreground">
                  {TEAM_SCOPE_KIND_LABELS[kind]}
                </p>
                <p className="text-muted-foreground text-[11px]">
                  {TEAM_SCOPE_KIND_DESCRIPTIONS[kind]}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {issueCount > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ml-1 h-5 px-1 text-[10px]"
            onClick={() => onFixOne(originId)}
            disabled={reconciling}
            data-testid={`team-scope-kind-fix-${kind}`}
            title={`Fix all ${issueCount} ${TEAM_SCOPE_KIND_LABELS[kind]} ${issueCount === 1 ? "issue" : "issues"}`}
          >
            {isThisHeaderFixing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <>Fix {issueCount}</>
            )}
          </Button>
        )}
      </div>
    </th>
  );
}

function TeamScopeMatrixRow({
  row,
  isExpanded,
  onToggleExpanded,
  reconciling,
  reconcileOriginId,
  onFixOne,
}: {
  row: TeamScopeRow;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  reconciling: boolean;
  reconcileOriginId: string | null;
  onFixOne: (originId: string) => void | Promise<void>;
}) {
  const hasIssues = row.fail_count > 0 || row.unknown_count > 0;
  const originId = `${PER_TEAM_FIX_ORIGIN_PREFIX}${row.slug}`;
  const isThisRowFixing = reconciling && reconcileOriginId === originId;
  return (
    <>
      <tr
        className={cn(
          "border-t",
          hasIssues ? "bg-red-50/40 dark:bg-red-950/10" : "hover:bg-muted/30",
        )}
        data-testid={`team-scope-row-${row.slug}`}
      >
        <td className="px-2 py-1.5 font-mono text-[11px]">{row.slug}</td>
        {TEAM_SCOPE_KIND_ORDER.map((kind) => (
          <td
            key={kind}
            className="px-2 py-1.5"
            data-testid={`team-scope-cell-${row.slug}-${kind}`}
          >
            <StatusDot cell={row.cells[kind]} />
          </td>
        ))}
        <td className="px-2 py-1.5">
          {hasIssues && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[10px]"
              onClick={() => onFixOne(originId)}
              disabled={reconciling}
              data-testid={`team-scope-team-fix-${row.slug}`}
              title={`Fix the ${row.fail_count + row.unknown_count} issue${row.fail_count + row.unknown_count === 1 ? "" : "s"} on ${row.slug}`}
            >
              {isThisRowFixing ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <>Fix</>
              )}
            </Button>
          )}
        </td>
        <td className="px-2 py-1.5 text-right">
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-label={isExpanded ? `Collapse ${row.slug}` : `Expand ${row.slug}`}
            aria-expanded={isExpanded}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid={`team-scope-row-toggle-${row.slug}`}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr
          className="border-t bg-muted/20"
          data-testid={`team-scope-row-detail-${row.slug}`}
        >
          {/*
            The detail row is a single column spanning the whole
            table — admins see one card per invariant cell with the
            full description, the machine ID, the plain-English
            explainer tooltip from `invariant-explanations.ts`, and
            the per-cell Fix button (which itself just hands the
            originId back to the same global reconcile call).
          */}
          <td colSpan={TEAM_SCOPE_KIND_ORDER.length + 3} className="p-3">
            <ul className="space-y-1.5">
              {TEAM_SCOPE_KIND_ORDER.map((kind) => {
                const cell = row.cells[kind];
                if (!cell) {
                  return (
                    <li
                      key={kind}
                      className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                    >
                      <span className="font-mono">{kind}</span>
                      <span>N/A for {row.slug}</span>
                    </li>
                  );
                }
                return (
                  <ExpandedCellRow
                    key={kind}
                    cell={cell}
                    reconciling={reconciling}
                    reconcileOriginId={reconcileOriginId}
                    onFixOne={onFixOne}
                  />
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusDot({ cell }: { cell: KeycloakInvariant | undefined }) {
  if (!cell) {
    return (
      <span
        className="inline-flex items-center text-[10px] text-muted-foreground"
        title="No invariant emitted for this column (structural N/A)"
      >
        N/A
      </span>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-block h-2.5 w-2.5 rounded-full",
              statusDotClass(cell.status),
            )}
            data-testid={`team-scope-status-dot-${cell.id}`}
            data-status={cell.status}
          />
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="whitespace-normal max-w-xs text-left font-normal leading-snug p-2"
        >
          <p className="text-[11px]">
            <span className="font-semibold">{statusLabel(cell.status)}:</span>{" "}
            {cell.description}
          </p>
          {cell.detail && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {cell.detail}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function statusDotClass(status: KeycloakInvariantStatus): string {
  if (status === "pass") return "bg-emerald-500";
  if (status === "fail") return "bg-red-500";
  return "bg-amber-400";
}

function statusLabel(status: KeycloakInvariantStatus): string {
  if (status === "pass") return "Pass";
  if (status === "fail") return "Fail";
  return "Unknown";
}

function ExpandedCellRow({
  cell,
  reconciling,
  reconcileOriginId,
  onFixOne,
}: {
  cell: KeycloakInvariant;
  reconciling: boolean;
  reconcileOriginId: string | null;
  onFixOne: (originId: string) => void | Promise<void>;
}) {
  const isFailing = cell.status !== "pass";
  const isReconcileNow = cell.remediation === "reconcile_now" && isFailing;
  const isThisRowFixing = reconciling && reconcileOriginId === cell.id;
  const explanation = explainInvariant(cell.id);
  return (
    <li
      className="rounded border bg-background px-2 py-1.5"
      data-testid={`team-scope-expanded-cell-${cell.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 text-[11px]">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full",
                statusDotClass(cell.status),
              )}
              aria-hidden="true"
            />
            <span className="font-medium">{cell.description}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Explain ${cell.description}: ${explanation.title}`}
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    data-testid={`team-scope-expanded-explain-${cell.id}`}
                  >
                    <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={6}
                  className="whitespace-normal max-w-sm w-max text-left font-normal leading-snug p-3"
                >
                  <div className="space-y-1">
                    <p className="font-semibold text-popover-foreground">
                      {explanation.title}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      {explanation.body}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {cell.id}
          </div>
          {cell.detail && (
            <div className="text-[10px] text-muted-foreground">{cell.detail}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-1.5 py-0 text-[10px]",
              cell.status === "pass" && "border-emerald-300 text-emerald-700",
              cell.status === "fail" && "border-red-300 text-red-700",
              cell.status === "unknown" && "border-amber-300 text-amber-700",
            )}
          >
            {statusLabel(cell.status)}
          </span>
          {isReconcileNow && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[10px]"
              onClick={() => onFixOne(cell.id)}
              disabled={reconciling}
              data-testid={`team-scope-expanded-fix-${cell.id}`}
            >
              {isThisRowFixing ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  Fixing…
                </>
              ) : (
                "Fix"
              )}
            </Button>
          )}
          {cell.remediation === "manual_keycloak" && isFailing && (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              Manual
            </Badge>
          )}
        </div>
      </div>
    </li>
  );
}

// Unused exports silence the linter for now; they may surface in
// future tests but the StatusDot / labels are tested transitively
// through the panel tests.
export const __testOnly = {
  PER_KIND_FIX_ORIGIN_PREFIX,
  PER_TEAM_FIX_ORIGIN_PREFIX,
};
