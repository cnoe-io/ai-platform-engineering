/**
 * Token lifecycle management.
 *
 * - getValidToken(): resolve a live access token, silently refreshing if needed
 * - refreshAccessToken(): exchange a refresh token for a new TokenSet
 * - isExpired(): check if a TokenSet has a valid, unexpired access token
 *
 * Throws AuthRequired when no tokens exist or refresh has failed permanently.
 */

import { authEndpoints } from "../platform/config.js";
import { claimsFromOAuthTokenResponse, enrichTokenSet } from "./session.js";
import { type TokenSet, loadTokens, storeTokens } from "./keychain.js";

/** Thrown when no valid token can be produced and interactive re-auth is needed. */
export class AuthRequired extends Error {
  constructor(reason?: string) {
    super(reason ?? "Not authenticated. Run `caipe auth login` to authenticate.");
    this.name = "AuthRequired";
  }
}

// Refresh tokens this many ms before expiry to avoid races.
const REFRESH_MARGIN_MS = 60_000;

/**
 * Return a valid access token.
 *
 * Resolution order:
 *   1. Loaded tokens not expired → return as-is
 *   2. Loaded tokens expired + refresh token present → silent refresh → return
 *   3. No tokens / refresh failed → throw AuthRequired
 */
export async function getValidToken(authUrl: string): Promise<string> {
  const raw = await loadTokens();
  if (!raw) throw new AuthRequired();
  const tokens = enrichTokenSet(raw);

  if (!isExpired(tokens)) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    throw new AuthRequired("Session expired. Run `caipe auth login` to re-authenticate.");
  }

  const refreshed = await refreshAccessToken(tokens.refreshToken, authUrl);
  await storeTokens(refreshed);
  return refreshed.accessToken;
}

/**
 * Exchange a refresh token for a new TokenSet via the token endpoint.
 */
export async function refreshAccessToken(refreshToken: string, authUrl: string): Promise<TokenSet> {
  const ep = authEndpoints(authUrl);

  const res = await fetch(ep.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    throw new AuthRequired(
      `Token refresh failed (${res.status}). Run \`caipe auth login\` to re-authenticate.`,
    );
  }

  const body = (await res.json()) as Record<string, unknown>;
  const accessToken = String(body.access_token ?? "");
  const newRefreshToken = body.refresh_token != null ? String(body.refresh_token) : refreshToken;
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  const accessTokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  const claims = claimsFromOAuthTokenResponse(body);

  return enrichTokenSet({
    accessToken,
    refreshToken: newRefreshToken,
    accessTokenExpiry,
    identity: claims.identity,
    displayName: claims.displayName,
  });
}

/**
 * Returns true when `tokens` has no valid, unexpired access token.
 */
export function isExpired(tokens: TokenSet): boolean {
  const t = enrichTokenSet(tokens);
  if (!t.accessToken) return true;
  if (!t.accessTokenExpiry) return false; // opaque token — assume valid until API rejects

  const expiry = Date.parse(t.accessTokenExpiry);
  if (Number.isNaN(expiry)) return false;

  return Date.now() >= expiry - REFRESH_MARGIN_MS;
}
