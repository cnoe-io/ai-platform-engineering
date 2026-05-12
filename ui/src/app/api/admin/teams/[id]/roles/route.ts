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
 *   catch-all for "assign realm role X to all members of this team" — covers
 *   bare global roles like `admin_user`, `kb_admin`, `chat_user`, KB-scoped
 *   roles like `kb_reader:kb-platform`, and any custom realm role an admin
 *   has created. Resources writes `team.resources`; this writes
 *   `team.keycloak_roles`. Together they fan out into the same KC user role
 *   bindings — which AgentGateway and Dynamic Agents authorize against.
 */

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  requireRbacPermission,
  ApiError,
} from "@/lib/api-middleware";
import {
  ensureRealmRole,
  findUserIdByEmail,
  assignRealmRolesToUser,
  removeRealmRolesFromUser,
  listRealmRoles,
  type KeycloakRole,
} from "@/lib/rbac/keycloak-admin";
import type { Team, TeamMember } from "@/types/teams";

// Roles that should never appear in the team picker — Keycloak system roles
// users have no business toggling at the team scope. They're either the
// realm default-composite or OAuth/UMA grant scopes.
const SYSTEM_ROLE_BLACKLIST = new Set([
  "default-roles-caipe",
  "offline_access",
  "uma_authorization",
]);

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

    return withAuth(request, async (_req, user, session) => {
      await requireRbacPermission(session, "admin_ui", "view");

      const { id } = await context.params;
      const teamId = parseTeamId(id);

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      const teamRoles = Array.isArray(team.keycloak_roles) ? team.keycloak_roles : [];

      // Catalog: every realm role except system roles. We let the UI group
      // by category (split on ":"). Includes the agent_user/tool_user/team_member
      // roles too — admins can use this tab as a fallback if they prefer raw
      // role assignment to the curated /resources picker.
      let catalog: RoleCatalogEntry[] = [];
      try {
        const all = await listRealmRoles();
        catalog = all
          .filter((r) => !SYSTEM_ROLE_BLACKLIST.has(r.name))
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
    out.push(trimmed);
  }
  return Array.from(new Set(out));
}

export const PUT = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    return withAuth(request, async (_req, user, session) => {
      await requireRbacPermission(session, "admin_ui", "admin");
      requireAdmin(session);

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
      const members: TeamMember[] = team.members ?? [];
      const skippedMembers: string[] = [];
      const updatedMembers: string[] = [];

      if (addedRoleObjs.length > 0 || removedRoleObjs.length > 0) {
        for (const m of members) {
          const userId = await findUserIdByEmail(m.user_id);
          if (!userId) {
            skippedMembers.push(m.user_id);
            continue;
          }
          try {
            if (addedRoleObjs.length > 0) {
              await assignRealmRolesToUser(userId, addedRoleObjs);
            }
            if (removedRoleObjs.length > 0) {
              await removeRealmRolesFromUser(userId, removedRoleObjs);
            }
            updatedMembers.push(m.user_id);
          } catch (err) {
            console.error(
              `[Admin TeamRoles] Failed to reconcile roles for ${m.user_id}:`,
              err instanceof Error ? err.message : err
            );
            skippedMembers.push(m.user_id);
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
    });
  }
);
