/**
 * POST /oauth/device/code
 *
 * Fallback proxy: forwards Device Authorization Grant requests (RFC 8628) to
 * Keycloak's device authorization endpoint.
 * Used by the CAIPE CLI (`caipe auth login --device`) when
 * /.well-known/agent.json discovery is unavailable.
 */
// assisted-by claude code claude-sonnet-4-6

import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const issuer = (process.env.OIDC_ISSUER ?? "").replace(/\/$/, "");
  if (!issuer) {
    return NextResponse.json({ error: "OIDC_ISSUER not configured" }, { status: 503 });
  }

  const body = await req.text();
  const upstream = `${issuer}/protocol/openid-connect/auth/device`;

  const res = await fetch(upstream, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}
