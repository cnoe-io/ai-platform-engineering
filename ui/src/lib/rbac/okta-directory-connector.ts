import { Client,type Group,type User } from "@okta/okta-sdk-nodejs";

import type { ExternalGroup } from "@/types/identity-group-sync";

export type OktaExternalGroup = ExternalGroup & {
  members: Array<{
    subject?: string;
    email: string;
    display_name?: string;
    active: boolean;
  }>;
};

// Least-privilege scopes for the OAuth2 (private-key JWT) service app, matching
// the Roadie Okta provider. Ignored for SSWS token auth.
const OKTA_OAUTH_SCOPES = ["okta.groups.read", "okta.users.read"];
// Okta recommends a page size <= 200 for group listing.
const OKTA_GROUPS_PAGE_SIZE = 200;

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
  /**
   * Default Okta group filter expression (env fallback), sent via listGroups'
   * `search` param. We use `search` rather than `filter` because `filter` only
   * supports id/type/lastUpdated, while `search` covers profile attributes like
   * `profile.name` (Okta's recommended query param). There is no per-group user
   * filter (the `listGroupUsers` call takes no filter/search param).
   */
  groupFilter?: string;
}

function readOktaConfig(): OktaConnectorConfig | null {
  const orgUrl = process.env.IDENTITY_SYNC_OKTA_ORG_URL?.replace(/\/+$/, "");
  if (!orgUrl) return null;

  const groupFilter = process.env.IDENTITY_SYNC_OKTA_GROUP_FILTER?.trim() || undefined;

  const clientId = process.env.IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID?.trim();
  const privateKey = process.env.IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY?.trim();
  const keyId = process.env.IDENTITY_SYNC_OKTA_OAUTH_KEY_ID?.trim();
  // OAuth2 (private-key JWT) takes precedence when configured.
  if (clientId && privateKey) {
    return { orgUrl, oauth: { clientId, privateKey, keyId: keyId || undefined }, groupFilter };
  }

  const apiToken = process.env.IDENTITY_SYNC_OKTA_API_TOKEN?.trim();
  if (apiToken) {
    return { orgUrl, apiToken, groupFilter };
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

/**
 * Build an Okta SDK client for the configured auth mode. The SDK owns
 * pagination AND rate-limit handling (it honors Okta's X-Rate-Limit-* headers
 * and retries/queues internally), which is why we no longer hand-roll backoff
 * or bounded concurrency. The private key accepts BOTH formats Okta exports:
 * PEM (PKCS#8) and JWK (JSON); the SDK parses either.
 */
function buildOktaClient(config: OktaConnectorConfig): Client {
  if (config.oauth) {
    const trimmed = config.oauth.privateKey.trim();
    const privateKey: string | Record<string, unknown> = trimmed.startsWith("{")
      ? (JSON.parse(trimmed) as Record<string, unknown>)
      : trimmed;
    return new Client({
      orgUrl: config.orgUrl,
      authorizationMode: "PrivateKey",
      clientId: config.oauth.clientId,
      scopes: OKTA_OAUTH_SCOPES,
      privateKey,
      ...(config.oauth.keyId ? { keyId: config.oauth.keyId } : {}),
    });
  }
  return new Client({ orgUrl: config.orgUrl, token: config.apiToken });
}

function oktaUserDisplayName(user: User): string | undefined {
  const profile = user.profile;
  if (profile?.displayName) return profile.displayName;
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
  return fullName || profile?.email || profile?.login || undefined;
}

async function collectGroupMembers(client: Client, groupId: string): Promise<OktaExternalGroup["members"]> {
  const members: OktaExternalGroup["members"] = [];
  // `.each` transparently follows Okta's pagination cursor.
  const userCollection = await client.groupApi.listGroupUsers({ groupId });
  await userCollection.each((user: User) => {
    const email = user.profile?.email ?? user.profile?.login ?? user.id;
    if (!email) return;
    members.push({
      subject: undefined,
      email,
      display_name: oktaUserDisplayName(user),
      active: user.status !== "DEPROVISIONED" && user.status !== "SUSPENDED",
    });
  });
  return members;
}

export interface FetchOktaGroupsOptions {
  providerId: string;
  /** Okta group filter expression. Overrides the env default when provided. */
  groupFilter?: string;
  /**
   * Reports member-scan progress: called after each group's members are
   * resolved, with how many of `total` groups have been scanned so far.
   */
  onProgress?: (scanned: number, total: number) => void;
}

export async function fetchOktaExternalGroups(
  input: FetchOktaGroupsOptions
): Promise<OktaExternalGroup[]> {
  const config = oktaConfig();
  const client = buildOktaClient(config);
  const startedAt = Date.now();
  // Caller-supplied filter (from saved sync settings) wins over the env default.
  const groupFilter = input.groupFilter?.trim() || config.groupFilter;

  // Phase logs (one line each, not per-request) so operators can follow a sync
  // in the server log: start, group count, and the final tally. The SDK's
  // built-in throttling means a large org slows down rather than 429-failing.
  console.log(
    `[OktaSync] fetching groups from ${config.orgUrl} (auth: ${config.oauth ? "oauth" : "token"}` +
      `${groupFilter ? `, filter: ${groupFilter}` : ""})`
  );

  const groups: Group[] = [];
  const groupCollection = await client.groupApi.listGroups({
    // `search` (not `filter`) so profile-attribute expressions like
    // `profile.name eq "..."` work; `filter` only supports id/type/lastUpdated.
    search: groupFilter,
    limit: OKTA_GROUPS_PAGE_SIZE,
  });
  await groupCollection.each((group: Group) => {
    groups.push(group);
  });

  console.log(`[OktaSync] ${groups.length} groups; resolving members`);

  // Report the total up front (0 scanned) so the UI shows "Scanning members
  // (0/N)" immediately, before the first group's members finish resolving.
  input.onProgress?.(0, groups.length);

  const result: OktaExternalGroup[] = [];
  for (const group of groups) {
    const displayName = group.profile?.name ?? group.id ?? "";
    // Members are fetched by Okta's group id, but `external_group_id` keys the
    // membership identity by group NAME to match the login/OIDC path (whose
    // claim carries names). Keying by Okta id here would create a second,
    // duplicate membership row (and badge) for the same group a user got via
    // login. The 1:1 model is name-based throughout (the catch-all rule slugs
    // off the name), so the name is the stable cross-path key.
    const externalGroupId = group.profile?.name ?? group.id ?? "";
    const members = await collectGroupMembers(client, group.id ?? "");
    result.push({
      provider_id: input.providerId,
      external_group_id: externalGroupId,
      display_name: displayName,
      normalized_name: displayName.toLowerCase(),
      status: "active",
      member_count: members.length,
      last_seen_at: new Date().toISOString(),
      metadata: {
        description: group.profile?.description ?? "",
        lastUpdated: group.lastUpdated ? new Date(group.lastUpdated).toISOString() : "",
      },
      members,
    });
    input.onProgress?.(result.length, groups.length);
  }

  const totalMembers = result.reduce((sum, g) => sum + (g.member_count ?? 0), 0);
  console.log(
    `[OktaSync] done: ${result.length} groups, ${totalMembers} memberships in ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );
  return result;
}

export type OktaConnectorHealth =
  | { ok: true; mode: "oauth" | "token" }
  | { ok: false; mode: "oauth" | "token" | "unconfigured"; error: string };

/**
 * One-shot credential probe for the Identity Sync page. Validates that the
 * configured auth (SSWS token or OAuth2 private-key JWT, including the token
 * exchange) actually works, via a single cheap one-group list call.
 */
export async function checkOktaConnectorHealth(): Promise<OktaConnectorHealth> {
  const config = readOktaConfig();
  if (!config) {
    return { ok: false, mode: "unconfigured", error: "Okta connector is not configured." };
  }
  const mode: "oauth" | "token" = config.oauth ? "oauth" : "token";

  try {
    const client = buildOktaClient(config);
    // Pull at most one group to exercise auth (and, for OAuth, the token grant).
    const probe = await client.groupApi.listGroups({ limit: 1 });
    await probe.next();
    return { ok: true, mode };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okta connectivity check failed.";
    console.warn(`[OktaSync] health check failed (${mode}) for ${config.orgUrl}: ${message}`);
    const hint = /401|403|unauthor|forbidden|scope/i.test(message)
      ? " (check the credential and that scopes okta.groups.read / okta.users.read are granted)."
      : "";
    return { ok: false, mode, error: `${message}${hint}` };
  }
}
