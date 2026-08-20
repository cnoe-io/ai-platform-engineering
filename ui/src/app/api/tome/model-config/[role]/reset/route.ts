// Model config — reset a role to its shipped default.
//
//   POST /api/tome/model-config/[role]/reset
//
// TOME-Admin gated. Overwrites the role's current model (including any
// prior admin edits) with the env-var/hardcoded fallback.

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  AGENT_ROLES,
  deleteModelConfig,
  ModelConfigValidationFailure,
  parseModelScope,
  type AgentRole,
} from "@/lib/tome/model-config-store";

type Ctx = { params: Promise<{ role: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  if (!isTomeServerEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { role } = await ctx.params;
  if (!(AGENT_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: `Unknown role "${role}"` }, { status: 400 });
  }

  let body: { scope_kind?: string; scope_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Backward-compatible empty body means global.
  }
  try {
    const scope = parseModelScope(body.scope_kind ?? "global", body.scope_id ?? null);
    if (scope.kind === "exact") {
      return NextResponse.json({ error: "Exact configuration belongs in entity Settings." }, { status: 422 });
    }
    await deleteModelConfig(scope, role as AgentRole);
    return NextResponse.json({ config: null });
  } catch (error) {
    if (error instanceof ModelConfigValidationFailure) {
      return NextResponse.json({ error: "Validation failed", errors: error.errors }, { status: 422 });
    }
    throw error;
  }
}
