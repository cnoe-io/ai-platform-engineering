/**
 * GET /api/integrations/unlinked-service-account
 *
 * Internal endpoint used by first-party service callers (notably the Slack bot)
 * to discover the platform unlinked service account's `sa_sub` without
 * direct Mongo access.
 *
 * Auth: any authenticated caller is accepted — a valid Bearer token (e.g. the
 * Slack bot's service-account JWT) OR a valid NextAuth session. No org-admin
 * gate: this endpoint intentionally exposes only the SA's subject id, which is
 * not a credential and is needed by callers long before they can be org-admins.
 *
 * Response shape:
 *   { success: true, data: { sa_sub: string | null } }
 *
 *   sa_sub is null when the SA has not been bootstrapped yet.
 *   NEVER returns secret material (client_secret, client_uuid, etc.).
 *
 * 401 when there is no authenticated caller.
 *
 * Contract (PRC-4): the Python slack-bot's service_account_resolver module
 * calls this endpoint with its SA Bearer token to look up the unlinked SA sub.
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { getUnlinkedServiceAccount } from "@/lib/rbac/unlinked-service-account";

export async function GET(request: NextRequest) {
  // Auth: require any authenticated caller (bearer or session).
  // getAuthFromBearerOrSession throws ApiError(401) when unauthenticated.
  try {
    await getAuthFromBearerOrSession(request);
  } catch {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const sa = await getUnlinkedServiceAccount();
    return NextResponse.json({
      success: true,
      data: {
        sa_sub: sa?.sa_sub ?? null,
      },
    });
  } catch (error) {
    console.error("[integrations/unlinked-service-account] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to resolve unlinked service account" },
      { status: 503 },
    );
  }
}
