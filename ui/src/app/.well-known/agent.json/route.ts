/**
 * GET /.well-known/agent.json
 *
 * CAIPE CLI discovery endpoint (FR-023). Returns OAuth endpoint URLs and the
 * caipe-cli public client ID so the CLI can perform PKCE login without
 * hardcoded paths and without knowing which IdP is behind the platform.
 *
 * Derived from OIDC_ISSUER (the public-facing Keycloak realm URL). All fields
 * are optional — the CLI falls back to /oauth/* conventional paths when absent.
 *
 * Schema: { oauth: { authorization_endpoint, token_endpoint,
 *                     device_authorization_endpoint, client_id, scopes } }
 */
// assisted-by claude code claude-sonnet-4-6

import { type NextRequest, NextResponse } from "next/server";

const CLI_CLIENT_ID = process.env.CAIPE_CLI_CLIENT_ID ?? "caipe-cli";

export async function GET(_req: NextRequest) {
  const issuer = (process.env.OIDC_ISSUER ?? "").replace(/\/$/, "");

  if (!issuer) {
    return NextResponse.json(
      { error: "OIDC_ISSUER not configured" },
      { status: 503 },
    );
  }

  const body = {
    oauth: {
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${issuer}/protocol/openid-connect/token`,
      device_authorization_endpoint: `${issuer}/protocol/openid-connect/auth/device`,
      client_id: CLI_CLIENT_ID,
      scopes: ["openid", "profile", "email"],
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
