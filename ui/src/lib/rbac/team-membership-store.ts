/**
 * Canonical team-membership reader helpers.
 *
 * Single source of truth for "who is in this team and what is their role"
 * is the `team_membership_sources` Mongo collection (see
 * `team-membership-source-store.ts` for writers). This module is the
 * read-side companion that the rest of the codebase consumes — auth gates,
 * API routes, and Admin UI loaders.
 *
 * Why this exists: pre-2026-05-26, three independent membership stores
 * coexisted (`teams.members[]` embedded array, `team_membership_sources`,
 * and OpenFGA tuples). The OIDC reconciler updated only two of the three,
 * leading to a drift bug where auto-provisioned teams showed "0 members"
 * in the Admin UI even though authorization worked. Spec
 * `docs/docs/specs/2026-05-26-canonical-team-membership/` consolidates
 * onto this module + OpenFGA.
 *
 * Identity dedupe rule: a user is identified by
 * `COALESCE(user_subject, user_email)`. Two source rows for the same
 * effective identity (e.g. one from `okta` and one from `manual`) count
 * as one member. Roles are escalated: if any active row has
 * `relationship: "admin"`, the resolved role is `"admin"`.
 *
 * Status filter: by default only `status: "active"` rows are considered.
 * Removed/stale/disabled rows are excluded. The `includeRemoved` opt-in
 * is reserved for audit views.
 */

import type {
  TeamMembershipSource,
  TeamRelationshipRole,
} from "@/types/identity-group-sync";

import { getRbacCollection } from "./mongo-collections";

/**
 * The canonical, deduplicated team-member view exposed to callers.
 *
 * `identity_key` is the dedupe key: it's `user_subject` when set,
 * otherwise lowercased `user_email`. Callers should treat it as opaque
 * and ordered for stability — the helper returns members sorted by
 * `identity_key` so snapshot tests are deterministic.
 *
 * `provider_ids` lists every distinct provider that contributed a row
 * for this user (useful for the Team Details panel which wants to show
 * "via Okta + manual"). Order is insertion order from the underlying
 * cursor; do not depend on it for equality.
 */
export interface CanonicalTeamMember {
  identity_key: string;
  user_subject?: string;
  user_email?: string;
  role: TeamRelationshipRole;
  source_types: TeamMembershipSource["source_type"][];
  provider_ids: string[];
}

interface QueryOptions {
  /**
   * When true, include rows whose `status !== "active"` (e.g. `removed`,
   * `stale`, `disabled_user`). Default false. Only audit/diagnostic
   * views should set this.
   */
  includeRemoved?: boolean;
}

/**
 * Build the dedupe key from a row. Lowercases emails so `Foo@x.com` and
 * `foo@x.com` collapse. Returns `null` if the row has neither subject
 * nor email — such rows cannot be attributed to a user and are skipped.
 */
function deriveIdentityKey(row: Pick<TeamMembershipSource, "user_subject" | "user_email">): string | null {
  if (row.user_subject && row.user_subject.trim()) {
    return row.user_subject.trim();
  }
  if (row.user_email && row.user_email.trim()) {
    return row.user_email.trim().toLowerCase();
  }
  return null;
}

/**
 * Role escalation: admin wins over member. Anything else is treated as
 * member (defensive — the type system already pins this to two values
 * but the on-disk shape may drift).
 */
function escalate(current: TeamRelationshipRole | null, incoming: TeamRelationshipRole): TeamRelationshipRole {
  if (current === "admin" || incoming === "admin") return "admin";
  return "member";
}

function buildStatusFilter(opts: QueryOptions | undefined): Record<string, unknown> {
  return opts?.includeRemoved ? {} : { status: "active" };
}

/**
 * Load all active members of a single team, deduplicated by identity_key
 * with role escalation applied. Returns an empty array if the team has
 * no members or doesn't exist (the function does not validate team
 * existence — that's the caller's job).
 *
 * Sorted by `identity_key` ascending for deterministic output.
 */
