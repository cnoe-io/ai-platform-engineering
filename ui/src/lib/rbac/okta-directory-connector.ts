import { SignJWT, importJWK, importPKCS8 } from "jose";
import type { JWK } from "jose";

/** The signing-key type accepted by SignJWT.sign. Inferred from importJWK
 * (CryptoKey | Uint8Array in jose 6) so we don't depend on the removed
 * `KeyLike` type name. */
type OktaPrivateKey = Awaited<ReturnType<typeof importJWK>>;

interface OktaSigningKey {
  key: OktaPrivateKey;
  /** Resolved `kid` for the client-assertion header: explicit config wins,
   * else the JWK's own `kid` if present. */
  keyId?: string;
}

import type { ExternalGroup } from "@/types/identity-group-sync";

interface OktaGroup {
  id: string;
  profile?: {
    name?: string;
    description?: string;
  };
  lastUpdated?: string;
}

interface OktaUser {
  id: string;
  status?: string;
  profile?: {
    email?: string;
    login?: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
  };
}

export type OktaExternalGroup = ExternalGroup & {
  members: Array<{
    subject?: string;
    email: string;
    display_name?: string;
    active: boolean;
  }>;
};

// Scopes for the directory read paths — least privilege, matching the Roadie
// Okta entity provider. Used by the OAuth2 client-credentials flow.
const OKTA_OAUTH_SCOPES = "okta.groups.read okta.users.read";
// Refresh the OAuth bearer this many ms before its stated expiry.
const OKTA_TOKEN_EXPIRY_SKEW_MS = 60_000;

interface OktaOAuthConfig {
  clientId: string;
  privateKey: string;
  keyId?: string;
}

interface OktaConnectorConfig {
  orgUrl: string;
  /** SSWS API token, when using token auth. */
  apiToken?: string;
  /** Private-key JWT client-credentials, when using OAuth2. */
  oauth?: OktaOAuthConfig;
}

function readOktaConfig(): OktaConnectorConfig | null {
  const orgUrl = process.env.IDENTITY_SYNC_OKTA_ORG_URL?.replace(/\/+$/, "");
  if (!orgUrl) return null;

  const clientId = process.env.IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID?.trim();
  const privateKey = process.env.IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY?.trim();
  const keyId = process.env.IDENTITY_SYNC_OKTA_OAUTH_KEY_ID?.trim();
  // OAuth2 (private-key JWT) takes precedence when configured.
  if (clientId && privateKey) {
    return { orgUrl, oauth: { clientId, privateKey, keyId: keyId || undefined } };
  }

  const apiToken = process.env.IDENTITY_SYNC_OKTA_API_TOKEN?.trim();
  if (apiToken) {
    return { orgUrl, apiToken };
  }

  return null;
}

/**
 * True when the Okta connector has enough config to run: an org URL plus
 * EITHER an SSWS API token OR an OAuth2 client id + private key. Used by the
 * `oktaSyncEnabled` flag and the status route so both auth modes light up the
 * Identity Sync tab.
 */
export function isOktaConnectorConfigured(): boolean {
  return readOktaConfig() !== null;
}

function oktaConfig(): OktaConnectorConfig {
  const config = readOktaConfig();
  if (!config) {
    throw new Error("Okta directory connector is not configured");
  }
  return config;
}

/** Resolves the `Authorization` header value for each Okta request. */
type OktaAuthHeader = () => Promise<string>;

interface CachedToken {
  header: string;
  expiresAt: number;
}

/**
 * Import the OAuth signing key, accepting BOTH formats Okta hands out for a
 * service-app key:
 *   • PEM (PKCS#8) — begins with "-----BEGIN PRIVATE KEY-----"
 *   • JWK (JSON)   — e.g. {"kty":"RSA","d":"...",...}
 * The JWK form is what the Backstage Okta provider's
 * `$include vault/secrets.json#okta_provider.private_key` typically yields.
 */
