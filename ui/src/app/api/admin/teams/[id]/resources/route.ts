/**
 * Spec 104 — Team-scoped RBAC: resource assignment endpoint.
 *
 * GET  /api/admin/teams/[id]/resources
 *   → returns the agents and tools currently assigned to the team plus the
 *     full picker catalog (`available.agents`, `available.tools`) so the UI
 *     can render checkboxes without a second round-trip.
 *
 * PUT  /api/admin/teams/[id]/resources
 *   body: { agents: string[]; tools: string[] }
 *   - Persists the selection on the team document (`team.resources`).
 *   - Reconciles realm-role assignments for every team member:
 *       added agent  → ensure role `agent_user:<id>`  → assign to each member
 *       added tool   → ensure role `tool_user:<id>`   → assign to each member
 *       removed      → remove role from each member.
 *
 * Why we materialize roles on members instead of "team roles":
 *   AgentGateway CEL rules and Dynamic Agents both authorize against
 *   `jwt.realm_access.roles`, which Keycloak only populates from realm-role
 *   assignments on the **user** (or composites). There is no "team token";
 *   each user authenticates separately, so the team is just a UI grouping
 *   that fans out role bindings.
 *
 * Idempotency: roles are created on demand (`ensureRealmRole`) and assignments
 * are full diffs against current state, so re-saving the same selection is a
 * no-op.
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
  type KeycloakRole,
} from "@/lib/rbac/keycloak-admin";
import type { Team, TeamMember } from "@/types/teams";

interface DynamicAgentLite {
  _id: string;
  name?: string;
  description?: string;
  visibility?: string;
  enabled?: boolean;
}

interface MCPServerLite {
  _id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
}

function requireMongoDB() {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - team resources require MongoDB",
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

function toRoleNames(
  prefix: "agent_user" | "agent_admin" | "tool_user",
  ids: string[]
): string[] {
  return ids.filter((id) => typeof id === "string" && id.length > 0).map((id) => `${prefix}:${id}`);
}

const TOOL_WILDCARD_ROLE = "tool_user:*";

// ─────────────────────────────────────────────────────────────────────────────
// GET — current selection + available picker catalog
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

      const agentsCol = await getCollection<DynamicAgentLite>("dynamic_agents");
      const mcpCol = await getCollection<MCPServerLite>("mcp_servers");

      const [allAgents, allServers] = await Promise.all([
        agentsCol
          .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1, description: 1, visibility: 1 } })
          .sort({ name: 1 })
          .toArray()
          .catch(() => [] as DynamicAgentLite[]),
        mcpCol
          .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1, description: 1 } })
          .sort({ name: 1 })
          .toArray()
          .catch(() => [] as MCPServerLite[]),
      ]);

      // We render tools by MCP server prefix (e.g. `jira_*`) because the
      // realm role catalog uses `tool_user:<server>_*` as a coarse grant by
      // default. Users can still type a specific `tool_user:<full_tool_name>`
      // role manually via the realm roles tab.
      const toolPrefixes = allServers.map((s) => `${s._id}_*`);

      const resources = team.resources ?? {};

      console.log(
        `[Admin TeamResources] GET team=${id} agents=${(resources.agents ?? []).length} agent_admins=${(resources.agent_admins ?? []).length} tools=${(resources.tools ?? []).length} wildcard=${resources.tool_wildcard ? "yes" : "no"} by=${user.email}`
      );

      return successResponse({
        team_id: id,
        resources: {
          agents: resources.agents ?? [],
          agent_admins: resources.agent_admins ?? [],
          tools: resources.tools ?? [],
          tool_wildcard: Boolean(resources.tool_wildcard),
        },
        available: {
          agents: allAgents.map((a) => ({ id: a._id, name: a.name ?? a._id, description: a.description ?? "" })),
          tools: toolPrefixes.map((id, i) => ({
            id,
            name: id,
            description: allServers[i].description ?? "",
          })),
        },
      });
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT — persist selection + reconcile member role assignments
// ─────────────────────────────────────────────────────────────────────────────

interface PutBody {
  agents?: unknown;
  agent_admins?: unknown;
  tools?: unknown;
  tool_wildcard?: unknown;
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
    out.push(item.trim());
  }
  // Dedup while preserving order — the UI sends checkbox state that is
  // already unique, but defence-in-depth keeps Mongo+KC clean.
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

      const nextAgents = parseStringArray(body.agents ?? [], "agents");
      const nextAgentAdmins = parseStringArray(body.agent_admins ?? [], "agent_admins");
      const nextTools = parseStringArray(body.tools ?? [], "tools");
      const nextToolWildcard = Boolean(body.tool_wildcard);

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      const prevAgents = team.resources?.agents ?? [];
      const prevAgentAdmins = team.resources?.agent_admins ?? [];
      const prevTools = team.resources?.tools ?? [];
      const prevToolWildcard = Boolean(team.resources?.tool_wildcard);

      const agentDiff = diff(prevAgents, nextAgents);
      const agentAdminDiff = diff(prevAgentAdmins, nextAgentAdmins);
      const toolDiff = diff(prevTools, nextTools);
      // Wildcard is a single boolean — model as a one-element diff so it flows
      // through the same role-reconciliation pipeline below.
      const wildcardDiff = diff(
        prevToolWildcard ? [TOOL_WILDCARD_ROLE] : [],
        nextToolWildcard ? [TOOL_WILDCARD_ROLE] : []
      );

      // ── 1. Ensure all newly-added roles exist in Keycloak.
      //
      //    Done up front (and concurrently) so a partial save doesn't leave
      //    Mongo updated but KC missing the role; if KC is unreachable we
      //    bail before mutating anything.
      const addedAgentRoles = await Promise.all(
        toRoleNames("agent_user", agentDiff.added).map((n) =>
          ensureRealmRole(n, `Spec 104: team-scoped grant — agent ${n.split(":")[1]}`)
        )
      );
      const addedAgentAdminRoles = await Promise.all(
        toRoleNames("agent_admin", agentAdminDiff.added).map((n) =>
          ensureRealmRole(n, `Spec 104: team-scoped grant — manage agent ${n.split(":")[1]}`)
        )
      );
      const addedToolRoles = await Promise.all(
        toRoleNames("tool_user", toolDiff.added).map((n) =>
          ensureRealmRole(n, `Spec 104: team-scoped grant — tool(s) ${n.split(":")[1]}`)
        )
      );
      // The wildcard role itself (`tool_user:*`) is bootstrapped by init-idp,
      // but ensureRealmRole is idempotent so this is safe defence-in-depth.
      const addedWildcardRoles = await Promise.all(
        wildcardDiff.added.map((n) =>
          ensureRealmRole(n, "Spec 104: team-scoped wildcard grant — all MCP tools")
        )
      );

      // For removals we still need the role objects (assign/removeRealmRolesToUser
      // take {id,name,...}, not bare names). Removed roles always already exist
      // (they were ensured at add-time), so ensureRealmRole is a cheap GET here.
      const removedAgentRoles = await Promise.all(
        toRoleNames("agent_user", agentDiff.removed).map((n) => ensureRealmRole(n))
      );
      const removedAgentAdminRoles = await Promise.all(
        toRoleNames("agent_admin", agentAdminDiff.removed).map((n) => ensureRealmRole(n))
      );
      const removedToolRoles = await Promise.all(
        toRoleNames("tool_user", toolDiff.removed).map((n) => ensureRealmRole(n))
      );
      const removedWildcardRoles = await Promise.all(
        wildcardDiff.removed.map((n) => ensureRealmRole(n))
      );

      // ── 2. Reconcile each member.
      //
      //    A team can have a member email that doesn't have a Keycloak account
      //    yet (e.g. invited but never logged in). We log + skip those rather
      //    than failing the whole PUT — the UI will flag them in the response.
      const members: TeamMember[] = team.members ?? [];
      const skippedMembers: string[] = [];
      const updatedMembers: string[] = [];

      const rolesToAdd: KeycloakRole[] = [
        ...addedAgentRoles,
        ...addedAgentAdminRoles,
        ...addedToolRoles,
        ...addedWildcardRoles,
      ];
      const rolesToRemove: KeycloakRole[] = [
        ...removedAgentRoles,
        ...removedAgentAdminRoles,
        ...removedToolRoles,
        ...removedWildcardRoles,
      ];

      if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
        for (const m of members) {
          const userId = await findUserIdByEmail(m.user_id);
          if (!userId) {
            skippedMembers.push(m.user_id);
            continue;
          }
          try {
            if (rolesToAdd.length > 0) {
              await assignRealmRolesToUser(userId, rolesToAdd);
            }
            if (rolesToRemove.length > 0) {
              await removeRealmRolesFromUser(userId, rolesToRemove);
            }
            updatedMembers.push(m.user_id);
          } catch (err) {
            // One member failure shouldn't poison the rest. Log + continue.
            console.error(
              `[Admin TeamResources] Failed to reconcile roles for ${m.user_id}:`,
              err instanceof Error ? err.message : err
            );
            skippedMembers.push(m.user_id);
          }
        }
      }

      // ── 3. Persist selection on the team document.
      const now = new Date();
      await teamsCol.updateOne(
        { _id: teamId } as never,
        {
          $set: {
            resources: {
              agents: nextAgents,
              agent_admins: nextAgentAdmins,
              tools: nextTools,
              tool_wildcard: nextToolWildcard,
            },
            updated_at: now,
          },
        }
      );

      console.log(
        `[Admin TeamResources] PUT team=${id} agents+=${agentDiff.added.length}/-${agentDiff.removed.length} agent_admins+=${agentAdminDiff.added.length}/-${agentAdminDiff.removed.length} tools+=${toolDiff.added.length}/-${toolDiff.removed.length} wildcard=${nextToolWildcard ? "on" : "off"} members_updated=${updatedMembers.length} members_skipped=${skippedMembers.length} by=${user.email}`
      );

      return successResponse({
        team_id: id,
        resources: {
          agents: nextAgents,
          agent_admins: nextAgentAdmins,
          tools: nextTools,
          tool_wildcard: nextToolWildcard,
        },
        diff: {
          agents_added: agentDiff.added,
          agents_removed: agentDiff.removed,
          agent_admins_added: agentAdminDiff.added,
          agent_admins_removed: agentAdminDiff.removed,
          tools_added: toolDiff.added,
          tools_removed: toolDiff.removed,
          tool_wildcard_added: wildcardDiff.added.length > 0,
          tool_wildcard_removed: wildcardDiff.removed.length > 0,
        },
        members_updated: updatedMembers,
        members_skipped: skippedMembers,
      });
    });
  }
);