export async function loadActiveTeamMembers(
  teamSlug: string,
  opts?: QueryOptions,
): Promise<CanonicalTeamMember[]> {
  if (!teamSlug || typeof teamSlug !== "string") return [];

  const collection = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
  const cursor = collection.find({
    team_slug: teamSlug,
    ...buildStatusFilter(opts),
  });
  const rows = await cursor.toArray();

  const byIdentity = new Map<string, CanonicalTeamMember>();
  for (const row of rows) {
    const identity = deriveIdentityKey(row);
    if (!identity) continue;

    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, {
        identity_key: identity,
        user_subject: row.user_subject || undefined,
        user_email: row.user_email || undefined,
        role: row.relationship,
        source_types: [row.source_type],
        provider_ids: row.provider_id ? [row.provider_id] : [],
      });
      continue;
    }

    existing.role = escalate(existing.role, row.relationship);
    if (!existing.user_subject && row.user_subject) existing.user_subject = row.user_subject;
    if (!existing.user_email && row.user_email) existing.user_email = row.user_email;
    if (!existing.source_types.includes(row.source_type)) existing.source_types.push(row.source_type);
    if (row.provider_id && !existing.provider_ids.includes(row.provider_id)) {
      existing.provider_ids.push(row.provider_id);
    }
  }

  return Array.from(byIdentity.values()).sort((a, b) => a.identity_key.localeCompare(b.identity_key));
}

/**
 * Count the distinct active members of a team. Equivalent to
 * `(await loadActiveTeamMembers(slug)).length` but cheaper because
 * dedupe happens server-side via aggregation, and it does not return
 * row data.
 *
 * Used by `GET /api/admin/teams` to populate `member_count` on the list
 * response without N+1 round-trips.
 */
export async function countActiveTeamMembers(
  teamSlug: string,
  opts?: QueryOptions,
): Promise<number> {
  if (!teamSlug || typeof teamSlug !== "string") return 0;
  const counts = await loadTeamMemberCounts([teamSlug], opts);
  return counts.get(teamSlug) ?? 0;
}

/**
 * Bulk variant of `loadActiveTeamMembers` for catalog/listing endpoints
 * that need (slug, member) pairs across many teams in a single round-trip.
 *
 * Returns a Map keyed by team_slug → CanonicalTeamMember[]. Slugs with
 * zero members are present in the map with `[]`. Members within each
 * team are sorted by `identity_key` (deterministic) and deduped with
 * role escalation, just like `loadActiveTeamMembers`.
 *
 * Use sparingly — this loads ALL active membership rows for the requested
 * slugs into memory at once. For pagination-friendly callers, prefer
 * per-team `loadActiveTeamMembers`.
 */
export async function loadTeamMembersForSlugs(
  teamSlugs: string[],
  opts?: QueryOptions,
): Promise<Map<string, CanonicalTeamMember[]>> {
  const result = new Map<string, CanonicalTeamMember[]>();
  for (const slug of teamSlugs) result.set(slug, []);
  if (teamSlugs.length === 0) return result;

  const collection = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
  const cursor = collection.find({
    team_slug: { $in: teamSlugs },
    ...buildStatusFilter(opts),
  });
  const rows = await cursor.toArray();

  // Build per-slug dedup maps, mirroring loadActiveTeamMembers.
  const perSlug = new Map<string, Map<string, CanonicalTeamMember>>();
  for (const slug of teamSlugs) perSlug.set(slug, new Map());
  for (const row of rows) {
    if (!row.team_slug || !perSlug.has(row.team_slug)) continue;
    const identity = deriveIdentityKey(row);
    if (!identity) continue;
    const byIdentity = perSlug.get(row.team_slug)!;
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, {
        identity_key: identity,
        user_subject: row.user_subject || undefined,
        user_email: row.user_email || undefined,
        role: row.relationship,
        source_types: [row.source_type],
        provider_ids: row.provider_id ? [row.provider_id] : [],
      });
      continue;
    }
    existing.role = escalate(existing.role, row.relationship);
    if (!existing.user_subject && row.user_subject) existing.user_subject = row.user_subject;
    if (!existing.user_email && row.user_email) existing.user_email = row.user_email;
    if (!existing.source_types.includes(row.source_type)) existing.source_types.push(row.source_type);
    if (row.provider_id && !existing.provider_ids.includes(row.provider_id)) {
      existing.provider_ids.push(row.provider_id);
    }
  }
  for (const [slug, byIdentity] of perSlug) {
    result.set(
      slug,
      Array.from(byIdentity.values()).sort((a, b) => a.identity_key.localeCompare(b.identity_key)),
    );
  }
  return result;
}

/**
 * Bulk variant of `countActiveTeamMembers` for the admin teams list
 * endpoint. Returns a map keyed by team_slug. Slugs with zero members
 * are present in the map with value 0 (so callers don't have to check
 * `.has()`).
 *
 * Implementation: a single `$match` (covered by the
 * `(team_slug, status)` index) followed by `$group` with `$addToSet` to
 * collect distinct identities. The group stage is in-memory but bounded
 * by the number of distinct (team, identity) pairs — well under 100ms
 * for our target scale (10k teams, 100k active rows) per the plan's
 * performance benchmarks.
 */