async function importOktaSigningKey(oauth: OktaOAuthConfig): Promise<OktaSigningKey> {
  const rawPrivateKey = oauth.privateKey.trim();
  if (rawPrivateKey.startsWith("{")) {
    const jwk = JSON.parse(rawPrivateKey) as JWK;
    return {
      key: await importJWK(jwk, "RS256"),
      // Fall back to the JWK's own kid when no explicit key id is configured —
      // Okta requires the assertion's kid to match the registered public key.
      keyId: oauth.keyId || (typeof jwk.kid === "string" ? jwk.kid : undefined),
    };
  }
  // PEM (PKCS#8). Tolerate keys stored with escaped newlines (single-line env vars).
  return {
    key: await importPKCS8(rawPrivateKey.replace(/\\n/g, "\n"), "RS256"),
    keyId: oauth.keyId,
  };
}

/**
 * Mint (and cache) an OAuth2 access token via the private-key JWT
 * client-credentials grant against Okta's org authorization server. The client
 * assertion is a short-lived RS256 JWT signed with the configured private key.
 */
function createOAuthAuthHeader(orgUrl: string, oauth: OktaOAuthConfig): OktaAuthHeader {
  let cached: CachedToken | null = null;

  return async () => {
    if (cached && Date.now() < cached.expiresAt - OKTA_TOKEN_EXPIRY_SKEW_MS) {
      return cached.header;
    }

    const tokenUrl = `${orgUrl}/oauth2/v1/token`;
    const { key, keyId } = await importOktaSigningKey(oauth);
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({})
      .setProtectedHeader(keyId ? { alg: "RS256", kid: keyId } : { alg: "RS256" })
      .setIssuer(oauth.clientId)
      .setSubject(oauth.clientId)
      .setAudience(tokenUrl)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(`${oauth.clientId}-${now}`)
      .sign(key);

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: OKTA_OAUTH_SCOPES,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Okta OAuth token request failed with status ${response.status}`);
    }
    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new Error("Okta OAuth token response did not include an access_token");
    }

    const header = `Bearer ${json.access_token}`;
    const ttlMs = (json.expires_in ?? 3600) * 1000;
    cached = { header, expiresAt: Date.now() + ttlMs };
    return header;
  };
}

function createAuthHeader(config: OktaConnectorConfig): OktaAuthHeader {
  if (config.oauth) {
    return createOAuthAuthHeader(config.orgUrl, config.oauth);
  }
  // SSWS API-token auth — static header.
  const header = `SSWS ${config.apiToken}`;
  return async () => header;
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  const links = header.split(",").map((part) => part.trim());
  for (const link of links) {
    const match = link.match(/^<([^>]+)>;\s*rel="next"$/);
    if (match) return match[1];
  }
  return null;
}

// Page sizes are an implementation detail tuned to Okta's documented maximums,
// not a user setting: the groups-list endpoint caps at 200, and the
// group-members endpoint at 1000. Larger pages mean fewer round-trips (and
// fewer chances to hit the rate limit) for the same data.
const OKTA_GROUPS_PAGE_SIZE = 200;
const OKTA_GROUP_MEMBERS_PAGE_SIZE = 1000;

// Retry posture for Okta's per-minute rate limit (429) and transient
// server/network errors. Okta returns `Retry-After` (seconds) on a 429; we
// honor it when present, otherwise fall back to exponential backoff. 4xx
// errors other than 429 are caller/config problems and fail fast.
const OKTA_MAX_RETRIES = 5;
const OKTA_BASE_BACKOFF_MS = 1000;
const OKTA_MAX_BACKOFF_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, OKTA_MAX_BACKOFF_MS);
    }
  }
  // Exponential backoff: base * 2^attempt, capped.
  return Math.min(OKTA_BASE_BACKOFF_MS * 2 ** attempt, OKTA_MAX_BACKOFF_MS);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchOktaPage<T>(
  url: string,
  authHeader: OktaAuthHeader
): Promise<{ items: T[]; next: string | null }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= OKTA_MAX_RETRIES; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: await authHeader(),
        },
      });
    } catch (err) {
      // Network-level failure — retry with backoff.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < OKTA_MAX_RETRIES) {
        await sleep(retryDelayMs(null, attempt));
        continue;
      }
      break;
    }

    if (response.ok) {
      return {
        items: (await response.json()) as T[],
        next: nextLink(response.headers.get("link")),
      };
    }

    lastError = new Error(`Okta directory request failed with status ${response.status}`);
    if (isRetryableStatus(response.status) && attempt < OKTA_MAX_RETRIES) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    // Non-retryable (e.g. 401/403/404) — fail fast.
    throw lastError;
  }

  throw lastError ?? new Error("Okta directory request failed");
}

async function fetchAllOktaPages<T>(firstUrl: string, authHeader: OktaAuthHeader): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const page = await fetchOktaPage<T>(url, authHeader);
    items.push(...page.items);
    url = page.next;
  }
  return items;
}

// Bounded parallelism for per-group member fetches. Large orgs have thousands
// of groups; fetching members serially is slow, while unbounded parallelism
// floods Okta's rate limit. A small pool balances throughput against 429s
// (adapts the Roadie provider's chunked membership resolution).
const OKTA_MEMBER_FETCH_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runner(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(runners);
  return results;
}

function oktaUserDisplayName(user: OktaUser): string | undefined {
  if (user.profile?.displayName) return user.profile.displayName;
  const fullName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ").trim();
  return fullName || user.profile?.email || user.profile?.login;
}

export async function fetchOktaExternalGroups(input: { providerId: string }): Promise<OktaExternalGroup[]> {
  const config = oktaConfig();
  const { orgUrl } = config;
  const authHeader = createAuthHeader(config);

  const groups = await fetchAllOktaPages<OktaGroup>(
    `${orgUrl}/api/v1/groups?limit=${OKTA_GROUPS_PAGE_SIZE}`,
    authHeader
  );

  // Resolve each group's members with bounded concurrency rather than serially.
  return mapWithConcurrency(groups, OKTA_MEMBER_FETCH_CONCURRENCY, async (group) => {
    const displayName = group.profile?.name ?? group.id;
    const users = await fetchAllOktaPages<OktaUser>(
      `${orgUrl}/api/v1/groups/${encodeURIComponent(group.id)}/users?limit=${OKTA_GROUP_MEMBERS_PAGE_SIZE}`,
      authHeader
    );

    return {
      provider_id: input.providerId,
      external_group_id: group.id,
      display_name: displayName,
      normalized_name: displayName.toLowerCase(),
      status: "active",
      member_count: users.length,
      last_seen_at: new Date().toISOString(),
      metadata: {
        description: group.profile?.description ?? "",
        lastUpdated: group.lastUpdated ?? "",
      },
      members: users
        .map((user) => ({
          subject: undefined,
          email: user.profile?.email ?? user.profile?.login ?? user.id,
          display_name: oktaUserDisplayName(user),
          active: user.status !== "DEPROVISIONED" && user.status !== "SUSPENDED",
        }))
        .filter((member) => Boolean(member.email)),
    } satisfies OktaExternalGroup;
  });
}

export type OktaConnectorHealth =
  | { ok: true; mode: "oauth" | "token" }
  | { ok: false; mode: "oauth" | "token" | "unconfigured"; error: string };

/**
 * One-shot credential probe for the Identity Sync page. Validates that the
 * configured auth (SSWS token or OAuth2 private-key JWT — including the token
 * exchange) actually works, via a single cheap `GET /api/v1/groups?limit=1`.
 *
 * Unlike the sync path this does NOT retry: a misconfigured credential should
 * yield a fast, honest verdict instead of waiting through the backoff loop.
 */
export async function checkOktaConnectorHealth(): Promise<OktaConnectorHealth> {
  const config = readOktaConfig();
  if (!config) {
    return { ok: false, mode: "unconfigured", error: "Okta connector is not configured." };
  }
  const mode: "oauth" | "token" = config.oauth ? "oauth" : "token";

  try {
    const authHeader = createAuthHeader(config);
    const authorization = await authHeader();
    const response = await fetch(`${config.orgUrl}/api/v1/groups?limit=1`, {
      headers: { Accept: "application/json", Authorization: authorization },
    });
    if (response.ok) {
      return { ok: true, mode };
    }
    const hint =
      response.status === 401 || response.status === 403
        ? " — check the credential and that scopes okta.groups.read / okta.users.read are granted."
        : "";
    return {
      ok: false,
      mode,
      error: `Okta returned ${response.status} ${response.statusText}${hint}`,
    };
  } catch (err) {
    return {
      ok: false,
      mode,
      error: err instanceof Error ? err.message : "Okta connectivity check failed.",
    };
  }
}
