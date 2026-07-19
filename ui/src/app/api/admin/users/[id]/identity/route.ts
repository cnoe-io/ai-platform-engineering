// GET /api/admin/users/[id]/identity
//
// Slow Keycloak sub-calls (sessions + federated identities) split out of the
// main GET /api/admin/users/[id] so the profile header and team picker render
// immediately while this fetches in the background for the "Identity & account"
// section at the bottom of the modal.

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  getUserFederatedIdentities,
  getUserSessions,
} from "@/lib/rbac/keycloak-admin";
import { requireAdminSimulationUserProfileRead } from "@/lib/rbac/admin-simulation-server";
import { type NextRequest } from "next/server";

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { session } = await getAuthFromBearerOrSession(request);
    const { id } = await context.params;
    await requireAdminSimulationUserProfileRead(
      new URL(request.url).searchParams,
      session,
      id,
    );

    const [sessions, federatedIdentities] = await Promise.all([
      getUserSessions(id),
      getUserFederatedIdentities(id),
    ]);

    const lastAccess = sessions.reduce((max, s) => {
      const t = s.lastAccess ?? s.start ?? 0;
      return t > max ? t : max;
    }, 0);

    return successResponse({
      sessions,
      federatedIdentities,
      lastAccess: lastAccess > 0 ? lastAccess : null,
    });
  }
);
