import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { assertCredentialServiceCaller } from "@/lib/credentials/internal-caller";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { validateBearerJWT } from "@/lib/jwt-validation";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  assertFeatureEnabled();
  const caller = assertCredentialServiceCaller({
    headers: request.headers,
    expectedAudience: process.env.CREDENTIAL_SERVICE_AUDIENCE || "caipe-credential-service",
  });
  if (caller.callerType !== "agentgateway") {
    throw new ApiError("Credential injection is reserved for AgentGateway", 403, "FORBIDDEN");
  }

  const { provider: rawProvider } = await context.params;
  const provider = rawProvider?.trim();
  if (!provider) {
    throw new ApiError("provider is required", 400, "VALIDATION_ERROR");
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const identity = await validateBearerJWT(bearer);
  const service = await getProviderConnectionService();
  const connection = (await service.listConnections({ type: "user", id: identity.sub })).find(
    (candidate) => candidate.provider === provider && candidate.status === "connected",
  );
  if (!connection) {
    throw new ApiError("Provider connection was not found", 404, "CREDENTIAL_NOT_FOUND");
  }

  const token = await service.refreshConnection(connection.id);

  const response = successResponse({
    ok: true,
    provider: connection.provider,
    provider_connection_id: connection.id,
    expires_in: token.expiresIn,
  });
  response.headers.set("x-caipe-provider-token", token.accessToken);
  response.headers.set("x-caipe-provider-connection-id", connection.id);
  return response;
});
