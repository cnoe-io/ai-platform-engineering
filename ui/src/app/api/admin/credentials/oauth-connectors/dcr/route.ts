import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { registerMcpDcrConnector } from "@/lib/credentials/mcp-dcr";
import { getOAuthConnectorService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

function defaultRedirectUri(provider: string): string {
  const base = process.env.NEXTAUTH_URL?.trim();
  if (!base) {
    throw new ApiError(
      "NEXTAUTH_URL is required for MCP dynamic client registration",
      500,
      "MCP_DCR_CALLBACK_UNAVAILABLE",
    );
  }
  return `${base.replace(/\/$/, "")}/api/credentials/oauth/${encodeURIComponent(provider)}/callback`;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  const body = (await request.json()) as Record<string, unknown>;
  const provider = String(body.provider ?? "").trim();
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.map(String).map((scope) => scope.trim()).filter(Boolean)
    : undefined;
  const connector = await registerMcpDcrConnector({
    input: {
      name: String(body.name ?? ""),
      provider,
      mcpUrl: String(body.mcpUrl ?? ""),
      redirectUri: String(body.redirectUri ?? "").trim() || defaultRedirectUri(provider),
      ...(scopes && scopes.length > 0 ? { scopes } : {}),
    },
    connectorService: await getOAuthConnectorService(),
  });
  return successResponse(connector, 201);
});
