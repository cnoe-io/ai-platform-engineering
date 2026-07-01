import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getOAuthConnectorService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const PATCH = withErrorHandler(async (request: NextRequest, context?: { params: Promise<{ connector_id: string }> }) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  const { connector_id: connectorId } = await context!.params;
  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const service = await getOAuthConnectorService();

  if (action === "enable" || action === "disable") {
    await service.setConnectorEnabled(connectorId, action === "enable");
    return successResponse({ id: connectorId, enabled: action === "enable" });
  }
  if (action === "test") {
    return successResponse(await service.testConnector(connectorId));
  }
  throw new ApiError("Unsupported OAuth connector action", 400, "VALIDATION_ERROR");
});

export const PUT = withErrorHandler(async (request: NextRequest, context?: { params: Promise<{ connector_id: string }> }) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  const { connector_id: connectorId } = await context!.params;
  const body = (await request.json()) as Record<string, unknown>;
  const service = await getOAuthConnectorService();
  const pkce = body.pkce === true || body.pkce === "true";
  const connector = await service.updateConnector(connectorId, {
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
  return successResponse(connector);
});

export const DELETE = withErrorHandler(async (request: NextRequest, context?: { params: Promise<{ connector_id: string }> }) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  const { connector_id: connectorId } = await context!.params;
  const service = await getOAuthConnectorService();
  await service.deleteConnector(connectorId);
  return successResponse({ id: connectorId, deleted: true });
});
