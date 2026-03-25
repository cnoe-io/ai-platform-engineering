import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getEffectivePermissions } from "@/lib/rbac/keycloak-authz";
import type { PermissionsMap } from "@/lib/rbac/types";

/**
 * GET /api/rbac/permissions
 *
 * Returns the calling user's effective permissions from Keycloak AuthZ.
 * Used by the `useRbacPermissions` hook to drive capability-based UI
 * rendering (US2, FR-004).
 *
 * Response: { permissions: { [resource]: [scope, ...] } }
 */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const permissions: PermissionsMap = await getEffectivePermissions(
      session.accessToken
    );

    return NextResponse.json({ permissions });
  } catch {
    return NextResponse.json(
      { error: "Failed to retrieve permissions" },
      { status: 503 }
    );
  }
}
