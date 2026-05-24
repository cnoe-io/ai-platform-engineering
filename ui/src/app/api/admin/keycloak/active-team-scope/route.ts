/**
 * `POST /api/admin/keycloak/active-team-scope`
 *
 * Heals the audience-cardinality drift that fails the
 * `audience.<client>.single_team_default` Keycloak invariant. The
 * underlying primitive is `selectAgentGatewayActiveTeamScope(slug)` in
 * `keycloak-admin.ts`, which unbinds every stray `team-*` default scope
 * from the OBO audience client and re-binds only `team-<slug>` as
 * default. Without this, mapper-order non-determinism during RFC 8693
 * token exchange causes the bot to receive a wrong `active_team` claim
 * at random, which the bot's mismatch check rejects.
 *
 * Request body:
 *   { "team_slug": "platform" }
 *
 * Response:
 *   { "active_team_slug": "platform", "audience_client_id": "caipe-platform" }
 *
 * Auth: admin_ui : admin (same gate as the Keycloak migration health
 * panel that triggers this button). Slug validation runs inside
 * `selectAgentGatewayActiveTeamScope` and throws on bad input so this
 * route does NOT have to recapitulate the regex.
 */

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import {
  BOT_OBO_AUDIENCE_CLIENT_ID,
  selectAgentGatewayActiveTeamScope,
} from "@/lib/rbac/keycloak-admin";

import { requireMigrationAdmin } from "../../rebac/migrations/_lib";

interface ActiveTeamScopeRequest {
  team_slug?: unknown;
}

function badRequest(message: string, code: string): never {
  const error = new Error(message) as Error & {
    statusCode?: number;
    code?: string;
  };
  error.statusCode = 400;
  error.code = code;
  throw error;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user } = await requireMigrationAdmin(request);
  const body = (await request.json().catch(() => ({}))) as ActiveTeamScopeRequest;

  if (typeof body.team_slug !== "string" || body.team_slug.trim().length === 0) {
    badRequest(
      "team_slug is required and must be a non-empty string",
      "ACTIVE_TEAM_SCOPE_TEAM_SLUG_REQUIRED",
    );
  }
  const slug = (body.team_slug as string).trim().toLowerCase();

  // Structured one-line audit record: actor + action + target. The
  // logging infrastructure in this codebase is intentionally minimal;
  // a single deliberate audit line per privileged mutation is the
  // pattern used elsewhere in the admin BFF.
  console.log(
    JSON.stringify({
      event: "admin.keycloak.active_team_scope.reconcile",
      actor: user.email,
      team_slug: slug,
      audience_client_id: BOT_OBO_AUDIENCE_CLIENT_ID,
    }),
  );

  // Throws on invalid slug or missing realm objects — `withErrorHandler`
  // converts that into a structured 4xx/5xx response.
  await selectAgentGatewayActiveTeamScope(slug);

  return successResponse({
    active_team_slug: slug,
    audience_client_id: BOT_OBO_AUDIENCE_CLIENT_ID,
  });
});
