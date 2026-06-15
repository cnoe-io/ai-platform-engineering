/**
 * GET /api/admin/service-accounts/unlinked
 *
 * Platform-admin-gated resolver: returns the unlinked service account's
 * id, sa_sub, name, and current scopes snapshot so the client can open the
 * Unlinked Access modal without knowing the SA's id ahead of time.
 *
 * Auth gate: `check(user:<caller>, can_manage, organization:<key>)` — i.e.
 * org-admin. Mirrors the guard used by admin-tab-gates/route.ts. Bootstrap-
 * admin email is also accepted (break-glass parity).
 *
 * Response shape: { success, data: { id, sa_sub, name, scopes } }
 * where `scopes` is the Mongo display snapshot (cheap read; authoritative
 * scopes are fetched per-SA via the existing /[id] detail route when editing).
 *
 * 403 for non-admins. 404 when the unlinked SA has not been bootstrapped yet.
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getUnlinkedServiceAccount } from "@/lib/rbac/unlinked-service-account";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import type { ScopeRef } from "@/lib/service-account-scopes";
import type { ServiceAccountScope } from "@/types/mongodb";

export async function GET() {
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email || !session.sub) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Platform-admin gate (org-admin + bootstrap-admin break-glass).
  const admin = await isPlatformAdmin(session);
  if (!admin) {
    return NextResponse.json(
      { success: false, error: "Forbidden: platform admin access required" },
      { status: 403 },
    );
  }

  try {
    const sa = await getUnlinkedServiceAccount();
    if (!sa) {
      return NextResponse.json(
        { success: false, error: "Unlinked service account not found or not yet bootstrapped" },
        { status: 404 },
      );
    }

    const scopes: ScopeRef[] = (sa.scopes_snapshot ?? []).map((s: ServiceAccountScope) => ({
      type: s.type,
      ref: s.ref,
    }));

    return NextResponse.json({
      success: true,
      data: {
        id: sa.sa_sub,
        name: sa.name,
        scopes,
      },
    });
  } catch (error) {
    console.error("[service-accounts/unlinked] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load unlinked service account" },
      { status: 503 },
    );
  }
}