export async function loadTeamMemberCounts(
  teamSlugs: string[],
  opts?: QueryOptions,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const slug of teamSlugs) counts.set(slug, 0);
  if (teamSlugs.length === 0) return counts;

  const collection = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");

  const aggregation: Record<string, unknown>[] = [
    {
      $match: {
        team_slug: { $in: teamSlugs },
        ...buildStatusFilter(opts),
      },
    },
    {
      $group: {
        _id: {
          team_slug: "$team_slug",
          // Mirrors `deriveIdentityKey`: prefer subject, fall back to email.
          identity_key: { $ifNull: ["$user_subject", { $toLower: "$user_email" }] },
        },
      },
    },
    {
      $match: { "_id.identity_key": { $ne: null } },
    },
    {
      $group: {
        _id: "$_id.team_slug",
        count: { $sum: 1 },
      },
    },
  ];

  const cursor = collection.aggregate<{ _id: string; count: number }>(aggregation);
  const docs = await cursor.toArray();
  for (const doc of docs) {
    if (typeof doc._id === "string") counts.set(doc._id, doc.count);
  }
  return counts;
}

/**
 * For each team slug, the distinct IdP-derived membership source types present
 * (e.g. "okta", "oidc_claim", "active_directory"). Manual memberships are
 * excluded, so a team only appears with a source type if it was populated by a
 * directory/login sync. Used by the Admin Teams UI to badge synced teams.
 */
export async function loadTeamIdpSourceTypes(
  teamSlugs: string[],
  opts?: QueryOptions,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (teamSlugs.length === 0) return result;

  const collection = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
  const docs = await collection
    .aggregate<{ _id: string; sourceTypes: string[] }>([
      {
        $match: {
          team_slug: { $in: teamSlugs },
          source_type: { $ne: "manual" },
          ...buildStatusFilter(opts),
        },
      },
      { $group: { _id: "$team_slug", sourceTypes: { $addToSet: "$source_type" } } },
    ])
    .toArray();

  for (const doc of docs) {
    if (typeof doc._id === "string") result.set(doc._id, doc.sourceTypes ?? []);
  }
  return result;
}

/**
 * Lookup helper for "is this user a member of this team?". Case-insensitive
 * email match; subject match is exact. Returns false for empty inputs.
 *
 * Used by auth gates (`team-admin-guards`, `login-openfga-bootstrap`) and
 * route handlers that need to enforce "must be a team member" semantics.
 */
export async function isUserInTeam(
  teamSlug: string,
  userIdentity: { user_subject?: string; user_email?: string },
  opts?: QueryOptions,
): Promise<boolean> {
  return (await findUserRoleInTeam(teamSlug, userIdentity, opts)) !== null;
}

/**
 * Find the resolved role for a user in a team, or `null` if they're not
 * a member. Resolves via the same dedupe + escalation rules as
 * `loadActiveTeamMembers`, but short-circuits — it stops as soon as it
 * has seen an `admin` row.
 *
 * Identity matching: tries `user_subject` first (exact), then
 * lowercased `user_email`.
 *
 * Used by the auth-gate replacement for `team.members?.find(...)`.
 */
export async function findUserRoleInTeam(
  teamSlug: string,
  userIdentity: { user_subject?: string; user_email?: string },
  opts?: QueryOptions,
): Promise<TeamRelationshipRole | null> {
  if (!teamSlug || typeof teamSlug !== "string") return null;

  const subject = userIdentity.user_subject?.trim() || undefined;
  const emailLower = userIdentity.user_email?.trim().toLowerCase() || undefined;
  if (!subject && !emailLower) return null;

  const collection = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");

  // Match if EITHER the subject matches OR the email matches (case-insensitive).
  // We can't easily case-insensitive-match in pure Mongo without a regex per
  // candidate, but stored emails are normalized lowercase by the writers
  // (see team-membership-source-store), so an exact lowercase match is sound.
  const identityClauses: Record<string, unknown>[] = [];
  if (subject) identityClauses.push({ user_subject: subject });
  if (emailLower) identityClauses.push({ user_email: emailLower });

  const cursor = collection.find({
    team_slug: teamSlug,
    ...buildStatusFilter(opts),
    $or: identityClauses,
  });

  // toArray() (vs for-await) keeps the implementation portable across
  // Mongo driver versions and trivially mockable in unit tests. Per-user
  // matching rows are typically 1–2, so the early-exit optimization
  // doesn't matter in practice.
  const rows = await cursor.toArray();
  let resolved: TeamRelationshipRole | null = null;
  for (const row of rows) {
    resolved = escalate(resolved, row.relationship);
    if (resolved === "admin") return "admin";
  }
  return resolved;
}
