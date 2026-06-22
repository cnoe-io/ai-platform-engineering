import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import {
  getServiceAccountTokenUrl,
  regenerateClientSecret,
} from "@/lib/rbac/keycloak-admin";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import { getBySub } from "@/lib/service-accounts";

/**
 * POST /api/admin/service-accounts/[id]/rotate
 *
 * Rotate the credential (US4; FR-017/019). `[id]` is the SA's OpenFGA subject
 * id (`sa_sub`). Gated by can_manage. Regenerates the Keycloak client secret
 * (the old secret stops working immediately) and returns the NEW secret ONCE.
 * Scopes are unchanged (FR-019) — no OpenFGA/Mongo scope writes here.
 *
 * Response 200: { success, data: { credential: { client_id, client_secret, token_url } } }
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email || !session.sub) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing service account id" },
      { status: 400 },
    );
  }

  try {
    const canManage = await checkOpenFgaTuple({
      user: `user:${session.sub}`,
      relation: "can_manage",
      object: `service_account:${id}`,
    });
    if (!canManage.allowed) {
      // 404 to non-managers (don't reveal existence).
      return NextResponse.json(
        { success: false, error: "Service account not found" },
        { status: 404 },
      );
    }

    const doc = await getBySub(id);
    if (!doc || doc.status === "revoked") {
      return NextResponse.json(
        { success: false, error: "Service account not found" },
        { status: 404 },
      );
    }

    const newSecret = await regenerateClientSecret(doc.client_uuid);

    logOpenFgaRebacAuditEvent({
      sub: session.sub,
      operation: "service_account.rotate",
      scope: "admin",
      resourceRef: `service_account:${id}`,
      email: session.user.email ?? undefined,
      correlationId: `service_account.rotate:${id}`,
    });

    // New secret returned ONCE (FR-005/017).
    return NextResponse.json({
      success: true,
      data: {
        credential: {
          client_id: doc.client_id,
          client_secret: newSecret,
          token_url: getServiceAccountTokenUrl(),
        },
      },
    });
  } catch (error) {
    console.error("[service-accounts:rotate] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to rotate credential" },
      { status: 503 },
    );
  }
}
