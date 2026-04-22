import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { evaluate as evalCel } from "@/lib/rbac/cel-evaluator";
import type { AgMcpPolicy, AgMcpBackend } from "@/lib/rbac/types";

const AG_DRY_CONTEXT = {
  jwt: {
    sub: "dry-run@test.com",
    realm_access: { roles: ["chat_user", "admin"] },
    org: "default",
  },
  mcp: { tool: { name: "search" } },
  request: { headers: { "x-forwarded-for": "10.0.0.1" } },
};

type AdminAuthResult =
  | { ok: true; email: string; response?: undefined }
  | { ok: false; email?: undefined; response: NextResponse };

async function requireAdmin(): Promise<AdminAuthResult> {
  const session = (await getServerSession(authOptions)) as {
    role?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  if (!isMongoDBConfigured) {
    return { ok: false, response: NextResponse.json({ error: "MongoDB not configured" }, { status: 503 }) };
  }
  return { ok: true, email: session.user.email };
}

async function bumpPolicyGeneration(): Promise<number> {
  const col = await getCollection<{ _id: string; policy_generation: number }>("ag_sync_state");
  const result = await col.findOneAndUpdate(
    { _id: "current" },
    {
      $inc: { policy_generation: 1 },
      $setOnInsert: { bridge_generation: 0, bridge_last_sync: null, bridge_error: null },
    },
    { upsert: true, returnDocument: "after" },
  );
  return result?.policy_generation ?? 1;
}

/**
 * GET /api/rbac/ag-policies
 *
 * Returns all AG MCP policies grouped by backend_id, plus the list of
 * registered backends. Admin-only.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const [policies, backends] = await Promise.all([
      (await getCollection<AgMcpPolicy>("ag_mcp_policies")).find({}).sort({ backend_id: 1, tool_pattern: 1 }).toArray(),
      (await getCollection<AgMcpBackend>("ag_mcp_backends")).find({}).sort({ id: 1 }).toArray(),
    ]);

    const grouped: Record<string, AgMcpPolicy[]> = {};
    for (const p of policies) {
      const key = p.backend_id;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        _id: String(p._id),
        backend_id: p.backend_id,
        tool_pattern: p.tool_pattern,
        expression: p.expression,
        description: p.description,
        enabled: p.enabled,
        updated_by: p.updated_by,
        updated_at: p.updated_at,
      });
    }

    return NextResponse.json({
      policies: grouped,
      backends: backends.map((b) => ({
        _id: String(b._id),
        id: b.id,
        upstream_url: b.upstream_url,
        description: b.description,
        enabled: b.enabled,
        updated_by: b.updated_by,
        updated_at: b.updated_at,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/rbac/ag-policies
 *
 * Upserts a single AG MCP policy. Validates the CEL expression via dry-run
 * before persisting. Bumps the policy generation counter so the config
 * bridge can detect changes.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Partial<AgMcpPolicy>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { backend_id, tool_pattern, expression, description, enabled } = body;
  if (!backend_id || !tool_pattern || !expression) {
    return NextResponse.json(
      { error: "backend_id, tool_pattern, and expression are required" },
      { status: 400 },
    );
  }

  try {
    evalCel(expression.trim(), AG_DRY_CONTEXT);
  } catch (e) {
    return NextResponse.json(
      { error: `Invalid CEL expression: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  try {
    const col = await getCollection<AgMcpPolicy>("ag_mcp_policies");
    await col.updateOne(
      { backend_id, tool_pattern } as Record<string, unknown>,
      {
        $set: {
          expression: expression.trim(),
          description: description ?? "",
          enabled: enabled !== false,
          updated_by: auth.email,
          updated_at: new Date().toISOString(),
        },
      },
      { upsert: true },
    );

    const generation = await bumpPolicyGeneration();

    return NextResponse.json({
      success: true,
      backend_id,
      tool_pattern,
      sync_status: "pending",
      policy_generation: generation,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/rbac/ag-policies
 *
 * Creates or updates an AG MCP backend target. Admin-only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { action?: string } & Partial<AgMcpBackend>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "upsert_backend") {
    const { id, upstream_url, description, enabled } = body;
    if (!id || !upstream_url) {
      return NextResponse.json(
        { error: "id and upstream_url are required for backend upsert" },
        { status: 400 },
      );
    }

    try {
      const col = await getCollection<AgMcpBackend>("ag_mcp_backends");
      await col.updateOne(
        { id } as Record<string, unknown>,
        {
          $set: {
            upstream_url,
            description: description ?? "",
            enabled: enabled !== false,
            updated_by: auth.email,
            updated_at: new Date().toISOString(),
          },
        },
        { upsert: true },
      );

      await bumpPolicyGeneration();
      return NextResponse.json({ success: true, id });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Database error" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/**
 * DELETE /api/rbac/ag-policies
 *
 * Deletes an AG MCP policy by backend_id + tool_pattern, or a backend by id.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { type?: string; backend_id?: string; tool_pattern?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.type === "backend" && body.id) {
      const backendsCol = await getCollection<AgMcpBackend>("ag_mcp_backends");
      await backendsCol.deleteOne({ id: body.id } as Record<string, unknown>);
      const policiesCol = await getCollection<AgMcpPolicy>("ag_mcp_policies");
      await policiesCol.deleteMany({ backend_id: body.id } as Record<string, unknown>);
    } else if (body.backend_id && body.tool_pattern) {
      const col = await getCollection<AgMcpPolicy>("ag_mcp_policies");
      await col.deleteOne({ backend_id: body.backend_id, tool_pattern: body.tool_pattern } as Record<string, unknown>);
    } else {
      return NextResponse.json(
        { error: "Provide {type:'backend', id} or {backend_id, tool_pattern}" },
        { status: 400 },
      );
    }

    await bumpPolicyGeneration();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 },
    );
  }
}
