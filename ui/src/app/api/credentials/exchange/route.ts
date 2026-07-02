// assisted-by Codex Codex-sonnet-4-6
import { NextRequest } from "next/server";

import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { assertCredentialServiceCaller } from "@/lib/credentials/internal-caller";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { validateBearerJWT } from "@/lib/jwt-validation";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  assertCredentialServiceCaller({
    headers: request.headers,
    expectedAudience: process.env.CREDENTIAL_SERVICE_AUDIENCE || "caipe-credential-service",
  });
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const identity = await validateBearerJWT(bearer);

  const body = (await request.json()) as Record<string, unknown>;
  const providerConnectionId =
    typeof body.provider_connection_id === "string" ? body.provider_connection_id.trim() : "";
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (!providerConnectionId && !provider) {
    throw new ApiError("provider_connection_id or provider is required", 400, "VALIDATION_ERROR");
  }

  const ownerType = identity.isServiceAccount === true ? "service_account" : "user";

  const service = await getProviderConnectionService();
  // Two resolution paths:
  //   - provider key  → resolve the CALLER's OWN connection for that provider.
  //     This is how caller-scoped MCP credential sources resolve per user/SA.
  //   - connection id → fetch that specific connection. Cross-owner access is
  //     gated below by an explicit OpenFGA `secret_ref:provider_connection:<id>#use`
  //     grant (the service-account delegation path). This is NOT the removed
  //     "pinned"/all-callers impersonation scope — that lived in the credential
  //     SOURCE config and is gone; a caller can only reach another principal's
  //     connection here with a deliberate per-connection grant.
  const connection = providerConnectionId
    ? await service.getConnection(providerConnectionId)
    : (await service.listConnections({ type: ownerType, id: identity.sub })).find(
        (candidate) => candidate.provider === provider && candidate.status === "connected",
      );
  if (!connection || connection.status !== "connected") {
    throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
  }

  // Owned-by-caller connections need no extra grant. For any other owner, require
  // an explicit per-connection `use` permission (defense in depth + SA delegation).
  const callerOwnsConnection =
    connection.owner.type === ownerType && connection.owner.id === identity.sub;
  if (!callerOwnsConnection) {
    await requireResourcePermission(
      { sub: identity.sub, user: { email: identity.email }, isServiceAccount: identity.isServiceAccount },
      { type: "secret_ref", id: `provider_connection:${connection.id}`, action: "use" },
    );
  }
  const token = await service.refreshConnection(connection.id);

  return successResponse({
    provider: connection.provider,
    provider_connection_id: connection.id,
    access_token: token.accessToken,
    expires_in: token.expiresIn,
  });
});
