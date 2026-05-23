import { NextRequest } from "next/server";
import {
  withErrorHandler,
  successResponse,
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";
import { getRealmUserById, mergeUserAttributes } from "@/lib/rbac/keycloak-admin";
import { createWebexLinkNonce } from "@/lib/rbac/webex-link-nonce";

function readWebexId(attrs: unknown): string | undefined {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return undefined;
  const a = attrs as Record<string, string[]>;
  return a.webex_user_id?.[0]?.trim() || undefined;
}

export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const params = await context.params;
    const keycloakUserId = decodeURIComponent(params.id);

    const { session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

    const kcUser = await getRealmUserById(keycloakUserId);
    const webexUserId = readWebexId(kcUser.attributes);
    if (!webexUserId) {
      throw new ApiError("User has no Webex ID to re-link", 400);
    }

    const { nonce, expiresAt } = await createWebexLinkNonce(webexUserId);
    const base = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
    const relinkUrl = `${base}/api/auth/webex-link?webex_user_id=${encodeURIComponent(webexUserId)}&nonce=${encodeURIComponent(nonce)}`;

    return successResponse({
      relink_url: relinkUrl,
      webex_user_id: webexUserId,
      expires_at: expiresAt.toISOString(),
      message:
        "Share this URL with the Webex user; they must open it while signed into CAIPE with their own account.",
    });
  }
);

export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const params = await context.params;
    const keycloakUserId = decodeURIComponent(params.id);

    const { session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "admin_ui", "admin");

    await mergeUserAttributes(keycloakUserId, { webex_user_id: undefined });
    return successResponse({ revoked: true, keycloak_user_id: keycloakUserId });
  }
);
