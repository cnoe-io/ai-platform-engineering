"use client";

/**
 * <TeamOwnershipFields> — the canonical group-based access-control control
 * bundle (spec 2026-06-03-unified-shareable-resource-rbac, US1, contract
 * ui-component.md).
 *
 * Renders, for any shareable resource (agent, datasource, MCP tool, future
 * types):
 *   - an owner-team picker (single-select; disabled on edit unless a transfer
 *     is in progress),
 *   - a share-with-teams multi-select,
 *   - an effective-access preview that names exactly the grants the next save
 *     will write (transparency, not decoration),
 *   - a read-only creator (provenance) line,
 *   - a not-a-member transfer confirmation when transferring to a team the
 *     caller does not belong to.
 *
 * The component is **controlled** and does not persist — the host editor saves
 * with its own button (consistent with the agent editor's button-save).
 *
 * Layout flexibility: the agent editor interleaves a visibility toggle between
 * the owner picker and the share section, and only shows sharing when
 * visibility is "team". Those are supported via `betweenOwnerAndShare` and
 * `showShare` so the agent editor can adopt this component without reordering
 * its UI (SC-006). RAG/MCP editors simply omit them.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
TeamMultiPicker,
TeamPicker,
type TeamPickerOption,
} from "@/components/ui/team-picker";

export interface TeamOwnershipFieldsProps {
  // ---- current values --------------------------------------------------
  ownerTeamSlug: string;
  sharedTeamSlugs: string[];
  /** Shown read-only for provenance/audit. */
  creatorSubject?: string | null;

  // ---- mode ------------------------------------------------------------
  /** Disables the owner picker (owner is immutable on edit) unless transferring. */
  isEditing: boolean;
  /** Surfaces a "Transfer ownership" affordance on edit. */
  allowTransfer?: boolean;
  /** Mark the owner field required (create flow); drives the inline error. */
  ownerRequired?: boolean;

  // ---- data ------------------------------------------------------------
  /** Teams shown in the share multi-select and used to resolve slugs. */
  availableTeams: TeamPickerOption[];
  /**
   * Teams shown in the owner picker, when the owner-eligible set differs from
   * the shareable set (e.g. the agent editor disables non-ownable teams and
   * suffixes the role). Defaults to `availableTeams`.
   */
  ownerTeamOptions?: TeamPickerOption[];
  /** Slugs of teams the caller belongs to — to detect "not a member of destination". */
  currentUserTeamSlugs: string[];

  // ---- callbacks -------------------------------------------------------
  onOwnerTeamChange: (slug: string) => void;
  onSharedTeamsChange: (slugs: string[]) => void;
  /** Called when a transfer is confirmed. `confirmedNotMember` is true when the
   *  caller acknowledged they are not a member of the destination team. */
  onTransfer?: (newOwnerSlug: string, confirmedNotMember: boolean) => void;

  disabled?: boolean;

  // ---- per-resource copy / layout -------------------------------------
  /** Singular noun for copy, e.g. "agent", "data source", "tool". Default "resource". */
  resourceNoun?: string;
  ownerLabel?: string;
  ownerHelpText?: React.ReactNode;
  shareLabel?: string;
  shareHelpText?: React.ReactNode;
  /** When false, the entire share section is hidden (e.g. agent visibility !== "team"). */
  showShare?: boolean;
  /** Rendered between the owner block and the share block (e.g. agent visibility toggle). */
  betweenOwnerAndShare?: React.ReactNode;
  /** Rendered at the bottom of the owner block (e.g. agent platform-admin warning). */
  ownerExtra?: React.ReactNode;
  /** Per-grant detail line in the effective-access preview. */
  renderGrantDetail?: (slug: string, kind: "owner" | "shared") => React.ReactNode;
  /**
   * Extra lines in the effective-access preview (e.g. `user:*` for platform
   * default agents). Shown above team grant lines.
   */
  extraGrantPreviewItems?: Array<{
    id: string;
    line: React.ReactNode;
    detail?: React.ReactNode;
  }>;
}

/** Resolve a share entry (slug or legacy _id) to a canonical slug via the options. */
function resolveSlug(entry: string, options: TeamPickerOption[]): string | null {
  const match = options.find(
    (o) => o.slug === entry || o.id === entry || o._id === entry,
  );
  return match?.slug ?? (typeof entry === "string" && entry.trim() ? entry : null);
}

