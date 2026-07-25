/**
 * JWT claim extraction and session completeness checks.
 *
 * Keycloak often returns identity only on the access_token JWT, not id_token.
 * Stored credentials may also omit expiry until we decode the access JWT.
 */

import type { TokenSet } from "./keychain.js";

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function claimsFromJwtString(jwt: string | undefined): {
  identity?: string;
  displayName?: string;
  exp?: number;
} {
  if (!jwt) return {};
  const payload = decodeJwtPayload(jwt);
  if (!payload) return {};

  const identityRaw = payload.sub ?? payload.email;
  const displayRaw = payload.name ?? payload.preferred_username;
  const identity =
    identityRaw != null && String(identityRaw).trim() !== "" ? String(identityRaw) : undefined;
  const displayName =
    displayRaw != null && String(displayRaw).trim() !== "" ? String(displayRaw) : undefined;
  const exp = typeof payload.exp === "number" ? payload.exp : undefined;

  return { identity, displayName, exp };
}

/** Read OIDC user claims from id_token and/or access_token in a token response. */
export function claimsFromOAuthTokenResponse(body: Record<string, unknown>): {
  identity?: string;
  displayName?: string;
} {
  const idToken = typeof body.id_token === "string" ? body.id_token : undefined;
  const accessToken = typeof body.access_token === "string" ? body.access_token : undefined;

  const fromId = claimsFromJwtString(idToken);
  const fromAccess = claimsFromJwtString(accessToken);

  return {
    identity: fromId.identity ?? fromAccess.identity,
    displayName: fromId.displayName ?? fromAccess.displayName,
  };
}

/** Fill identity, displayName, and expiry from the access token JWT when missing. */
export function enrichTokenSet(tokens: TokenSet): TokenSet {
  if (!tokens.accessToken) return tokens;

  const fromJwt = claimsFromJwtString(tokens.accessToken);
  const identity = tokens.identity?.trim() || fromJwt.identity;
  const displayName = tokens.displayName?.trim() || fromJwt.displayName;

  let accessTokenExpiry = tokens.accessTokenExpiry;
  if (!accessTokenExpiry && fromJwt.exp != null) {
    accessTokenExpiry = new Date(fromJwt.exp * 1000).toISOString();
  }

  return {
    ...tokens,
    identity,
    displayName,
    accessTokenExpiry,
  };
}

export function hasRecognizedIdentity(tokens: TokenSet): boolean {
  const t = enrichTokenSet(tokens);
  return Boolean(t.identity?.trim() || t.displayName?.trim());
}

/** Valid, non-expired session with a known user (for login idempotency). */
export function isAuthenticatedSession(tokens: TokenSet, isExpiredFn: (t: TokenSet) => boolean): boolean {
  const t = enrichTokenSet(tokens);
  return hasRecognizedIdentity(t) && !isExpiredFn(t);
}

export function displayIdentity(tokens: TokenSet): string {
  const t = enrichTokenSet(tokens);
  return t.displayName || t.identity || "(unknown)";
}
