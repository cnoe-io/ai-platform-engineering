import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import {
baselineBootstrapTuples,
baselineGrantCatalog,
baselineTupleKey,
bundleToLegacyProfile,
effectiveBaselineBootstrapTuples,
getBaselineFgaProfileBundle,
normalizeBaselineFgaProfile,
normalizeBaselineFgaProfileBundle,
saveBaselineFgaProfile,
saveBaselineFgaProfileBundle,
type BaselineFgaProfile,
type BaselineFgaProfileBundle,
type TeamBaselineProfileOverride,
} from "@/lib/rbac/baseline-access";
import { writeOpenFgaTuples,type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { loadTeamMembersForSlugs,type CanonicalTeamMember } from "@/lib/rbac/team-membership-store";
import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { withOpenFgaAdminAuth,withOpenFgaViewAuth } from "../_lib";

type ApplyMode = "none" | "user" | "all";

interface BaselineProfileRequest {
  member_grants?: unknown;
  admin_grants?: unknown;
  bundle?: unknown;
  team_assignments?: unknown;
  apply?: {
    mode?: unknown;
    userId?: unknown;
    role?: unknown;
  };
}

interface BaselineProfileBundleRequest {
  profiles?: unknown;
  global_member_profile_id?: unknown;
  global_admin_profile_id?: unknown;
}

interface TeamAssignment {
  team_id: string;
  team_slug: string;
  team_name?: string;
  member_profile_id?: string;
  admin_profile_id?: string;
}

interface TeamDoc {
  // MongoDB's TypeScript driver collapses `Filter<T>._id` to
  // `FilterOperators<never>` when `_id` is typed as `unknown` here, which
  // blocks any `bulkWrite({ filter: { _id: ... } })` call below. Declare it
  // explicitly as the union the driver and our `teamIdForFilter()` helper
  // actually return.
  _id: string | ObjectId;
  slug?: string;
  name?: string;
  members?: Array<{ user_id?: string; role?: string }>;
  baseline_profile_overrides?: {
    member_profile_id?: string;
    admin_profile_id?: string;
  };
}

interface UserIdentityDoc {
  email?: string;
  role?: string;
  keycloak_sub?: string;
  metadata?: {
    keycloak_sub?: string;
    sso_id?: string;
    role?: string;
  };
  subject?: string;
  sub?: string;
}

function parseBody(body: unknown): {
  profile?: BaselineFgaProfile;
  bundle?: BaselineFgaProfileBundle;
  teamAssignments?: TeamAssignment[];
  apply: { mode: ApplyMode; userId?: string; role: "member" | "admin" };
} {
  if (!body || typeof body !== "object") {
    throw new ApiError("JSON body is required", 400);
  }
  const value = body as BaselineProfileRequest;
  if (value.bundle && typeof value.bundle === "object") {
    const bundleInput = value.bundle as BaselineProfileBundleRequest;
    const bundle = normalizeBaselineFgaProfileBundle({
      profiles: bundleInput.profiles,
      global_member_profile_id: bundleInput.global_member_profile_id,
      global_admin_profile_id: bundleInput.global_admin_profile_id,
      source: "mongo",
    });
    const teamAssignments = parseTeamAssignments(value.team_assignments);
    const apply = parseApply(value);
    return { bundle, teamAssignments, apply };
  }

  if (!Array.isArray(value.member_grants) || !Array.isArray(value.admin_grants)) {
    throw new ApiError("member_grants and admin_grants arrays are required", 400);
  }
  const profile = normalizeBaselineFgaProfile({
    member_grants: value.member_grants,
    admin_grants: value.admin_grants,
    source: "mongo",
  });
  return { profile, apply: parseApply(value) };
}

function parseApply(value: BaselineProfileRequest): { mode: ApplyMode; userId?: string; role: "member" | "admin" } {
  const mode = typeof value.apply?.mode === "string" ? value.apply.mode : "none";
  if (!["none", "user", "all"].includes(mode)) {
    throw new ApiError("apply.mode must be none, user, or all", 400);
  }
  const userId = typeof value.apply?.userId === "string" ? value.apply.userId.trim() : undefined;
  const role = value.apply?.role === "admin" ? "admin" : "member";
  if (mode === "user" && !userId) {
    throw new ApiError("apply.userId is required when apply.mode is user", 400);
  }
  return { mode: mode as ApplyMode, userId, role };
}

function parseTeamAssignments(value: unknown): TeamAssignment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError("team_assignments must be an array", 400);
  }
  return value.map((assignment) => {
    if (!assignment || typeof assignment !== "object") {
      throw new ApiError("team_assignments must contain objects", 400);
    }
    const row = assignment as Partial<TeamAssignment>;
    if (!row.team_id || typeof row.team_id !== "string") {
      throw new ApiError("team_assignments[].team_id is required", 400);
    }
    if (!row.team_slug || typeof row.team_slug !== "string") {
      throw new ApiError("team_assignments[].team_slug is required", 400);
    }
    return {
      team_id: row.team_id,
      team_slug: row.team_slug,
      team_name: typeof row.team_name === "string" ? row.team_name : undefined,
      member_profile_id: typeof row.member_profile_id === "string" && row.member_profile_id ? row.member_profile_id : undefined,
      admin_profile_id: typeof row.admin_profile_id === "string" && row.admin_profile_id ? row.admin_profile_id : undefined,
    };
  });
}

