// assisted-by Codex Codex-sonnet-4-6
//
// POST   /api/admin/authz/grants  — grant a capability to a grantee on a resource
// DELETE /api/admin/authz/grants  — revoke it
//
// Auth: authenticated session with a stable subject + per-resource meta-authz
// (caller must hold `manage` on the resource; org admins bypass via CAS).
// No admin_ui/audit.view prerequisite — resource managers can grant without
// needing admin-console access. For admin-UI consumers use this endpoint;
// for product sharing flows use /api/authz/v1/grants (same auth, versioned).
// Body: { resource:{type,id}, grantee:{type,id?}, capability }

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-config";
import { withErrorHandler, ApiError } from "@/lib/api-middleware";
import { grant, revoke } from "@/lib/authz";
import { HttpAuthzError, decisionContext, parseGrantIntent, requireManage } from "@/lib/authz/http";

async function handle(request: NextRequest, op: "grant" | "revoke"): Promise<NextResponse> {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    sub?: string;
    org?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) throw new ApiError("Unauthorized", 401);
  if (!session.sub) throw new ApiError("A stable subject is required", 401, "NO_SUBJECT");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("Request body must be valid JSON", 400, "VALIDATION_ERROR");
  }

  const caller = { type: "user" as const, id: session.sub };
  const ctx = decisionContext(session, caller, request);
  try {
    const intent = parseGrantIntent(body);
    await requireManage(caller, intent.resource, ctx, { operation: op, intent });
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
