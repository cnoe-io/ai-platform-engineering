/**
 * Route-orchestration helper for shareable resources
 * (spec 2026-06-03-unified-shareable-resource-rbac, User Story 1, contract R2).
 *
 * Generalizes the create/update flow that the dynamic-agents route performs by
 * hand: resolve the creator (set-once), validate the caller may use the owner
 * team, reject owner changes outside the transfer path, read the previous
 * owner/shared set from the config (config = source of truth), reconcile the
 * OpenFGA projection, and persist the next state back to the config.
 *
 * Any resource (agent, knowledge_base/data_source, mcp_tool, and future types)
 * composes this so it gets correct group-based access control without
 * re-implementing the dual-write dance. Enforcement at read/use time stays a
 * standard `requireResourcePermission` check at the resource's own routes.
 */

import { ApiError } from "@/lib/api-error";

import type { UniversalRebacResourceType } from "@/types/rbac-universal";
import type { OpenFgaReconcileResult } from "./openfga";
import {
reconcileShareableResource,
type ShareableResourceInput,
} from "./openfga-owned-resources";
import {
canTransferResourceOwnership,
requireResourcePermission,
type ResourceAuthzSession,
} from "./resource-authz";

/** Owner/shared/creator + org-scope state persisted on (and read from) config. */
export interface ShareableOwnershipState {
  ownerTeamSlug: string | null;
  sharedTeamSlugs: string[];
  creatorSubject: string | null;
  /** Org-wide sharing (types that support it, e.g. mcp_tool). */
  sharedWithOrg?: boolean;
}

export interface ShareableWriteContext {
  objectType: string;
  objectId: string;
  /** Used for the creator subject, membership checks, and the transfer guard. */
  session: ResourceAuthzSession;
  requestedOwnerTeamSlug?: string | null;
  requestedSharedTeamSlugs?: string[] | null;
  /** Org-wide sharing requested in the body (undefined → keep previous). */
  requestedSharedWithOrg?: boolean | null;
  /** Read the previously-persisted owner/shared/creator from the config. */
  loadPrevious: () => Promise<ShareableOwnershipState>;
  /** Persist the next owner/shared/creator to the config (source of truth). */
  persist: (next: ShareableOwnershipState) => Promise<void>;
  /** Member relations beyond `reader` (e.g. `["ingestor"]`, `["user", "caller"]`). */
  extraMemberRelations?: readonly string[];
  /** data_source only → the parent knowledge_base id for the inheritance edge. */
  parentKnowledgeBaseId?: string | null;
  /**
   * The OpenFGA resource type used for the ownership-transfer authorization
   * check (`<type>:<id>#can_manage` OR org-admin). Defaults to `objectType`
   * cast to a resource type; set explicitly when they differ.
   */
  authzResourceType?: UniversalRebacResourceType;
  /**
   * Set by the client when the caller has explicitly acknowledged that a
   * transfer targets a team they are not a member of (the
   * `<TeamOwnershipFields>` not-a-member prompt). Required to complete such a
   * transfer; ignored for non-transfer writes.
   */
  confirmedNotMember?: boolean;
  /**
   * Optional override for the owner-team membership validation. By default the
   * helper requires `team:<slug>#can_use` for the requested owner team (the
   * same gate the agent route applies). Pass a custom predicate to widen or
   * narrow it; return false to reject with `OWNER_TEAM_FORBIDDEN`.
   */
  canUseOwnerTeam?: (slug: string) => Promise<boolean>;
  /**
   * Override the reconcile step (default `reconcileShareableResource`). The
   * helper passes the fully-resolved `ShareableResourceInput`; callers that
   * layer extra tuples (e.g. the agent route's tool-caller edges) wrap it.
   * Primarily a test seam.
   */
  reconcile?: (input: ShareableResourceInput) => Promise<OpenFgaReconcileResult>;
}

export interface ShareableWriteResult {
  reconcile: OpenFgaReconcileResult;
  ownerTeamSlug: string | null;
  sharedTeamSlugs: string[];
  creatorSubject: string | null;
  sharedWithOrg: boolean;
  /** True when this write changed the owner team (a transfer occurred). */
  transferred: boolean;
}

