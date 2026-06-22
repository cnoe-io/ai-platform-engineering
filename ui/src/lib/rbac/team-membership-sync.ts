/**
 * Shared helpers for keeping Mongo `teams` membership in sync with the
 * OpenFGA `team:<slug>#{member,admin}` tuples and the
 * `team_membership_sources` collection.
 *
 * Both `POST /api/admin/teams` (team creation) and `POST /api/admin/teams/[id]/members`
 * (adding members to an existing team) must do the same three things every time
 * a Mongo membership row is written:
 *
 *   1. Resolve the Keycloak `sub` for the user's email (OpenFGA stores
 *      `user:<sub>`, never `user:<email>`).
 *   2. Write `user:<sub>#<relation> team:<slug>` tuples to OpenFGA so the
 *      computed `team:<slug>#can_use` / `#can_manage` checks succeed.
 *   3. Upsert the matching row(s) into `team_membership_sources` with the
 *      `user_subject` populated, so `reconcileTeamMembershipSources` can do
 *      drift repair later.
 *
 * The historical bug this module fixes: the team-creation route in
 * `ui/src/app/api/admin/teams/route.ts` did steps 1 and 2 zero times. Teams
 * created via the UI had a Mongo doc + Keycloak client scope but no OpenFGA
 * tuples, which made `OWNER_TEAM_FORBIDDEN` fire on every subsequent agent
 * creation — even for the team's creator.
 */

import { isValidTeamSlug,searchRealmUsers } from "@/lib/rbac/keycloak-admin";
import { writeOpenFgaTuples,type OpenFgaTupleKey } from "@/lib/rbac/openfga";

export type TeamMemberRelation = "member" | "admin";
export type TeamMembershipAction = "assign" | "remove";

export interface TeamMembershipTupleResult {
  /**
   * Whether the underlying OpenFGA backend was reachable / enabled. False
   * when SSO is disabled in dev or OpenFGA is not configured — callers can
   * treat this as a no-op rather than an error.
   */
  enabled: boolean;
  /**
   * The exact tuples we asked OpenFGA to write (or would have written if
   * `enabled` were true). Useful for tests and for log messages.
   */
  tuples: OpenFgaTupleKey[];
}

/**
 * Resolve the Keycloak subject (the stable user id used as `user:<sub>` in
 * OpenFGA) for an email address.
 *
 * Returns `undefined` and logs a warning if:
 *   - The `teamSlug` is not OpenFGA-safe (e.g. uppercase or contains `:`).
 *   - Keycloak does not have a user matching the email exactly.
 *   - The Keycloak Admin API call fails for any reason (network, 401, etc).
 *
 * Returning `undefined` means "we won't write an OpenFGA tuple for this
 * user right now" — the team-creation path still writes the Mongo doc + the
 * membership source row so the startup audit / next admin action can repair
 * it once the user appears in Keycloak.
 */
export async function resolveKeycloakUserSubject(
  email: string,
  teamSlug: string,
): Promise<string | undefined> {
  if (!isValidTeamSlug(teamSlug)) {
    console.warn(
      `[TeamMembershipSync] Invalid team slug "${teamSlug}" — skipping OpenFGA tuple for ${email}`,
    );
    return undefined;
  }
  try {
    const users = await searchRealmUsers({ search: email, first: 0, max: 1 });
    const kcUser = users.find(
      (u) => (u.email as string)?.toLowerCase() === email.toLowerCase(),
    );
    if (!kcUser?.id) {
      console.warn(
        `[TeamMembershipSync] Keycloak user not found for ${email} — skipping OpenFGA tuple`,
      );
      return undefined;
    }
    return String(kcUser.id);
  } catch (err) {
    console.warn(
      `[TeamMembershipSync] Failed to resolve Keycloak user for ${email}:`,
      err,
    );
    return undefined;
  }
}

/**
 * Build `user:<sub>#<relation> team:<slug>` tuples for one user and one or
 * more relations. The exported helper is split from `writeTeamMembershipTuples`
 * so tests can assert the exact tuples without mocking OpenFGA itself.
 */
export function buildTeamMembershipTuples(
  userSubject: string,
  teamSlug: string,
  relations: readonly TeamMemberRelation[],
): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const relation of relations) {
    const key = `${relation}\n${userSubject}\n${teamSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      user: `user:${userSubject}`,
      relation,
      object: `team:${teamSlug}`,
    });
  }
  return out;
}

/**
 * Assign or remove one or more `team:<slug>#<relation>` tuples for a user.
 *
 * Pass `relations: ["admin", "member"]` for the team creator so they satisfy
 * both `can_manage` (via `admin`) and `can_use` (via `member` ∪ `admin`).
 * For regular invitees pass `["member"]`.
 *
 * No-ops when `userSubject` is undefined (i.e. we couldn't resolve a sub from
 * Keycloak) — the caller is expected to log that case separately so the
 * audit trail makes sense.
 */
export async function writeTeamMembershipTuples(
  userSubject: string | undefined,
  teamSlug: string,
  relations: readonly TeamMemberRelation[],
  action: TeamMembershipAction,
): Promise<TeamMembershipTupleResult> {
  if (!userSubject || relations.length === 0) {
    return { enabled: false, tuples: [] };
  }
  const tuples = buildTeamMembershipTuples(userSubject, teamSlug, relations);
  const result = await writeOpenFgaTuples({
    writes: action === "assign" ? tuples : [],
    deletes: action === "remove" ? tuples : [],
  });
  console.log(
    `[TeamMembershipSync] ${action === "assign" ? "Wrote" : "Deleted"} ${tuples.length} OpenFGA tuple(s) ` +
      `for user:${userSubject} team:${teamSlug} (relations=${relations.join(",")} enabled=${result.enabled})`,
  );
  return { enabled: result.enabled, tuples };
}

/**
 * Convenience: map the role we store in Mongo (`'owner' | 'admin' | 'member'`)
 * onto the OpenFGA relations that grant equivalent access. The OpenFGA `team`
 * type only has `member` and `admin`; `owner` is a Mongo-side concept used to
 * pin the creator. We grant the creator both relations so:
 *
 *   - `team:<slug>#can_use`     resolves true (member OR admin → ok)
 *   - `team:<slug>#can_manage`  resolves true (admin → ok)
 *
 * If you ever add an OpenFGA `owner` relation you can extend this function
 * without touching the call sites.
 */
export function mongoRoleToOpenFgaRelations(
  role: string,
): TeamMemberRelation[] {
  switch (role) {
    case "owner":
      // Creator: full management AND day-to-day membership rights.
      return ["admin", "member"];
    case "admin":
      return ["admin"];
    case "member":
    default:
      return ["member"];
  }
}
