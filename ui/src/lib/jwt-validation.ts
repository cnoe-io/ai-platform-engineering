/**
 * Bearer JWT validation via OIDC/JWKS discovery.
 *
 * Uses the same env vars as the Python backend:
 *   OIDC_ISSUER, OIDC_DISCOVERY_URL, OIDC_CLIENT_ID
 *
 * Additional JWKS endpoints can be configured for service clients
 * (e.g. Slack bot using a separate OIDC app for client credentials):
 *   OIDC_ADDITIONAL_JWKS — comma-separated JWKS URLs
 *
 * In dev mode (OIDC_ISSUER not set), validation is bypassed and a
 * fallback identity is returned.
 */

import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload, errors as joseErrors } from 'jose';

export interface JWTIdentity {
  email: string;
  name: string;
  groups: string[];
}

let _cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let _cachedJWKSUri: string | null = null;

// Cache for additional JWKS endpoints (keyed by URL)
const _additionalJWKSCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

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
 * Get cached JWKS keysets for additional JWKS URLs.
 *
 * Parses ``OIDC_ADDITIONAL_JWKS`` (comma-separated JWKS URLs) and returns
 * a cached ``createRemoteJWKSet`` for each.  These are used as fallbacks
 * when the primary OIDC JWKS doesn't contain a matching key — e.g. for
 * service clients using a separate OIDC app for client credentials.
 */
function getAdditionalJWKSets(): ReturnType<typeof createRemoteJWKSet>[] {
  const raw = process.env.OIDC_ADDITIONAL_JWKS;
  if (!raw) return [];

  const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
  return urls.map((url) => {
    let jwks = _additionalJWKSCache.get(url);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(url));
      _additionalJWKSCache.set(url, jwks);
    }
    return jwks;
  });
}

/**
 * Validate a Bearer JWT token against the OIDC provider's JWKS.
 *
 * Tries the primary OIDC JWKS first (with issuer and audience checks).
 * If the token's signing key is not found in the primary JWKS, falls back
 * to any additional JWKS endpoints configured via ``OIDC_ADDITIONAL_JWKS``
 * (signature validation only — the trust anchor is the JWKS URL itself,
 * configured by the admin).
 *
 * When `OIDC_ISSUER` is not set (dev mode), throws an error.
 *
 * @throws Error if the token is invalid, expired, or no matching key is found
 */
export async function validateBearerJWT(
  token: string,
): Promise<JWTIdentity> {
  const issuer = process.env.OIDC_ISSUER;

  if (!issuer) {
    throw new Error('OIDC_ISSUER is not configured — Bearer JWT validation is unavailable');
  }

  const jwks = await getJWKS();
  const audience = process.env.OIDC_CLIENT_ID || undefined;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
    });
    console.log(`[jwt] Validated via primary JWKS (iss=${issuer})`);
    return extractIdentity(payload);
  } catch (primaryError) {
    // Only fall back to additional JWKS on key-not-found errors.
    // Expiry, audience mismatch, etc. should fail immediately.
    const message = primaryError instanceof Error ? primaryError.message : '';
    if (!message.includes('no applicable key found')) {
      throw primaryError;
    }

    // Try each additional JWKS (signature-only, no iss/aud checks)
    const additionalSets = getAdditionalJWKSets();
    const additionalUrls = (process.env.OIDC_ADDITIONAL_JWKS || '').split(',').map((u) => u.trim()).filter(Boolean);
    for (let i = 0; i < additionalSets.length; i++) {
      try {
        const { payload } = await jwtVerify(token, additionalSets[i]);
        console.log(`[jwt] Validated via additional JWKS (${additionalUrls[i]})`);
        return extractIdentity(payload);
      } catch {
        // This keyset didn't match either — try the next one
      }
    }

    // No keyset matched
    throw primaryError;
  }
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
  _additionalJWKSCache.clear();
}

// ============================================================================
// Local Skills API Token (HS256 signed with NEXTAUTH_SECRET)
// ============================================================================

const MAX_EXPIRY_DAYS = 90;

/**
 * Get the HS256 signing key derived from NEXTAUTH_SECRET.
 */
function getLocalSigningKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is not configured');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Parse an expiry string like "30d", "60d", "90d" into seconds,
 * clamped to MAX_EXPIRY_DAYS.
 */
function parseExpiry(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid expiresIn format: "${expiresIn}" (expected e.g. "90d")`);
  }
  const days = Math.min(parseInt(match[1], 10), MAX_EXPIRY_DAYS);
  return days * 86400;
}

/**
 * Sign a local skills API token (HS256 JWT).
 *
 * The token is scoped to `skills:read` and always gets `role: 'user'`.
 *
 * @param email  User email (becomes `sub` claim)
 * @param name   User display name
 * @param expiresIn  Validity period, e.g. "30d", "60d", "90d" (default "90d", max 90d)
 * @returns Signed JWT string
 */
export async function signLocalSkillsToken(
  email: string,
  name: string,
  expiresIn: string = '90d',
): Promise<string> {
  const key = getLocalSigningKey();
  const expSeconds = parseExpiry(expiresIn);

  return new SignJWT({
    email,
    name,
    type: 'skills_api_key',
    scope: 'skills:read',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(key);
}

/**
 * Validate a local skills API token.
 *
 * @returns JWTIdentity if the token is a valid local skills token, or null if
 *          it is not a local token (so the caller should fall through to OIDC).
 * @throws  Error if the token IS a local skills token but is expired.
 */
export async function validateLocalSkillsJWT(
  token: string,
): Promise<JWTIdentity | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return null; // No secret configured — cannot be a local token
  }

  const key = new TextEncoder().encode(secret);

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });

    // Only accept tokens explicitly marked as local skills tokens
    if (payload.type !== 'skills_api_key') {
      return null;
    }

    const email =
      (payload.email as string) ||
      (payload.sub as string) ||
      'unknown';

    const name = (payload.name as string) || email;

    return { email, name, groups: [] };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      // It IS a local token, but expired — don't fall through to OIDC
      throw new Error('Skills API token has expired. Please generate a new one.');
    }
    // Signature mismatch or other error — not a local token, fall through
    return null;
  }
}