/**
 * The resolved next ownership state plus the reconcile inputs that depend on
 * the previous state. Returned by `resolveShareableOwnershipWrite` so callers
 * whose persistence is split across an external call (e.g. the RAG proxy, which
 * writes config via the upstream body pre-call and reconciles OpenFGA
 * post-success) can apply each half in its own phase while still sharing the
 * single decision path (creator set-once, transfer guard, membership, scope).
 */
export interface ResolvedShareableWrite {
  creatorSubject: string | null;
  ownerTeamSlug: string | null;
  sharedTeamSlugs: string[];
  sharedWithOrg: boolean;
  /** Set only on a transfer — pass to the reconciler so the old owner is revoked. */
  previousOwnerTeamSlug: string | null;
  previousSharedTeamSlugs: string[];
  previousSharedWithOrg: boolean;
  /** True when the owner team changed (a transfer occurred). */
  transferred: boolean;
}

function normalizeSlug(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sessionSubject(session: ResourceAuthzSession): string | null {
  return typeof session.sub === "string" && session.sub.trim()
    ? session.sub.trim()
    : null;
}

async function defaultCanUseOwnerTeam(
  session: ResourceAuthzSession,
  slug: string,
): Promise<boolean> {
  try {
    await requireResourcePermission(session, {
      type: "team",
      id: slug,
      action: "use",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Orchestrate a create-or-update-or-transfer write for a shareable resource.
 * This is the single home for the ownership flow every shareable type shares:
 *
 *   1. creator set-once (provenance)
 *   2. owner immutable on a normal edit; changing it is a TRANSFER, which must
 *      pass `canTransferResourceOwnership` (owner-team admin OR org admin) and,
 *      when the destination team is one the caller is not a member of, an
 *      explicit not-a-member confirmation
 *   3. owner-team membership validation on first-set
 *   4. shared-team + org-scope diff
 *   5. reconcile the OpenFGA projection (revoking the old owner on transfer)
 *   6. persist the next state to config (source of truth)
 *
 * Returns the resolved next state + reconcile result; callers surface
 * `reconcile` in the response (it never throws the config write — config is the
 * source of truth, per contract A6).
 */
export async function handleShareableResourceWrite(
  ctx: ShareableWriteContext,
): Promise<ShareableWriteResult> {
  const previous = await ctx.loadPrevious();
  const resolved = await resolveShareableOwnershipWrite(ctx, previous);

  // Reconcile the OpenFGA projection. On transfer pass the previous owner so
  // its grants are revoked instead of orphaned.
  const reconcileFn = ctx.reconcile ?? reconcileShareableResource;
  const reconcile = await reconcileFn({
    objectType: ctx.objectType,
    objectId: ctx.objectId,
    creatorSubject: resolved.creatorSubject,
    ownerTeamSlug: resolved.ownerTeamSlug,
    previousOwnerTeamSlug: resolved.transferred ? resolved.previousOwnerTeamSlug : undefined,
    nextSharedTeamSlugs: resolved.sharedTeamSlugs,
    previousSharedTeamSlugs: resolved.previousSharedTeamSlugs,
    extraMemberRelations: ctx.extraMemberRelations,
    parentKnowledgeBaseId: ctx.parentKnowledgeBaseId,
    sharedWithOrg: resolved.sharedWithOrg,
    previousSharedWithOrg: resolved.previousSharedWithOrg,
  });

  // Persist the next owner/shared/creator/org to the config.
  const next: ShareableOwnershipState = {
    ownerTeamSlug: resolved.ownerTeamSlug,
    sharedTeamSlugs: resolved.sharedTeamSlugs,
    creatorSubject: resolved.creatorSubject,
    sharedWithOrg: resolved.sharedWithOrg,
  };
  await ctx.persist(next);

  return {
    reconcile,
    ownerTeamSlug: resolved.ownerTeamSlug,
    sharedTeamSlugs: resolved.sharedTeamSlugs,
    creatorSubject: resolved.creatorSubject,
    sharedWithOrg: resolved.sharedWithOrg,
    transferred: resolved.transferred,
  };
}

/**
 * Run the shared ownership DECISION (creator set-once, transfer guard +
 * not-a-member confirm, first-set membership, shared-team + org-scope diff) and
 * return the resolved next state. Does NOT reconcile or persist — that's the
 * caller's responsibility. Use this directly when persistence is split across
 * an external call (the RAG proxy injects config into the upstream body
 * pre-call, then reconciles OpenFGA post-success); use the synchronous
 * `handleShareableResourceWrite` wrapper otherwise. Both share this one
 * decision path so the transfer rules can't drift between resource types.
 */
export async function resolveShareableOwnershipWrite(
  ctx: ShareableWriteContext,
  previous: ShareableOwnershipState,
): Promise<ResolvedShareableWrite> {
  // 1. Creator is set once: keep the previously-persisted value, else stamp
  //    the current session subject on first write. Never reassigned.
  const creatorSubject =
    previous.creatorSubject ?? sessionSubject(ctx.session) ?? null;

  const requestedOwner = normalizeSlug(ctx.requestedOwnerTeamSlug);
  const previousOwner = normalizeSlug(previous.ownerTeamSlug);

  // 2. Owner immutability: a change to an existing owner team is a TRANSFER.
  //    First-set (previousOwner == null) is a normal create, not a transfer.
  const isTransfer =
    requestedOwner !== null &&
    previousOwner !== null &&
    requestedOwner !== previousOwner;
  const isFirstSet = requestedOwner !== null && previousOwner === null;

  const nextOwner = requestedOwner ?? previousOwner;

  if (isTransfer) {
    // 2a. Authorization: only an owner-team admin (can_manage) or org admin
    //     may transfer ownership.
    const allowed = await canTransferResourceOwnership(ctx.session, {
      type: ctx.authzResourceType ?? (ctx.objectType as UniversalRebacResourceType),
      id: ctx.objectId,
    });
    if (!allowed) {
      throw new ApiError(
        "Only an owner-team admin or org admin can transfer ownership of this resource.",
        403,
        "TRANSFER_FORBIDDEN",
      );
    }
    // 2b. A transfer to a team the caller does not belong to requires an
    //     explicit confirmation (the not-a-member prompt).
    const canUseDestination = ctx.canUseOwnerTeam
      ? await ctx.canUseOwnerTeam(nextOwner!)
      : await defaultCanUseOwnerTeam(ctx.session, nextOwner!);
    if (!canUseDestination && ctx.confirmedNotMember !== true) {
      throw new ApiError(
        "You are not a member of the destination team. Confirm the transfer to proceed.",
        409,
        "TRANSFER_NOT_MEMBER_UNCONFIRMED",
      );
    }
  } else if (isFirstSet) {
    // 3. First-set: the caller must belong to the owner team they assign.
    const canUse = ctx.canUseOwnerTeam
      ? await ctx.canUseOwnerTeam(nextOwner!)
      : await defaultCanUseOwnerTeam(ctx.session, nextOwner!);
    if (!canUse) {
      throw new ApiError(
        "You must belong to the owner team to assign it.",
        403,
        "OWNER_TEAM_FORBIDDEN",
      );
    }
  }

  // 4. Next shared set = requested (when provided) else keep previous. Owner
  //    slug is deduped out (the reconciler grants it via the owner path).
  const requestedShared =
    ctx.requestedSharedTeamSlugs === undefined ||
    ctx.requestedSharedTeamSlugs === null
      ? null
      : ctx.requestedSharedTeamSlugs
          .map((s) => normalizeSlug(s))
          .filter((s): s is string => s !== null);
  const nextShared = (requestedShared ?? previous.sharedTeamSlugs).filter(
    (slug) => slug !== nextOwner,
  );

  // Org-wide scope: keep previous when the request omits it.
  const previousSharedWithOrg = previous.sharedWithOrg === true;
  const nextSharedWithOrg =
    ctx.requestedSharedWithOrg === undefined || ctx.requestedSharedWithOrg === null
      ? previousSharedWithOrg
      : ctx.requestedSharedWithOrg === true;

  return {
    creatorSubject,
    ownerTeamSlug: nextOwner,
    sharedTeamSlugs: nextShared,
    sharedWithOrg: nextSharedWithOrg,
    previousOwnerTeamSlug: previousOwner,
    previousSharedTeamSlugs: previous.sharedTeamSlugs,
    previousSharedWithOrg,
    transferred: isTransfer,
  };
}
