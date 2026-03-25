import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { randomUUID } from "crypto";
import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { requireRbacPermission, ApiError, handleApiError } from "@/lib/api-middleware";

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

interface TeamKbOwnershipDoc {
  team_id: string;
  tenant_id: string;
  kb_ids: string[];
  allowed_datasource_ids: string[];
  keycloak_role: string;
  updated_at: Date;
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
      { accessToken: session.accessToken, sub: session.sub, org: session.org },
      "rag",
      "tool.view",
    );

    const tools = await getCollection<TeamRagToolDoc>("team_rag_tools");
    const realmRoles = session.realmRoles;

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

    return NextResponse.json({ tools: results });
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
      { accessToken: session.accessToken, sub: session.sub, org: session.org },
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

    const realmRoles = session.realmRoles;
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
      const ownership = await getCollection<TeamKbOwnershipDoc>("team_kb_ownership");
      const teamOwnership = await ownership.findOne({
        team_id,
        ...(session.org ? { tenant_id: session.org } : {}),
      });

      if (teamOwnership) {
        const allowed = new Set(teamOwnership.allowed_datasource_ids);
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
