/**
 * OS keychain adapter via keytar.
 *
 * Tokens are stored under service name "CAIPE Platform Engineering CLI" with account "tokens".
 * The value is a JSON-serialized TokenSet.
 *
 * Invariant: access tokens are NEVER written to disk in plaintext.
 * The only persistent storage is the OS keychain.
 */

import keytar from "keytar";

const SERVICE = "CAIPE Platform Engineering CLI";
const ACCOUNT = "tokens";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ISO 8601 datetime */
  accessTokenExpiry?: string;
  identity?: string;
  displayName?: string;
}

/**
 * Persist a TokenSet to the OS keychain.
 */
export async function storeTokens(tokens: TokenSet): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(tokens));
}

/**
 * Load the stored TokenSet from the OS keychain.
 * Returns null if no tokens are stored.
 */
export async function loadTokens(): Promise<TokenSet | null> {
  const raw = await keytar.getPassword(SERVICE, ACCOUNT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

/**
 * Remove stored tokens from the OS keychain.
 * Returns true if a credential was found and deleted.
 */
export async function clearTokens(): Promise<boolean> {
  return keytar.deletePassword(SERVICE, ACCOUNT);
}