function subjectForUser(user: UserIdentityDoc): string | null {
  return (
    user.keycloak_sub?.trim() ||
    user.metadata?.keycloak_sub?.trim() ||
    user.subject?.trim() ||
    user.sub?.trim() ||
    user.metadata?.sso_id?.trim() ||
    null
  );
}

function isAdminUser(user: UserIdentityDoc): boolean {
  return user.role === "admin" || user.metadata?.role === "admin";
}

function diffTuples(previous: OpenFgaTupleKey[], next: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const nextKeys = new Set(next.map(baselineTupleKey));
  return previous.filter((tuple) => !nextKeys.has(baselineTupleKey(tuple)));
}

async function usersForApplyAll(): Promise<Array<{ subject: string; email?: string; isAdmin: boolean }>> {
  const users = await getCollection<UserIdentityDoc>("users");
  const rows = await users.find({}).limit(500).toArray();
  const subjects = new Map<string, { subject: string; email?: string; isAdmin: boolean }>();
  for (const row of rows) {
    const subject = subjectForUser(row);
    if (!subject) continue;
    subjects.set(subject, { subject, email: row.email, isAdmin: isAdminUser(row) });
  }
  return Array.from(subjects.values());
}

function teamIdForFilter(teamId: string): string | ObjectId {
  return ObjectId.isValid(teamId) ? new ObjectId(teamId) : teamId;
}

function idString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) return String(value);
  return "";
}

async function listTeams(): Promise<TeamDoc[]> {
  const teams = await getCollection<TeamDoc>("teams");
  const cursor = teams.find({});
  if ("sort" in cursor && typeof cursor.sort === "function") {
    return cursor.sort({ name: 1 }).toArray();
  }
  return cursor.toArray();
}

function assignmentsFromTeams(teams: TeamDoc[]): TeamAssignment[] {
  return teams.map((team) => ({
    team_id: idString(team._id),
    team_slug: String(team.slug ?? ""),
    team_name: team.name,
    member_profile_id: team.baseline_profile_overrides?.member_profile_id,
    admin_profile_id: team.baseline_profile_overrides?.admin_profile_id,
  }));
}

function applyTeamAssignments(teams: TeamDoc[], assignments: TeamAssignment[]): TeamDoc[] {
  const byId = new Map(assignments.map((assignment) => [assignment.team_id, assignment]));
  return teams.map((team) => {
    const assignment = byId.get(idString(team._id));
    if (!assignment) return team;
    return {
      ...team,
      baseline_profile_overrides: {
        member_profile_id: assignment.member_profile_id,
        admin_profile_id: assignment.admin_profile_id,
      },
    };
  });
}

/**
 * Resolve which baseline-profile overrides apply to a user, given a
 * pre-fetched per-team membership index.
 *
 * Pre-2026-05-26 this iterated `team.members[]` directly. Now: callers
 * build an index from the canonical `team_membership_sources` store
 * via `loadTeamMembersForSlugs` (one bulk query per reconciliation),
 * then pass it in. This keeps reconciliation O(teams + users) instead
 * of O(teams × users) round-trips.
 *
 * Role normalization: the canonical store collapses "owner" → "admin".
 * The downstream consumer treats admin == owner, so this is
 * behavior-preserving.
 */
