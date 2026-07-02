import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getOAuthConnectorService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { requireAdminSurfaceManage,requireBaselineAdminSurfaceRead } from "@/lib/rbac/require-openfga";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireBaselineAdminSurfaceRead(session, "credentials");
  const service = await getOAuthConnectorService();
  return successResponse(await service.listConnectors());
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  const body = (await request.json()) as Record<string, unknown>;
  const service = await getOAuthConnectorService();
  const pkce = body.pkce === true || body.pkce === "true";
  const connector = await service.createConnector({
    name: String(body.name ?? ""),
    provider: String(body.provider ?? ""),
    clientId: String(body.clientId ?? ""),
    ...(pkce ? {} : { clientSecret: String(body.clientSecret ?? "") }),
    authorizationUrl: String(body.authorizationUrl ?? ""),
    tokenUrl: String(body.tokenUrl ?? ""),
    scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
    redirectUri: String(body.redirectUri ?? ""),
    pkce,
  });

  return successResponse(connector, 201);
});