export function TeamOwnershipFields(props: TeamOwnershipFieldsProps) {
  const {
    ownerTeamSlug,
    sharedTeamSlugs,
    creatorSubject,
    isEditing,
    allowTransfer = false,
    ownerRequired = false,
    availableTeams,
    ownerTeamOptions,
    currentUserTeamSlugs,
    onOwnerTeamChange,
    onSharedTeamsChange,
    onTransfer,
    disabled = false,
    resourceNoun = "resource",
    ownerLabel = "Owner Team",
    ownerHelpText,
    shareLabel = "Share with Teams",
    shareHelpText,
    showShare = true,
    betweenOwnerAndShare,
    ownerExtra,
    renderGrantDetail,
    extraGrantPreviewItems = [],
  } = props;

  // Transfer mode: only meaningful on edit when transfers are allowed. While
  // active, the owner picker is re-enabled so a new destination can be chosen.
  const [transferring, setTransferring] = React.useState(false);
  const ownerMissing = ownerRequired && !isEditing && !ownerTeamSlug?.trim();
  const ownerPickerDisabled = disabled || (isEditing && !transferring);

  const shareOptions = availableTeams.filter(
    (t): t is TeamPickerOption & { slug: string } => Boolean(t.slug),
  );
  const ownerOptions = (ownerTeamOptions ?? availableTeams).filter(
    (t): t is TeamPickerOption & { slug: string } => Boolean(t.slug),
  );

  // Effective grants = owner (if any) + shared (resolved to slugs, owner deduped).
  const ownerSlug = ownerTeamSlug?.trim() || null;
  const effectiveShared = sharedTeamSlugs
    .map((entry) => resolveSlug(entry, availableTeams))
    .filter((slug): slug is string => Boolean(slug))
    .filter((slug) => slug !== ownerSlug);
  const grants: Array<{ slug: string; kind: "owner" | "shared" }> = [
    ...(ownerSlug ? [{ slug: ownerSlug, kind: "owner" as const }] : []),
    ...effectiveShared.map((slug) => ({ slug, kind: "shared" as const })),
  ];

  function handleOwnerChange(slug: string) {
    if (transferring && allowTransfer) {
      const confirmedNotMember = !currentUserTeamSlugs.includes(slug);
      if (confirmedNotMember) {
        const ok = window.confirm(
          `You are not a member of "${slug}". Transferring ownership may remove your own access to this ${resourceNoun}. Continue?`,
        );
        if (!ok) return;
      }
      onOwnerTeamChange(slug);
      onTransfer?.(slug, confirmedNotMember);
      setTransferring(false);
      return;
    }
    onOwnerTeamChange(slug);
  }

  return (
    <div className="space-y-4">
      {/* Owner team ------------------------------------------------------ */}
      <div className="space-y-2 rounded-lg">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="ownerTeam">
            {ownerLabel}{" "}
            {ownerRequired && !isEditing && (
              <span className="text-destructive">*</span>
            )}
          </Label>
          {isEditing && allowTransfer && onTransfer && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setTransferring((t) => !t)}
            >
              {transferring ? "Cancel transfer" : "Transfer ownership"}
            </Button>
          )}
        </div>
        <TeamPicker
          id="ownerTeam"
          value={ownerTeamSlug}
          onChange={handleOwnerChange}
          disabled={ownerPickerDisabled}
          ariaInvalid={ownerMissing}
          ariaDescribedBy="owner-team-help"
          placeholder={`Select a team that will own this ${resourceNoun}`}
          searchPlaceholder="Search your teams..."
          emptyLabel={
            availableTeams.length === 0
              ? "You are not a member of any teams"
              : "No teams match"
          }
          options={ownerOptions}
        />
        <p id="owner-team-help" className="text-xs text-muted-foreground">
          {ownerHelpText ?? (
            <>
              Owner-team members can use the {resourceNoun}; owner-team admins
              can manage it.
            </>
          )}
        </p>
        {transferring && allowTransfer && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Pick the destination team. If you are not a member you will be asked
            to confirm — transferring may remove your own access.
          </p>
        )}
        {creatorSubject && (
          <p className="text-xs text-muted-foreground" data-testid="creator-subject">
            Created by <code>{creatorSubject}</code> (provenance only — does not
            grant access).
          </p>
        )}
        {ownerExtra}
      </div>

      {betweenOwnerAndShare}

      {/* Share with teams ------------------------------------------------ */}
      {showShare && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <Label className="text-sm">{shareLabel}</Label>
          {shareHelpText && (
            <p className="mb-3 text-xs text-muted-foreground">{shareHelpText}</p>
          )}
          {availableTeams.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              You are not a member of any teams.
            </p>
          ) : (
            <TeamMultiPicker
              options={shareOptions}
              selected={sharedTeamSlugs}
              onChange={onSharedTeamsChange}
              disabled={disabled}
              placeholder="Pick one or more teams to share with..."
              searchPlaceholder="Search your teams..."
              emptyLabel="No teams match"
            />
          )}

          {(extraGrantPreviewItems.length > 0 || grants.length > 0) && (
            <div
              role="note"
              aria-label="Effective access summary"
              className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <div className="mb-2 font-medium">
                On save, these OpenFGA grants will be written:
              </div>
              <ul className="space-y-1.5">
                {extraGrantPreviewItems.map(({ id, line, detail }) => (
                  <li key={id}>
                    {line}
                    {detail && (
                      <span className="block pl-4 text-amber-900/80 dark:text-amber-300/80">
                        {detail}
                      </span>
                    )}
                  </li>
                ))}
                {grants.map(({ slug, kind }) => (
                  <li key={`${kind}-${slug}`}>
                    <code>team:{slug}#member</code> can use this {resourceNoun}
                    {kind === "owner" && " (owner team)"}
                    {renderGrantDetail && (
                      <span className="block pl-4 text-amber-900/80 dark:text-amber-300/80">
                        {renderGrantDetail(slug, kind)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TeamOwnershipFields;
