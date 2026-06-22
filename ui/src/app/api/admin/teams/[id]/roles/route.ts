/**
 * Spec 104 — Team-scoped RBAC: realm-role assignment endpoint.
 *
 * GET  /api/admin/teams/[id]/roles
 *   → returns the team's currently-assigned realm roles plus the available
 *     realm-role catalog (excluding system internals like
 *     `default-roles-caipe`, `offline_access`, `uma_authorization`) so the UI
 *     can render a picker without a second round-trip.
 *
 * PUT  /api/admin/teams/[id]/roles
 *   body: { roles: string[] }
 *   - Persists the selection on the team document (`team.keycloak_roles`).
 *   - Reconciles realm-role assignments for every team member (added → assign,
 *     removed → unassign), exactly like /resources does.
 *
 * Why a separate endpoint from /resources:
 *   /resources is a high-level picker scoped to agents + tools. /roles is the
 *   catch-all for "assign global realm role X to all members of this team".
 *   Resource-scoped roles (`agent_user:*`, `tool_user:*`, `kb_reader:*`, ...)
 *   now belong in OpenFGA relationships and are always hidden/rejected here.
 */

import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import {
assignRealmRolesToUser,
ensureRealmRole,
findUserIdByEmail,
listRealmRoles,
removeRealmRolesFromUser,
type KeycloakRole,
} from "@/lib/rbac/keycloak-admin";
import { requireTeamMembershipManagementPermission } from "@/lib/rbac/team-admin-guards";
import { loadActiveTeamMembers } from "@/lib/rbac/team-membership-store";
import type { Team } from "@/types/teams";
import { ObjectId } from "mongodb";
import { NextRequest,NextResponse } from "next/server";

// Roles that should never appear in the team picker — Keycloak system roles
// users have no business toggling at the team scope. They're either the
// realm default-composite or OAuth/UMA grant scopes.
const SYSTEM_ROLE_BLACKLIST = new Set([
  "default-roles-caipe",
  "offline_access",
  "uma_authorization",
]);

const RESOURCE_ROLE_PREFIXES = [
  "agent_user:",
  "agent_admin:",
  "tool_user:",
  "kb_reader:",
  "kb_ingestor:",
  "kb_admin:",
  "task_user:",
  "task_admin:",
  "skill_user:",
  "skill_admin:",
] as const;
const RESOURCE_ROLE_NAMES = new Set(["kb_admin"]);

function isResourceScopedRole(name: string): boolean {
  return RESOURCE_ROLE_NAMES.has(name) || RESOURCE_ROLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function requireMongoDB() {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - team roles require MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }
  return null;
}

function parseTeamId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new ApiError("Invalid team ID format", 400);
  }
  return new ObjectId(id);
}

function diff(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((x) => !prevSet.has(x)),
    removed: prev.filter((x) => !nextSet.has(x)),
  };
}

interface RoleCatalogEntry {
  name: string;
  description?: string;
  /** Coarse grouping for the UI (e.g. `kb_reader`, `agent_user`, `(global)`). */
  category: string;
}

function categorize(name: string): string {
  if (name.includes(":")) {
    return name.split(":", 1)[0];
  }
  return "(global)";
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — current team roles + the catalog of available realm roles
// ─────────────────────────────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "team", "view");

      const { id } = await context.params;
      const teamId = parseTeamId(id);

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      const teamRoles = Array.isArray(team.keycloak_roles) ? team.keycloak_roles : [];

      // Catalog: every global/coarse realm role except system and resource
      // roles. Resource grants are authored as OpenFGA relationships.
      let catalog: RoleCatalogEntry[] = [];
      try {
        const all = await listRealmRoles();
        catalog = all
          .filter((r) => !SYSTEM_ROLE_BLACKLIST.has(r.name))
          .filter((r) => !isResourceScopedRole(r.name))
          .map((r) => ({
            name: r.name,
            description: r.description,
            category: categorize(r.name),
          }))
          .sort((a, b) => {
            if (a.category !== b.category) return a.category.localeCompare(b.category);
            return a.name.localeCompare(b.name);
          });
      } catch (err) {
        console.warn(
          "[Admin TeamRoles] listRealmRoles failed (returning empty catalog):",
          err instanceof Error ? err.message : err
        );
      }

      console.log(
        `[Admin TeamRoles] GET team=${id} assigned=${teamRoles.length} catalog=${catalog.length} by=${user.email}`
      );

      return successResponse({
        team_id: id,
        roles: teamRoles,
        available: catalog,
      });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT — persist selection + reconcile member realm-role assignments
// ─────────────────────────────────────────────────────────────────────────────

interface PutBody {
  roles?: unknown;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError(`${field} must be an array of strings`, 400);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new ApiError(`${field} must be an array of non-empty strings`, 400);
    }
    const trimmed = item.trim();
    if (SYSTEM_ROLE_BLACKLIST.has(trimmed)) {
      throw new ApiError(`Cannot assign system role: ${trimmed}`, 400);
    }
    if (isResourceScopedRole(trimmed)) {
      throw new ApiError(
        `Resource-scoped role "${trimmed}" is managed by OpenFGA relationships, not Keycloak team roles`,
        400
      );
    }
    out.push(trimmed);
  }
  return Array.from(new Set(out));
}

