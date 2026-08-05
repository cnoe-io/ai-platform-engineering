import { NextResponse, type NextRequest } from "next/server";

import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

/**
 * The browser-facing origin of this app. Behind a proxy, `request.url` reflects
 * the internal bind address (e.g. 0.0.0.0:3000), so prefer an explicit public
 * base (NEXTAUTH_URL) and fall back to forwarded headers, then the request.
 */
function publicOrigin(request: NextRequest): string {
  const env = process.env.TOME_PUBLIC_ORIGIN || process.env.NEXTAUTH_URL;
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      /* fall through */
    }
  }
  const host = request.headers.get("x-forwarded-host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the Tome MCP endpoint.
 *
 * MCP clients (e.g. Claude Code) fetch this to discover which authorization
 * server protects `/api/tome/mcp`, then run the OAuth/PKCE flow against it.
 * We advertise the CAIPE Keycloak realm as the authorization server; Keycloak
 * already serves RFC 8414 metadata at its `/.well-known/openid-configuration`.
 *
 * The public-facing issuer must be browser-reachable, so it is taken from
 * `TOME_MCP_OAUTH_ISSUER` (falling back to `OIDC_ISSUER`) rather than the
 * in-cluster discovery URL.
 */
export function GET(request: NextRequest) {
  if (!isTomeServerEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const issuer = (
    process.env.TOME_MCP_OAUTH_ISSUER ||
    process.env.OIDC_ISSUER ||
    ""
  ).replace(/\/$/, "");

  const origin = publicOrigin(request);

  return NextResponse.json(
    {
      resource: `${origin}/api/tome/mcp`,
      authorization_servers: issuer ? [issuer] : [],
      bearer_methods_supported: ["header"],
      scopes_supported: [
        "openid",
        "profile",
        "email",
        "roles",
        "groups",
        "org",
        "offline_access",
      ],
    },
    {
      // Public discovery document; allow cross-origin reads and brief caching.
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
