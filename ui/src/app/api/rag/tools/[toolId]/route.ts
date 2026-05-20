import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { requireRbacPermission, ApiError, handleApiError } from "@/lib/api-middleware";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

/**
 * Single team-scoped RAG tool operations (098 Enterprise RBAC — FR-009).
 *
 * GET    /api/rag/tools/:toolId  — retrieve a tool by ID
 * PUT    /api/rag/tools/:toolId  — update a tool (name, datasources, description)
 * DELETE /api/rag/tools/:toolId  — soft-delete a tool (set status=deleted)
 *
 * Cross-team edits are blocked by the ReBAC gate before mutations are applied.
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
  updated_at: Date;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> },
) {
  try {
    const { toolId } = await params;
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
    const tool = await tools.findOne({ tool_id: toolId });

    if (!tool || tool.status === "deleted") {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }
    await requireResourcePermission(
      { sub: session.sub, role: session.role, user: session.user },
      { type: "tool", id: toolId, action: "read" },
      { allowAdminBypass: true },
    );

    return NextResponse.json({ tool });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> },
) {
  try {
    const { toolId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireRbacPermission(
      { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
      "rag",
      "tool.update",
    );

    const tools = await getCollection<TeamRagToolDoc>("team_rag_tools");
    const existing = await tools.findOne({ tool_id: toolId });

    if (!existing || existing.status === "deleted") {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }
    await requireResourcePermission(
      { sub: session.sub, role: session.role, user: session.user },
      { type: "tool", id: toolId, action: "write" },
      { allowAdminBypass: true },
    );

    const body = await request.json();
    const { name, datasource_ids, description } = body as {
      name?: string;
      datasource_ids?: string[];
      description?: string;
    };

    if (datasource_ids && datasource_ids.length > 0) {
      const ownership = await getCollection<TeamKbOwnershipDoc>("team_kb_ownership");
      const teamOwnership = await ownership.findOne({
        team_id: existing.team_id,
        ...(session.org ? { tenant_id: session.org } : {}),
      });

      if (teamOwnership) {
        const allowed = new Set(teamOwnership.allowed_datasource_ids);
        const violations = datasource_ids.filter((ds) => !allowed.has(ds));
        if (violations.length > 0) {
          throw new ApiError(
            `Datasource binding rejected — ${violations.join(", ")} not in team's allowed set`,
            403,
          );
        }
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (name !== undefined) updates.name = name;
    if (datasource_ids !== undefined) updates.datasource_ids = datasource_ids;
    if (description !== undefined) updates.description = description;

    await tools.updateOne({ tool_id: toolId }, { $set: updates });

    const updated = await tools.findOne({ tool_id: toolId });
    return NextResponse.json({ tool: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> },
) {
  try {
    const { toolId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireRbacPermission(
      { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
      "rag",
      "tool.delete",
    );

    const tools = await getCollection<TeamRagToolDoc>("team_rag_tools");
    const existing = await tools.findOne({ tool_id: toolId });

    if (!existing || existing.status === "deleted") {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }
    await requireResourcePermission(
      { sub: session.sub, role: session.role, user: session.user },
      { type: "tool", id: toolId, action: "delete" },
      { allowAdminBypass: true },
    );

    await tools.updateOne(
      { tool_id: toolId },
      { $set: { status: "deleted", updated_at: new Date() } },
    );

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