function overridesForUser(
  email: string | undefined,
  teams: TeamDoc[],
  membersBySlug: Map<string, CanonicalTeamMember[]>,
): TeamBaselineProfileOverride[] {
  if (!email) return [];
  const normalizedEmail = email.trim().toLowerCase();
  const overrides: TeamBaselineProfileOverride[] = [];
  for (const team of teams) {
    if (!team.slug) continue;
    const canonical = membersBySlug.get(team.slug) ?? [];
    const member = canonical.find(
      (m) =>
        (m.user_email && m.user_email.toLowerCase() === normalizedEmail) ||
        false,
    );
    if (!member) continue;
    const memberProfileId = team.baseline_profile_overrides?.member_profile_id;
    const adminProfileId = team.baseline_profile_overrides?.admin_profile_id;
    if (!memberProfileId && !adminProfileId) continue;
    overrides.push({
      team_id: idString(team._id),
      team_slug: team.slug,
      team_name: team.name,
      role: member.role,
      member_profile_id: memberProfileId,
      admin_profile_id: adminProfileId,
    });
  }
  return overrides;
}

/**
 * Build a Map<team_slug, CanonicalTeamMember[]> for every team in the
 * input. One bulk query against `team_membership_sources`. Use as the
 * `membersBySlug` argument to `overridesForUser` during a multi-user
 * reconciliation.
 */
async function loadMembershipIndex(teams: TeamDoc[]): Promise<Map<string, CanonicalTeamMember[]>> {
  const slugs = teams
    .map((t) => t.slug)
    .filter((slug): slug is string => typeof slug === "string" && slug.length > 0);
  return loadTeamMembersForSlugs(slugs);
}

async function saveTeamAssignments(assignments: TeamAssignment[]): Promise<void> {
  if (assignments.length === 0) return;
  const teams = await getCollection<TeamDoc>("teams");
  await teams.bulkWrite(
    assignments.map((assignment) => ({
      updateOne: {
        filter: { _id: teamIdForFilter(assignment.team_id) },
        update: {
          $set: {
            "baseline_profile_overrides.member_profile_id": assignment.member_profile_id,
            "baseline_profile_overrides.admin_profile_id": assignment.admin_profile_id,
          },
        },
      },
    })),
  );
}

async function reconcileProfile(input: {
  previousProfile: BaselineFgaProfile;
  nextProfile: BaselineFgaProfile;
  apply: { mode: ApplyMode; userId?: string; role: "member" | "admin" };
}): Promise<{ mode: ApplyMode; user_count: number; writes: number; deletes: number }> {
  if (input.apply.mode === "none") {
    return { mode: "none", user_count: 0, writes: 0, deletes: 0 };
  }

  const targets =
    input.apply.mode === "user"
      ? [{ subject: input.apply.userId ?? "", isAdmin: input.apply.role === "admin" }]
      : await usersForApplyAll();

  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];
  for (const target of targets) {
    if (!target.subject) continue;
    const previousTuples = baselineBootstrapTuples(target.subject, target.isAdmin, input.previousProfile);
    const nextTuples = baselineBootstrapTuples(target.subject, target.isAdmin, input.nextProfile);
    writes.push(...nextTuples);
    deletes.push(...diffTuples(previousTuples, nextTuples));
  }

  if (writes.length === 0 && deletes.length === 0) {
    return { mode: input.apply.mode, user_count: targets.length, writes: 0, deletes: 0 };
  }

  const result = await writeOpenFgaTuples({ writes, deletes });
  return {
    mode: input.apply.mode,
    user_count: targets.length,
    writes: result.writes,
    deletes: result.deletes,
  };
}

