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

  // Determine the owner type for subject-keyed lookup: Keycloak service-account
  // tokens carry `preferred_username = "service-account-<clientId>"` and have
  // identity.isServiceAccount === true (see jwt-validation.ts:247).
  const ownerType = identity.isServiceAccount === true ? "service_account" : "user";

  const service = await getProviderConnectionService();
  const connection = providerConnectionId
    ? await service.getConnection(providerConnectionId)
    : (await service.listConnections({ type: ownerType, id: identity.sub })).find(
        (candidate) => candidate.provider === provider && candidate.status === "connected",
      );
  if (!connection) {
    throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
  }
  // Owner guard: the connection must belong to the calling subject. An SA caller
  // must own a service_account-typed connection; a user caller must own a
  // user-typed connection. If the types/ids differ the caller is fetching
  // another principal's connection — require explicit `use` permission instead.
  const callerOwnsConnection =
    connection.owner.type === ownerType && connection.owner.id === identity.sub;
  if (!callerOwnsConnection) {
    await requireResourcePermission(
      { sub: identity.sub, user: { email: identity.email } },
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
