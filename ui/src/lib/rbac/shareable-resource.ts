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

import { reconcileShareableResource } from "./openfga-owned-resources";
import type { OpenFgaReconcileResult } from "./openfga";
import {
  requireResourcePermission,
  type ResourceAuthzSession,
} from "./resource-authz";

/** Owner/shared/creator triple persisted on (and read back from) the config. */
export interface ShareableOwnershipState {
  ownerTeamSlug: string | null;
  sharedTeamSlugs: string[];
  creatorSubject: string | null;
}

export interface ShareableWriteContext {
  objectType: string;
  objectId: string;
  /** Used for the creator subject and the owner-team membership check. */
  session: ResourceAuthzSession;
  requestedOwnerTeamSlug?: string | null;
  requestedSharedTeamSlugs?: string[] | null;
  /** Read the previously-persisted owner/shared/creator from the config. */
  loadPrevious: () => Promise<ShareableOwnershipState>;
  /** Persist the next owner/shared/creator to the config (source of truth). */
  persist: (next: ShareableOwnershipState) => Promise<void>;
  /** Default false. True only on the deliberate ownership-transfer path (US3). */
  allowOwnerTransfer?: boolean;
  /** Member relations beyond `reader` (e.g. `["ingestor"]`, `["user"]`). */
  extraMemberRelations?: readonly string[];
  /** data_source only → the parent knowledge_base id for the inheritance edge. */
  parentKnowledgeBaseId?: string | null;
  /**
   * Optional override for the owner-team membership validation. By default the
   * helper requires `team:<slug>#can_use` for the requested owner team (the
   * same gate the agent route applies). Pass a custom predicate to widen or
   * narrow it; return false to reject with `OWNER_TEAM_FORBIDDEN`.
   */
  canUseOwnerTeam?: (slug: string) => Promise<boolean>;
}

export interface ShareableWriteResult {
  reconcile: OpenFgaReconcileResult;
  ownerTeamSlug: string | null;
  sharedTeamSlugs: string[];
  creatorSubject: string | null;
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
 * Orchestrate a create-or-update write for a shareable resource. Returns the
 * resolved next state and the reconcile result; callers persist their own
 * domain fields and surface `reconcile` in the response (it never throws the
 * config write — config is the source of truth, per contract A6).
 */
export async function handleShareableResourceWrite(
  ctx: ShareableWriteContext,
): Promise<ShareableWriteResult> {
  const previous = await ctx.loadPrevious();

  // 1. Creator is set once: keep the previously-persisted value, else stamp
  //    the current session subject on first write. Never reassigned.
  const creatorSubject =
    previous.creatorSubject ?? sessionSubject(ctx.session) ?? null;

  const requestedOwner = normalizeSlug(ctx.requestedOwnerTeamSlug);
  const previousOwner = normalizeSlug(previous.ownerTeamSlug);

  // 2. Owner immutability: a change to an existing owner team is only allowed
  //    on the explicit transfer path (US3). First-set (previousOwner == null)
  //    is always allowed.
  const isOwnerChange =
    requestedOwner !== null &&
    previousOwner !== null &&
    requestedOwner !== previousOwner;
  if (isOwnerChange && !ctx.allowOwnerTransfer) {
    throw new ApiError(
      "Owner team cannot be changed. Use the ownership-transfer flow instead.",
      409,
      "OWNER_TEAM_IMMUTABLE",
    );
  }

  const nextOwner = requestedOwner ?? previousOwner;

  // 3. Validate the caller may use the (new) owner team. Skipped when the
  //    owner team is unchanged from what is already persisted (the caller
  //    already owned it) — matches the agent route, which only re-checks
  //    membership when an owner team is supplied on create.
  if (nextOwner && nextOwner !== previousOwner) {
    const canUse = ctx.canUseOwnerTeam
      ? await ctx.canUseOwnerTeam(nextOwner)
      : await defaultCanUseOwnerTeam(ctx.session, nextOwner);
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

  // 5. Reconcile the OpenFGA projection. On transfer (owner changed) pass the
  //    previous owner so its grants are revoked.
  const reconcile = await reconcileShareableResource({
    objectType: ctx.objectType,
    objectId: ctx.objectId,
    creatorSubject,
    ownerTeamSlug: nextOwner,
    previousOwnerTeamSlug: isOwnerChange ? previousOwner : undefined,
    nextSharedTeamSlugs: nextShared,
    previousSharedTeamSlugs: previous.sharedTeamSlugs,
    extraMemberRelations: ctx.extraMemberRelations,
    parentKnowledgeBaseId: ctx.parentKnowledgeBaseId,
  });

  // 6. Persist the next owner/shared/creator to the config (source of truth).
  const next: ShareableOwnershipState = {
    ownerTeamSlug: nextOwner,
    sharedTeamSlugs: nextShared,
    creatorSubject,
  };
  await ctx.persist(next);

  return { reconcile, ...next };
}
