// assisted-by Codex Codex-sonnet-4-6
// GET /api/admin/realm/identity-providers
//
// First-party realm IdP summary used by the Slack bot. The bot holds only its
// own service-account token; Keycloak Admin access stays in the BFF.

import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { listIdpAliases } from "@/lib/rbac/keycloak-admin";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

const USER_DIRECTORY_SURFACE_ID = "user_directory";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

  await requireResourcePermission(
    session,
    { type: "admin_surface", id: USER_DIRECTORY_SURFACE_ID, action: "read" },
    { bypassForOrgAdmin: true }
  );

  const identityProviders = (await listIdpAliases()).filter((idp) => idp.alias);

  return successResponse({
    hasEnabledBroker: identityProviders.some((idp) => idp.enabled !== false),
    identityProviders,
  });
});
