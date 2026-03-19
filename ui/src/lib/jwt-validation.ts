/**
 * Bearer JWT validation via OIDC/JWKS discovery.
 *
 * Uses the same env vars as the Python backend:
 *   OIDC_ISSUER, OIDC_DISCOVERY_URL, OIDC_CLIENT_ID
 *
 * In dev mode (OIDC_ISSUER not set), validation is bypassed and a
 * fallback identity is returned.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface JWTIdentity {
  email: string;
  name: string;
  groups: string[];
}

let _cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let _cachedJWKSUri: string | null = null;

/**
 * Fetch the JWKS URI from OIDC discovery and cache the keyset.
 */
async function getJWKS(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const issuer = process.env.OIDC_ISSUER!;
  const discoveryUrl =
    process.env.OIDC_DISCOVERY_URL ||
    `${issuer}/.well-known/openid-configuration`;

  // Re-use cached keyset if discovery URL hasn't changed
  if (_cachedJWKS && _cachedJWKSUri === discoveryUrl) {
    return _cachedJWKS;
  }

  const res = await fetch(discoveryUrl, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
  }
  const config = await res.json();
  const jwksUri: string = config.jwks_uri;
  if (!jwksUri) {
    throw new Error('OIDC discovery response missing jwks_uri');
  }

  _cachedJWKS = createRemoteJWKSet(new URL(jwksUri));
  _cachedJWKSUri = discoveryUrl;
  return _cachedJWKS;
}

/**
 * Validate a Bearer JWT token against the OIDC provider's JWKS.
 *
 * When `OIDC_ISSUER` is not set (dev mode), returns a fallback identity
 * without validation.
 *
 * @throws Error if the token is invalid or expired
 */
export async function validateBearerJWT(
  token: string,
): Promise<JWTIdentity> {
  const issuer = process.env.OIDC_ISSUER;

  // Dev mode bypass — no OIDC configured
  if (!issuer) {
    return { email: 'bearer@local', name: 'Bearer User', groups: [] };
  }

  const jwks = await getJWKS();
  const audience = process.env.OIDC_CLIENT_ID || undefined;

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
  });

  return extractIdentity(payload);
}

/**
 * Extract user identity fields from a verified JWT payload.
 */
function extractIdentity(payload: JWTPayload): JWTIdentity {
  const email =
    (payload.email as string) ||
    (payload.preferred_username as string) ||
    (payload.sub as string) ||
    'unknown';

  const name =
    (payload.name as string) ||
    (payload.fullname as string) ||
    email;

  // Groups may appear in various claims
  let groups: string[] = [];
  for (const claim of ['groups', 'members', 'memberOf', 'roles', 'cognito:groups']) {
    const val = payload[claim];
    if (Array.isArray(val)) {
      groups = val.map(String);
      break;
    }
    if (typeof val === 'string') {
      groups = val.split(/[,\s]+/).filter(Boolean);
      break;
    }
  }

  return { email, name, groups };
}

/**
 * Reset the cached JWKS (for testing).
 */
export function _resetJWKSCache(): void {
  _cachedJWKS = null;
  _cachedJWKSUri = null;
}
