// assisted-by claude code claude-opus-4-8
//
// POST   /api/admin/authz/grants  — grant a capability to a grantee on a resource
// DELETE /api/admin/authz/grants  — revoke it
//
// Admin-gated (admin_ui / audit.view) PLUS per-resource meta-authz: the caller
// must be able to `manage` the resource (org admins pass via the bypass).
// Body: { resource:{type,id}, grantee:{type,id?}, capability }

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-config";
import { requireRbacPermission, withErrorHandler, ApiError } from "@/lib/api-middleware";
import { grant, revoke } from "@/lib/authz";
import { HttpAuthzError, parseGrantIntent, requireManage } from "@/lib/authz/http";

async function handle(request: NextRequest, op: "grant" | "revoke"): Promise<NextResponse> {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    sub?: string;
    org?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) throw new ApiError("Unauthorized", 401);
  if (!session.sub) throw new ApiError("A stable subject is required", 401, "NO_SUBJECT");

  await requireRbacPermission(
    {
      accessToken: session.accessToken,
      sub: session.sub,
      org: session.org,
      user: { email: session.user.email ?? undefined },
    },
    "admin_ui",
    "audit.view",
  );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("Request body must be valid JSON", 400, "VALIDATION_ERROR");
  }

  const caller = { type: "user" as const, id: session.sub };
  const ctx = { tenantId: session.org };
  try {
    const intent = parseGrantIntent(body);
    await requireManage(caller, intent.resource, ctx); // meta-authz: caller must manage the resource
    if (op === "grant") {
      await grant(intent, ctx);
    } else {
      await revoke(intent, ctx);
    }
    return NextResponse.json(
      op === "grant" ? { granted: true } : { revoked: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof HttpAuthzError) throw new ApiError(err.message, err.status, err.code);
    throw err;
  }
}

export const POST = withErrorHandler((request: NextRequest) => handle(request, "grant"));
export const DELETE = withErrorHandler((request: NextRequest) => handle(request, "revoke"));
