/**
 * GET /oauth/authorize
 *
 * Fallback proxy: redirects the browser to Keycloak's authorization endpoint.
 * Used by the CAIPE CLI when /.well-known/agent.json discovery is unavailable.
 * Passes all query parameters through unchanged (response_type, client_id,
 * redirect_uri, code_challenge, code_challenge_method, state, scope, etc.).
 */
// assisted-by claude code claude-sonnet-4-6

import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const issuer = (process.env.OIDC_ISSUER ?? "").replace(/\/$/, "");
  if (!issuer) {
    return NextResponse.json({ error: "OIDC_ISSUER not configured" }, { status: 503 });
  }

  const upstream = new URL(`${issuer}/protocol/openid-connect/auth`);
  req.nextUrl.searchParams.forEach((value, key) => {
    upstream.searchParams.set(key, value);
  });

  return NextResponse.redirect(upstream.toString(), 302);
}
