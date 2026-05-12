import { NextRequest } from "next/server";
import crypto from "crypto";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { getRealmUserById, mergeUserAttributes } from "@/lib/rbac/keycloak-admin";

const HMAC_TTL_SECONDS = 600;

function readSlackId(attrs: unknown): string | undefined {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return undefined;
  const a = attrs as Record<string, string[]>;
  return a.slack_user_id?.[0]?.trim() || undefined;
}

function generateHmacUrl(slackUserId: string): { url: string; expiresAt: Date } {
  const secret = process.env.SLACK_LINK_HMAC_SECRET?.trim()
    || process.env.SLACK_SIGNING_SECRET?.trim()
    || "";
  if (!secret) throw new ApiError("HMAC secret not configured", 500);

  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${slackUserId}:${ts}`)
    .digest("hex");

  const base = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const url = `${base}/api/auth/slack-link?slack_user_id=${encodeURIComponent(slackUserId)}&ts=${ts}&sig=${sig}`;
  const expiresAt = new Date((ts + HMAC_TTL_SECONDS) * 1000);
  return { url, expiresAt };
}

export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const params = await context.params;
  const keycloakUserId = decodeURIComponent(params.id);

  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const kcUser = await getRealmUserById(keycloakUserId);
    const slackUserId = readSlackId(kcUser.attributes);
    if (!slackUserId) {
      throw new ApiError("User has no Slack ID to re-link", 400);
    }

    const { url: relinkUrl, expiresAt } = generateHmacUrl(slackUserId);

    return successResponse({
      relink_url: relinkUrl,
      slack_user_id: slackUserId,
      expires_at: expiresAt.toISOString(),
      message:
        "Share this URL with the Slack user; they must open it while signed into CAIPE with their own account.",
    });
  });
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const params = await context.params;
  const keycloakUserId = decodeURIComponent(params.id);

  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    await mergeUserAttributes(keycloakUserId, { slack_user_id: undefined });
    return successResponse({ revoked: true, keycloak_user_id: keycloakUserId });
  });
});