export const PUT = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);

      const { id } = await context.params;
      const teamId = parseTeamId(id);

      let body: PutBody;
      try {
        body = (await request.json()) as PutBody;
      } catch {
        throw new ApiError("Invalid JSON body", 400);
      }

      const nextRoles = parseStringArray(body.roles ?? [], "roles");

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      // Issue #1509: scoped team admins can manage roles on their own team
      // without holding platform-wide `organization:<org>#admin`.
      await requireTeamMembershipManagementPermission(session, user.email, team);

      const prevRoles = Array.isArray(team.keycloak_roles) ? team.keycloak_roles : [];
      const rolesDiff = diff(prevRoles, nextRoles);

      // Resolve role objects up-front. ensureRealmRole is idempotent: it'll
      // create the role if it doesn't exist (e.g. an admin typed in a new
      // pattern like `kb_reader:kb-new`). For removals we just need the
      // {id, name, ...} shape Keycloak's role-mapping endpoints expect.
      const addedRoleObjs: KeycloakRole[] = await Promise.all(
        rolesDiff.added.map((n) =>
          ensureRealmRole(n, `Spec 104: team-scoped grant — ${n}`)
        )
      );
      const removedRoleObjs: KeycloakRole[] = await Promise.all(
        rolesDiff.removed.map((n) => ensureRealmRole(n))
      );

      // Reconcile each member. See /resources for the rationale on why we
      // soft-skip members without a Keycloak account rather than failing.
      // Member list comes from the canonical team_membership_sources store
      // (post 2026-05-26 canonical-membership refactor); rows are deduped
      // by identity and limited to status:"active". Members without an
      // email (subject-only rows) are skipped — Keycloak realm-role
      // assignment requires an email lookup.
      const canonicalMembers = await loadActiveTeamMembers(team.slug ?? "");
      const memberEmails: string[] = canonicalMembers
        .map((m) => m.user_email)
        .filter((email): email is string => typeof email === "string" && email.length > 0);
      const skippedMembers: string[] = [];
      const updatedMembers: string[] = [];

      if (addedRoleObjs.length > 0 || removedRoleObjs.length > 0) {
        for (const memberEmail of memberEmails) {
          const userId = await findUserIdByEmail(memberEmail);
          if (!userId) {
            skippedMembers.push(memberEmail);
            continue;
          }
          try {
            if (addedRoleObjs.length > 0) {
              await assignRealmRolesToUser(userId, addedRoleObjs);
            }
            if (removedRoleObjs.length > 0) {
              await removeRealmRolesFromUser(userId, removedRoleObjs);
            }
            updatedMembers.push(memberEmail);
          } catch (err) {
            console.error(
              `[Admin TeamRoles] Failed to reconcile roles for ${memberEmail}:`,
              err instanceof Error ? err.message : err
            );
            skippedMembers.push(memberEmail);
          }
        }
      }

      const now = new Date();
      await teamsCol.updateOne(
        { _id: teamId } as never,
        { $set: { keycloak_roles: nextRoles, updated_at: now } }
      );

      console.log(
        `[Admin TeamRoles] PUT team=${id} roles+=${rolesDiff.added.length} roles-=${rolesDiff.removed.length} members_updated=${updatedMembers.length} members_skipped=${skippedMembers.length} by=${user.email}`
      );

      return successResponse({
        team_id: id,
        roles: nextRoles,
        diff: {
          added: rolesDiff.added,
          removed: rolesDiff.removed,
        },
        members_updated: updatedMembers,
        members_skipped: skippedMembers,
      });
  }
);
