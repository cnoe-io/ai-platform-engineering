/**
 * Dynamic-agent ownership & visibility normalization.
 *
 * As of 2026-05-22 every dynamic agent is **team-owned**. The legacy
 * `visibility: 'private'` value was retired. This module is the single
 * source of truth for:
 *
 *   - Coercing inbound payloads (`'private' → 'team'`).
 *   - Validating that every agent has an `owner_team_slug` /
 *     `owner_team_id`.
 *   - Returning a structured warning the BFF can surface in response
 *     headers so old clients (and the editor UI) can spot the migration.
 *
 * History: see `docs/docs/changes/2026-05-22-remove-private-agents.md`.
 * The admin reconcile migration in
 * `ui/src/lib/rbac/migrations/dynamic-agents-private-removal.ts` walks
 * every Mongo doc and converts in place, so this coercion is only
 * exercised for the brief window where old docs/clients still flow
 * through the API.
 */

import type {
  DynamicAgentConfig,
  LegacyVisibilityType,
  VisibilityType,
} from "@/types/dynamic-agent";

const STRICT_VISIBILITY: ReadonlySet<VisibilityType> = new Set(["team", "global"]);

/**
 * Coerce a possibly-legacy visibility value to the current strict union.
 *
 *   - `'private'` → `'team'` (with `deprecated: true` in the result).
 *   - `'team'` / `'global'` → pass through.
 *   - Anything else → `'team'` (safe default) with `coercedFromInvalid: true`.
 *
 * Returns both the canonical value and a deprecation flag so callers can
 * surface a warning header (e.g. `X-CAIPE-Visibility-Deprecated: private`).
 */
export function normalizeLegacyVisibility(
  raw: LegacyVisibilityType | string | undefined,
): { value: VisibilityType; deprecated: boolean; coercedFromInvalid: boolean } {
  if (typeof raw !== "string") {
    return { value: "team", deprecated: false, coercedFromInvalid: true };
  }
  if (raw === "private") {
    return { value: "team", deprecated: true, coercedFromInvalid: false };
  }
  if (STRICT_VISIBILITY.has(raw as VisibilityType)) {
    return { value: raw as VisibilityType, deprecated: false, coercedFromInvalid: false };
  }
  return { value: "team", deprecated: false, coercedFromInvalid: true };
}

/**
 * Apply legacy coercion in place on an agent doc fetched from Mongo, so
 * the rest of the system never sees `'private'`. Returns the original
 * reference for chaining.
 *
 * Idempotent — calling this on a doc that already has
 * `visibility: 'team' | 'global'` is a no-op.
 */
export function coerceAgentVisibilityOnRead<
  T extends { visibility?: LegacyVisibilityType },
>(doc: T): T {
  if (doc.visibility === "private") {
    // Cast through unknown because T['visibility'] may be a narrow union that
    // does not statically include 'team' even though it does at runtime.
    (doc as { visibility?: VisibilityType }).visibility = "team";
  }
  return doc;
}

export interface AgentOwnershipValidationInput {
  visibility: VisibilityType;
  ownerTeamSlug: string | null | undefined;
  ownerTeamId: string | null | undefined;
}

export interface AgentOwnershipValidationResult {
  ok: boolean;
  /** When `ok === false`, a short machine code (`OWNER_TEAM_REQUIRED`, …). */
  code?: string;
  /** Human-readable error suitable for an `ApiError` `message`. */
  message?: string;
}

/**
 * Enforce the post-private-removal contract:
 *
 *   - Visibility must be `'team'` or `'global'`. (`'private'` is rejected
 *     before this point by `normalizeLegacyVisibility`, which coerces; if
 *     anything still slips through, we reject here.)
 *   - Every agent must have an `ownerTeamSlug`. `ownerTeamId` is a
 *     belt-and-suspenders pairing — required only when the slug is
 *     present (the slug is the source of truth for OpenFGA tuples; the
 *     id is for Mongo joins).
 */
export function validateAgentOwnership(
  input: AgentOwnershipValidationInput,
): AgentOwnershipValidationResult {
  if (input.visibility !== "team" && input.visibility !== "global") {
    return {
      ok: false,
      code: "VISIBILITY_INVALID",
      message:
        "Agent visibility must be 'team' or 'global'. 'private' has been retired — owner agents through a team instead.",
    };
  }
  const slug = typeof input.ownerTeamSlug === "string" ? input.ownerTeamSlug.trim() : "";
  if (!slug) {
    return {
      ok: false,
      code: "OWNER_TEAM_REQUIRED",
      message:
        "Every dynamic agent must be owned by a team. Select a team in the Owner Team picker. " +
        "If you want a personal agent, create a single-member team and own the agent through it.",
    };
  }
  return { ok: true };
}

/**
 * Compute the `owner_team_slug` that should be persisted on the agent
 * doc, given the (already-normalized) request body and the existing doc
 * (for PUT). Returns `null` only for legacy migration paths — POST/PUT
 * routes should treat `null` as a hard error and reject via
 * `validateAgentOwnership`.
 */
export function resolveOwnerTeamSlug(
  body: Pick<Record<string, unknown>, "owner_team_slug">,
  existing: Pick<DynamicAgentConfig, "owner_team_slug"> | null,
): string | null {
  const fromBody =
    typeof body.owner_team_slug === "string" && body.owner_team_slug.trim()
      ? body.owner_team_slug.trim()
      : null;
  if (fromBody) return fromBody;
  if (existing?.owner_team_slug) return existing.owner_team_slug;
  return null;
}

/**
 * Detect whether a stored doc came from the pre-2026-05-22 era and still
 * carries a deprecated visibility value. The migration walks every doc
 * and flips this; this helper is used by the reconcile route and the
 * admin diagnostic UI.
 */
export function isLegacyPrivateDoc(
  doc: Pick<DynamicAgentConfig, "visibility" | "owner_team_slug"> & Record<string, unknown>,
): boolean {
  return (doc.visibility as string) === "private";
}
