import { NextRequest } from "next/server";
import crypto from "crypto";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { getRealmUserById, mergeUserAttributes } from "@/lib/rbac/keycloak-admin";

const NONCE_TTL_MS = 10 * 60 * 1000;

function readSlackId(attrs: unknown): string | undefined {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return undefined;
  const a = attrs as Record<string, string[]>;
  return a.slack_user_id?.[0]?.trim() || undefined;
}

export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const params = await context.params;
  const keycloakUserId = decodeURIComponent(params.id);

  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);

    const kcUser = await getRealmUserById(keycloakUserId);
    const slackUserId = readSlackId(kcUser.attributes);
    if (!slackUserId) {
      throw new ApiError("User has no Slack ID to re-link", 400);
    }

    const nonce = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    const coll = await getCollection("slack_link_nonces");
    await coll.insertOne({
      nonce,
      slack_user_id: slackUserId,
      expires_at: expiresAt,
      created_by: user.email,
      created_at: new Date(),
    });

    const base = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
    const relinkUrl = `${base}/api/auth/slack-link?nonce=${encodeURIComponent(nonce)}`;

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
