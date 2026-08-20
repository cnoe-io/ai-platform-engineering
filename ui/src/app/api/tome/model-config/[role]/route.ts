// Model config — per-role admin write.
//
//   PATCH /api/tome/model-config/[role]  → set a role's model id
//
// TOME-Admin gated. Body: { model: string }.

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { testTomeModel } from "@/lib/tome/model-check";
import {
  AGENT_ROLES,
  ModelConfigValidationFailure,
  parseModelScope,
  updateModelConfig,
  type AgentRole,
} from "@/lib/tome/model-config-store";

type Ctx = { params: Promise<{ role: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
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

  let body: { model?: string; scope_kind?: string; scope_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.model !== "string") {
    return NextResponse.json({ error: "Body must include a `model` string" }, { status: 400 });
  }

  try {
    const scope = parseModelScope(body.scope_kind ?? "global", body.scope_id ?? null);
    if (scope.kind === "exact") {
      return NextResponse.json({ error: "Exact configuration belongs in entity Settings." }, { status: 422 });
    }
    const tested = await testTomeModel(body.model);
    if (!tested.ok) {
      return NextResponse.json(
        { error: `Model test failed: ${"error" in tested ? tested.error : "unknown error"}`, code: "MODEL_TEST_FAILED" },
        { status: 422 },
      );
    }
    const doc = await updateModelConfig(
      scope,
      role as AgentRole,
      body.model,
      session.user.email ?? null,
      new Date().toISOString(),
    );
    return NextResponse.json({ config: doc });
  } catch (err) {
    if (err instanceof ModelConfigValidationFailure) {
      return NextResponse.json({ error: "Validation failed", errors: err.errors }, { status: 422 });
    }
    throw err;
  }
}
