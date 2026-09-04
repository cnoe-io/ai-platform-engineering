import type { NextRequest } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import {
  buildTomeOidcAuth,
  isTomeSecondaryOidcConfigured,
  validateTomeSecondaryOidcJWT,
} from "@/lib/tome/oidc-jwt";

/**
 * TOME MCP authentication accepts a JWT from an optional secondary OIDC
 * provider in addition to CAIPE's existing Keycloak, API-key, and
 * browser-session credentials. The secondary provider is attempted first
 * only here; all other API routes retain the normal Keycloak-only bearer
 * behavior.
 */
export async function getTomeAuthFromBearerOrSession(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ") && isTomeSecondaryOidcConfigured()) {
    const token = authorization.slice("Bearer ".length);
    try {
      const identity = await validateTomeSecondaryOidcJWT(token);
      return buildTomeOidcAuth(token, identity);
    } catch {
      // Dual-auth behavior: a failed secondary-provider validation may still
      // be a valid Keycloak token, handled by the existing middleware below.
    }
  }

  return getAuthFromBearerOrSession(request);
}
