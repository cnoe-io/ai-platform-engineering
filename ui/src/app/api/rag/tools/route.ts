import { ApiError,handleApiError,requireRbacPermission } from "@/lib/api-middleware";
import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { filterResourcesByPermission } from "@/lib/rbac/resource-authz";
import { extractRealmRolesFromSession } from "@/lib/rbac/task-skill-realm-access";
import { listTeamKbGrants } from "@/lib/rbac/team-resource-listing";
import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { NextRequest,NextResponse } from "next/server";

/**
 * Team-scoped RAG tool management (098 Enterprise RBAC — FR-009).
 *
 * GET  /api/rag/tools           — list tools for the caller's team(s)
 * POST /api/rag/tools           — create a new team-scoped RAG tool
 *
 * RBAC: Keycloak AuthZ checks for resource "rag" with scopes
 * "tool.view" (GET) and "tool.create" (POST).  Team scoping is derived
 * from the caller's realm roles (e.g. "team_member(team-a)").
 */

interface TeamRagToolDoc {
  tool_id: string;
  tenant_id: string;
  team_id: string;
  name: string;
  description?: string;
  datasource_ids: string[];
  created_by: string;
  updated_at: Date;
  status: string;
}

/**
 * The set of datasource ids a team is allowed to bind RAG tools to, derived
 * from OpenFGA `knowledge_base` grants (the single source of truth — there is
 * no `team_kb_ownership` store anymore).
 *
 * `teamId` is the team's Mongo `_id` string (the `team_member(<id>)` realm
 * role payload), which we resolve to the team slug FGA grants are keyed under.
 * Returns `null` when the team can't be resolved or holds no KB grants, which
 * the callers treat as "no restriction recorded" — matching the prior
 * behavior where a missing ownership row skipped the check.
 */
export async function loadTeamAllowedDatasourceIds(
  teamId: string,
): Promise<Set<string> | null> {
  if (!ObjectId.isValid(teamId)) return null;
  const teams = await getCollection<{ _id: ObjectId; slug?: string }>("teams");
  const team = await teams.findOne({ _id: new ObjectId(teamId) } as never);
  const slug = typeof team?.slug === "string" ? team.slug.trim() : "";
  if (!slug) return null;
  const grants = await listTeamKbGrants(slug);
  if (grants.kbIds.length === 0) return null;
  return new Set(grants.kbIds);
}

function extractTeamIds(realmRoles: string[] | undefined): string[] {
  if (!realmRoles) return [];
  const teams: string[] = [];
  for (const role of realmRoles) {
    const match = role.match(/^team_member\((.+)\)$/);
    if (match) {
      teams.push(match[1]);
    }
  }
  return teams;
}

function isAdmin(realmRoles: string[] | undefined): boolean {
  return !!realmRoles?.includes("admin");
}

function isKbAdmin(realmRoles: string[] | undefined): boolean {
  return !!realmRoles?.includes("kb_admin");
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireRbacPermission(
      { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
      "rag",
      "tool.view",
    );

    const tools = await getCollection<TeamRagToolDoc>("team_rag_tools");
    const realmRoles = extractRealmRolesFromSession(session);

    let filter: Record<string, unknown> = {};
    if (isAdmin(realmRoles) || isKbAdmin(realmRoles)) {
      if (session.org) {
        filter = { tenant_id: session.org };
      }
    } else {
      const teamIds = extractTeamIds(realmRoles);
      if (teamIds.length === 0) {
        return NextResponse.json({ tools: [] });
      }
      filter = { team_id: { $in: teamIds } };
      if (session.org) {
        filter.tenant_id = session.org;
      }
    }

    const results = await tools
      .find(filter)
      .sort({ updated_at: -1 })
      .limit(200)
      .toArray();
    const visibleResults = await filterResourcesByPermission(
      { sub: session.sub, role: session.role, user: session.user },
      results,
      { type: "tool", action: "read", id: (tool) => tool.tool_id },
      { bypassForOrgAdmin: true },
    );

    return NextResponse.json({ tools: visibleResults });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireRbacPermission(
      { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
      "rag",
      "tool.create",
    );

    const body = await request.json();
    const { name, team_id, datasource_ids, description } = body as {
      name?: string;
      team_id?: string;
      datasource_ids?: string[];
      description?: string;
    };

    if (!name || !team_id) {
      throw new ApiError("name and team_id are required", 400);
    }

    const realmRoles = extractRealmRolesFromSession(session);
    if (!isAdmin(realmRoles) && !isKbAdmin(realmRoles)) {
      const callerTeams = extractTeamIds(realmRoles);
      if (!callerTeams.includes(team_id)) {
        throw new ApiError(
          `You are not a member of team '${team_id}' — cross-team tool creation is blocked`,
          403,
        );
      }
    }

    const requestedDatasources = datasource_ids || [];
    if (requestedDatasources.length > 0) {
      const allowed = await loadTeamAllowedDatasourceIds(team_id);
      if (allowed) {
        const violations = requestedDatasources.filter((ds) => !allowed.has(ds));
        if (violations.length > 0) {
          throw new ApiError(
            `Datasource binding rejected — ${violations.join(", ")} not in team's allowed set`,
            403,
          );
        }
      }
    }

    const tool: TeamRagToolDoc = {
      tool_id: randomUUID(),
      tenant_id: session.org || "default",
      team_id,
      name,
      description: description || undefined,
      datasource_ids: requestedDatasources,
      created_by: session.sub || session.user.email,
      updated_at: new Date(),
      status: "active",
    };

    const tools = await getCollection<TeamRagToolDoc>("team_rag_tools");
    await tools.insertOne(tool);

    return NextResponse.json({ tool }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