async function reconcileBundle(input: {
  previousBundle: BaselineFgaProfileBundle;
  nextBundle: BaselineFgaProfileBundle;
  previousTeams: TeamDoc[];
  nextTeams: TeamDoc[];
  apply: { mode: ApplyMode; userId?: string; role: "member" | "admin" };
}): Promise<{ mode: ApplyMode; user_count: number; writes: number; deletes: number }> {
  if (input.apply.mode === "none") {
    return { mode: "none", user_count: 0, writes: 0, deletes: 0 };
  }

  const targets =
    input.apply.mode === "user"
      ? [{ subject: input.apply.userId ?? "", isAdmin: input.apply.role === "admin" }]
      : await usersForApplyAll();

  // Prefetch canonical membership indices once per team set. The
  // previous-bundle vs next-bundle distinction in this function is
  // about baseline-profile assignments, not memberships, so the
  // membership index is the same shape for both — however we still
  // build two indices (one per TeamDoc[] parameter) because the team
  // docs themselves may differ (e.g. a team could be renamed mid-
  // reconcile). The bulk query is one indexed find per call.
  const previousMembers = await loadMembershipIndex(input.previousTeams);
  const nextMembers = await loadMembershipIndex(input.nextTeams);

  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];
  for (const target of targets) {
    if (!target.subject) continue;
    const previousTuples = effectiveBaselineBootstrapTuples({
      subject: target.subject,
      isAdmin: target.isAdmin,
      bundle: input.previousBundle,
      teamOverrides: overridesForUser(target.email, input.previousTeams, previousMembers),
    });
    const nextTuples = effectiveBaselineBootstrapTuples({
      subject: target.subject,
      isAdmin: target.isAdmin,
      bundle: input.nextBundle,
      teamOverrides: overridesForUser(target.email, input.nextTeams, nextMembers),
    });
    writes.push(...nextTuples);
    deletes.push(...diffTuples(previousTuples, nextTuples));
  }

  if (writes.length === 0 && deletes.length === 0) {
    return { mode: input.apply.mode, user_count: targets.length, writes: 0, deletes: 0 };
  }

  const result = await writeOpenFgaTuples({ writes, deletes });
  return {
    mode: input.apply.mode,
    user_count: targets.length,
    writes: result.writes,
    deletes: result.deletes,
  };
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const bundle = await getBaselineFgaProfileBundle();
    const teams = await listTeams();
    return successResponse({
      profile: bundleToLegacyProfile(bundle),
      bundle,
      team_assignments: assignmentsFromTeams(teams),
      available_grants: baselineGrantCatalog(),
    });
  }),
);

export const PUT = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async ({ user, session }) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const previousBundle = await getBaselineFgaProfileBundle();
    const previousProfile = bundleToLegacyProfile(previousBundle);
    const parsed = parseBody(body);
    const previousTeams = await listTeams();
    let nextProfile: BaselineFgaProfile;
    let nextBundle: BaselineFgaProfileBundle;
    let nextTeams = previousTeams;
    let reconciliation: { mode: ApplyMode; user_count: number; writes: number; deletes: number };

    if (parsed.bundle) {
      nextBundle = await saveBaselineFgaProfileBundle({
        profiles: parsed.bundle.profiles,
        global_member_profile_id: parsed.bundle.global_member_profile_id,
        global_admin_profile_id: parsed.bundle.global_admin_profile_id,
        updated_by: user.email,
      });
      await saveTeamAssignments(parsed.teamAssignments ?? []);
      nextTeams = applyTeamAssignments(previousTeams, parsed.teamAssignments ?? []);
      nextProfile = bundleToLegacyProfile(nextBundle);
      reconciliation = await reconcileBundle({
        previousBundle,
        nextBundle,
        previousTeams,
        nextTeams,
        apply: parsed.apply,
      });
    } else if (parsed.profile) {
      nextProfile = await saveBaselineFgaProfile({
        member_grants: parsed.profile.member_grants,
        admin_grants: parsed.profile.admin_grants,
        updated_by: user.email,
      });
      nextBundle = normalizeBaselineFgaProfileBundle({
        profiles: [
          { id: "org-member", name: "Organization member", role: "member", grants: nextProfile.member_grants },
          { id: "org-admin", name: "Organization admin", role: "admin", grants: nextProfile.admin_grants },
        ],
        global_member_profile_id: "org-member",
        global_admin_profile_id: "org-admin",
        source: "mongo",
      });
      reconciliation = await reconcileProfile({
        previousProfile,
        nextProfile,
        apply: parsed.apply,
      });
    } else {
      throw new ApiError("No baseline profile changes provided", 400);
    }

    logOpenFgaRebacAuditEvent({
      tenantId: session?.org ?? "default",
      sub: session?.sub ?? user.email,
      operation: "update_baseline_profile",
      scope: "admin",
      resourceRef: `openfga_baseline_profile:${JSON.stringify({
        member_grants: nextProfile.member_grants.length,
        admin_grants: nextProfile.admin_grants.length,
        apply_mode: reconciliation.mode,
        user_count: reconciliation.user_count,
      })}`,
      email: user.email,
    });

    return successResponse({
      profile: nextProfile,
      bundle: nextBundle,
      team_assignments: assignmentsFromTeams(nextTeams),
      available_grants: baselineGrantCatalog(),
      reconciliation,
    });
  }),
);
