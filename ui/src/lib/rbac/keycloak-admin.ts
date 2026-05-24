export interface KeycloakRole {
  id: string;
  name: string;
  description?: string;
  composite: boolean;
  clientRole: boolean;
  containerId: string;
}

export interface KeycloakIdpAlias {
  alias: string;
  displayName?: string;
  providerId: string;
}

export interface KeycloakIdpMapper {
  id?: string;
  name?: string;
  identityProviderAlias?: string;
  identityProviderMapper?: string;
  config?: Record<string, string>;
}

export const BUILT_IN_ROLES = [
  "offline_access",
  "uma_authorization",
  "default-roles-caipe",
] as const;

const BUILT_IN_ROLE_SET = new Set<string>(BUILT_IN_ROLES);

type TokenCache = {
  token: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;
let tokenRefreshPromise: Promise<string> | null = null;

function getKeycloakUrl(): string {
  const url = process.env.KEYCLOAK_URL?.trim();
  if (!url) {
    throw new Error("KEYCLOAK_URL is not set");
  }
  return url.replace(/\/$/, "");
}

function getRealm(): string {
  const realm = process.env.KEYCLOAK_REALM?.trim();
  return realm || "caipe";
}

function getRealmTokenEndpoint(): string {
  return `${getKeycloakUrl()}/realms/${encodeURIComponent(getRealm())}/protocol/openid-connect/token`;
}

function getMasterTokenEndpoint(): string {
  return `${getKeycloakUrl()}/realms/master/protocol/openid-connect/token`;
}

function getAdminBaseUrl(): string {
  return `${getKeycloakUrl()}/admin/realms/${encodeURIComponent(getRealm())}`;
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return response.statusText || String(response.status);
  }
  try {
    const json = JSON.parse(text) as { error?: string; error_description?: string };
    if (json.error || json.error_description) {
      return [json.error, json.error_description].filter(Boolean).join(": ");
    }
  } catch {}
  return text.slice(0, 500);
}

async function requestTokenFromKeycloak(
  endpoint: string,
  body: URLSearchParams,
  label: string
): Promise<TokenCache> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`Keycloak token (${label}) failed: ${response.status} ${detail}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token || typeof data.expires_in !== "number") {
    throw new Error(`Keycloak token (${label}) response missing access_token or expires_in`);
  }

  const bufferMs = 30_000;
  const expiresAtMs = Date.now() + Math.max(0, data.expires_in * 1000 - bufferMs);
  console.log(`[KeycloakAdmin] Obtained admin token via ${label}, cached until ~${new Date(expiresAtMs).toISOString()}`);
  return { token: data.access_token, expiresAtMs };
}

/**
 * Decide whether the `admin/admin` password-grant fallback against
 * `/realms/master` is allowed in this process. The fallback is a
 * convenience for local dev / docker-compose where the operator may not
 * have plumbed `KEYCLOAK_ADMIN_CLIENT_ID/SECRET` yet — but in a real
 * deployment it represents master-realm admin escalation from the BFF
 * if the Keycloak bootstrap admin password is still the default. We
 * therefore disable it unless the operator opts in OR the process is
 * obviously a dev/test build.
 *
 * Opt-in signals (any one wins):
 *   - `ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true` (the explicit knob;
 *     set by docker-compose.dev and by the umbrella chart's values
 *     under a `dev-fallback` profile)
 *   - `NODE_ENV !== "production"` (matches every dev build of Node and
 *     keeps the local DX unchanged)
 *
 * Anything else throws — see the call site below — so a misconfigured
 * production install fails loudly with a configuration error instead of
 * silently calling /realms/master with `admin/admin`.
 */
function adminPasswordFallbackAllowed(): boolean {
  const explicit = process.env.ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv !== "production";
}

async function fetchFreshAdminToken(): Promise<TokenCache> {
  const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID?.trim();
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET?.trim();

  if (clientId && clientSecret) {
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });
      return await requestTokenFromKeycloak(
        getRealmTokenEndpoint(),
        body,
        "client_credentials"
      );
    } catch (err) {
      if (!adminPasswordFallbackAllowed()) {
        // Re-throw the underlying error verbatim so the operator sees
        // exactly which Keycloak response broke us (status + body).
        throw err;
      }
      console.warn(
        "[KeycloakAdmin] client_credentials failed, falling back to password grant:",
        err
      );
    }
  } else {
    if (!adminPasswordFallbackAllowed()) {
      throw new Error(
        "Keycloak admin credentials missing: set KEYCLOAK_ADMIN_CLIENT_ID + " +
          "KEYCLOAK_ADMIN_CLIENT_SECRET (via the keycloak.platformClient secret " +
          "in the Helm chart, or your secret store). The admin/admin password-grant " +
          "fallback is disabled in production — set " +
          "ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true to opt in for local dev only."
      );
    }
    console.warn("[KeycloakAdmin] Missing admin client id/secret; using password grant (dev)");
  }

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: "admin",
    password: "admin",
  });
  return await requestTokenFromKeycloak(
    getMasterTokenEndpoint(),
    body,
    "password (admin-cli)"
  );
}

export async function getAdminToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache !== null && tokenCache.expiresAtMs > now) {
    return tokenCache.token;
  }

  if (tokenRefreshPromise !== null) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    const next = await fetchFreshAdminToken();
    tokenCache = next;
    return next.token;
  })();

  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAdminToken();
  const url = `${getAdminBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

async function parseJsonArray<T>(response: Response): Promise<T[]> {
  if (response.status === 204) {
    return [];
  }
  const text = await response.text();
  if (!text) {
    return [];
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Keycloak Admin API returned a non-array JSON body");
  }
  return data as T[];
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok || response.status === 204) {
    return;
  }
  const detail = await readErrorBody(response);
  throw new Error(`Keycloak Admin ${action} failed: ${response.status} ${detail}`);
}

export async function listRealmRoles(): Promise<KeycloakRole[]> {
  console.log("[KeycloakAdmin] listRealmRoles");
  const response = await adminFetch("/roles", { method: "GET" });
  await assertOk(response, "listRealmRoles");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw.map((r) => {
    const id = String(r.id ?? "");
    const name = String(r.name ?? "");
    return {
      id,
      name,
      description: r.description !== undefined && r.description !== null ? String(r.description) : undefined,
      composite: Boolean(r.composite),
      clientRole: Boolean(r.clientRole),
      containerId: String(r.containerId ?? ""),
    };
  });
}

export async function createRealmRole(name: string, description?: string): Promise<void> {
  console.log(`[KeycloakAdmin] createRealmRole name=${name}`);
  const response = await adminFetch("/roles", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  await assertOk(response, "createRealmRole");
}

export async function getRoleByName(name: string): Promise<KeycloakRole> {
  const encoded = encodeURIComponent(name);
  const response = await adminFetch(`/roles/${encoded}`, { method: "GET" });
  await assertOk(response, `getRoleByName(${name})`);
  const r = (await response.json()) as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? name),
    description: r.description !== undefined && r.description !== null ? String(r.description) : undefined,
    composite: Boolean(r.composite),
    clientRole: Boolean(r.clientRole),
    containerId: String(r.containerId ?? ""),
  };
}

export async function deleteRealmRole(name: string): Promise<void> {
  if (BUILT_IN_ROLE_SET.has(name)) {
    throw new Error(`Cannot delete built-in realm role: ${name}`);
  }
  const role = await getRoleByName(name);
  if (!role.id) {
    throw new Error(`Keycloak role "${name}" has no id; cannot delete`);
  }
  console.log(`[KeycloakAdmin] deleteRealmRole name=${name} id=${role.id}`);
  const response = await adminFetch(`/roles-by-id/${encodeURIComponent(role.id)}`, {
    method: "DELETE",
  });
  await assertOk(response, "deleteRealmRole");
}

export async function listIdpAliases(): Promise<KeycloakIdpAlias[]> {
  console.log("[KeycloakAdmin] listIdpAliases");
  const response = await adminFetch("/identity-provider/instances", { method: "GET" });
  await assertOk(response, "listIdpAliases");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw.map((p) => ({
    alias: String(p.alias ?? ""),
    displayName:
      p.displayName !== undefined && p.displayName !== null ? String(p.displayName) : undefined,
    providerId: String(p.providerId ?? ""),
  }));
}

export async function listIdpMappers(alias: string): Promise<KeycloakIdpMapper[]> {
  console.log(`[KeycloakAdmin] listIdpMappers alias=${alias}`);
  const enc = encodeURIComponent(alias);
  const response = await adminFetch(`/identity-provider/instances/${enc}/mappers`, { method: "GET" });
  await assertOk(response, "listIdpMappers");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw.map((m) => {
    const config = m.config;
    return {
      id: m.id !== undefined && m.id !== null ? String(m.id) : undefined,
      name: m.name !== undefined && m.name !== null ? String(m.name) : undefined,
      identityProviderAlias:
        m.identityProviderAlias !== undefined && m.identityProviderAlias !== null
          ? String(m.identityProviderAlias)
          : undefined,
      identityProviderMapper:
        m.identityProviderMapper !== undefined && m.identityProviderMapper !== null
          ? String(m.identityProviderMapper)
          : undefined,
      config:
        config !== undefined && config !== null && typeof config === "object" && !Array.isArray(config)
          ? (config as Record<string, string>)
          : undefined,
    };
  });
}

export async function createGroupRoleMapper(
  alias: string,
  groupName: string,
  roleName: string
): Promise<KeycloakIdpMapper> {
  const mapperName = `${alias}-${groupName}-to-${roleName}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 240);
  const payload = {
    name: mapperName,
    identityProviderAlias: alias,
    identityProviderMapper: "oidc-advanced-role-idp-mapper",
    config: {
      syncMode: "INHERIT",
      "are.claim.values.regex": "false",
      claims: JSON.stringify([{ key: "groups", value: groupName }]),
      role: roleName,
    },
  };
  console.log(`[KeycloakAdmin] createGroupRoleMapper alias=${alias} group=${groupName} role=${roleName}`);
  const enc = encodeURIComponent(alias);
  const response = await adminFetch(`/identity-provider/instances/${enc}/mappers`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await assertOk(response, "createGroupRoleMapper");
  const text = await response.text();
  if (!text) {
    return {};
  }
  const m = JSON.parse(text) as Record<string, unknown>;
  const config = m.config;
  return {
    id: m.id !== undefined && m.id !== null ? String(m.id) : undefined,
    name: m.name !== undefined && m.name !== null ? String(m.name) : undefined,
    identityProviderAlias:
      m.identityProviderAlias !== undefined && m.identityProviderAlias !== null
        ? String(m.identityProviderAlias)
        : undefined,
    identityProviderMapper:
      m.identityProviderMapper !== undefined && m.identityProviderMapper !== null
        ? String(m.identityProviderMapper)
        : undefined,
    config:
      config !== undefined && config !== null && typeof config === "object" && !Array.isArray(config)
        ? (config as Record<string, string>)
        : undefined,
  };
}

export async function listRealmUsersPage(
  first: number,
  max: number
): Promise<Array<Record<string, unknown>>> {
  const response = await adminFetch(
    `/users?first=${first}&max=${max}`,
    { method: "GET" }
  );
  await assertOk(response, "listRealmUsersPage");
  return parseJsonArray<Record<string, unknown>>(response);
}

export async function listRealmRoleMappingsForUser(
  userId: string
): Promise<KeycloakRole[]> {
  const enc = encodeURIComponent(userId);
  const response = await adminFetch(
    `/users/${enc}/role-mappings/realm`,
    { method: "GET" }
  );
  await assertOk(response, "listRealmRoleMappingsForUser");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw.map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    description:
      r.description !== undefined && r.description !== null
        ? String(r.description)
        : undefined,
    composite: Boolean(r.composite),
    clientRole: Boolean(r.clientRole),
    containerId: String(r.containerId ?? ""),
  }));
}

export async function getRealmUserById(
  userId: string
): Promise<Record<string, unknown>> {
  const enc = encodeURIComponent(userId);
  const response = await adminFetch(`/users/${enc}`, { method: "GET" });
  await assertOk(response, `getRealmUserById(${userId})`);
  return (await response.json()) as Record<string, unknown>;
}

export async function mergeUserAttributes(
  userId: string,
  attrs: Record<string, unknown>
): Promise<void> {
  const user = await getRealmUserById(userId);
  const existing =
    user.attributes && typeof user.attributes === "object" && !Array.isArray(user.attributes)
      ? (user.attributes as Record<string, unknown>)
      : {};

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  const enc = encodeURIComponent(userId);
  const response = await adminFetch(`/users/${enc}`, {
    method: "PUT",
    body: JSON.stringify({ ...user, attributes: merged }),
  });
  await assertOk(response, `mergeUserAttributes(${userId})`);
}

export interface KeycloakSession {
  id: string;
  username?: string;
  ipAddress?: string;
  start?: number;
  lastAccess?: number;
}

export interface KeycloakFederatedIdentity {
  identityProvider: string;
  userId: string;
  userName: string;
}

export interface SearchUsersParams {
  search?: string;
  enabled?: boolean;
  first?: number;
  max?: number;
}

export interface KeycloakUserEnsureResult {
  id: string;
  email: string;
  created: boolean;
}

export async function searchRealmUsers(
  params: SearchUsersParams
): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.enabled !== undefined) qs.set("enabled", String(params.enabled));
  qs.set("first", String(params.first ?? 0));
  qs.set("max", String(params.max ?? 20));
  const response = await adminFetch(`/users?${qs.toString()}`, { method: "GET" });
  await assertOk(response, "searchRealmUsers");
  return parseJsonArray<Record<string, unknown>>(response);
}

async function findRealmUsersByExactEmail(email: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams({
    email,
    exact: "true",
    first: "0",
    max: "5",
  });
  const response = await adminFetch(`/users?${qs.toString()}`, { method: "GET" });
  await assertOk(response, "findRealmUsersByExactEmail");
  return parseJsonArray<Record<string, unknown>>(response);
}

export async function countRealmUsers(
  params?: Pick<SearchUsersParams, "search" | "enabled">
): Promise<number> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.enabled !== undefined) qs.set("enabled", String(params.enabled));
  const response = await adminFetch(`/users/count?${qs.toString()}`, { method: "GET" });
  await assertOk(response, "countRealmUsers");
  const text = await response.text();
  return parseInt(text, 10) || 0;
}

export async function getUserSessions(
  userId: string
): Promise<KeycloakSession[]> {
  const enc = encodeURIComponent(userId);
  const response = await adminFetch(`/users/${enc}/sessions`, { method: "GET" });
  await assertOk(response, "getUserSessions");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw.map((s) => ({
    id: String(s.id ?? ""),
    username: s.username !== undefined ? String(s.username) : undefined,
    ipAddress: s.ipAddress !== undefined ? String(s.ipAddress) : undefined,
    start: typeof s.start === "number" ? s.start : undefined,
    lastAccess: typeof s.lastAccess === "number" ? s.lastAccess : undefined,
  }));
}

export async function getUserFederatedIdentities(
  userId: string
): Promise<KeycloakFederatedIdentity[]> {
  const enc = encodeURIComponent(userId);
  const response = await adminFetch(`/users/${enc}/federated-identity`, { method: "GET" });
  await assertOk(response, "getUserFederatedIdentities");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw.map((fi) => ({
    identityProvider: String(fi.identityProvider ?? ""),
    userId: String(fi.userId ?? ""),
    userName: String(fi.userName ?? ""),
  }));
}

export async function assignRealmRolesToUser(
  userId: string,
  roles: KeycloakRole[]
): Promise<void> {
  const enc = encodeURIComponent(userId);
  const response = await adminFetch(`/users/${enc}/role-mappings/realm`, {
    method: "POST",
    body: JSON.stringify(roles),
  });
  await assertOk(response, "assignRealmRolesToUser");
}

export async function removeRealmRolesFromUser(
  userId: string,
  roles: KeycloakRole[]
): Promise<void> {
  const enc = encodeURIComponent(userId);
  const response = await adminFetch(`/users/${enc}/role-mappings/realm`, {
    method: "DELETE",
    body: JSON.stringify(roles),
  });
  await assertOk(response, "removeRealmRolesFromUser");
}

export async function updateUser(
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  const enc = encodeURIComponent(userId);
  const response = await adminFetch(`/users/${enc}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  await assertOk(response, "updateUser");
}

export async function listUsersWithRole(
  roleName: string,
  first = 0,
  max = 100
): Promise<Array<Record<string, unknown>>> {
  const enc = encodeURIComponent(roleName);
  const response = await adminFetch(
    `/roles/${enc}/users?first=${first}&max=${max}`,
    { method: "GET" }
  );
  await assertOk(response, "listUsersWithRole");
  return parseJsonArray<Record<string, unknown>>(response);
}

export async function deleteIdpMapper(alias: string, mapperId: string): Promise<void> {
  console.log(`[KeycloakAdmin] deleteIdpMapper alias=${alias} mapperId=${mapperId}`);
  const encAlias = encodeURIComponent(alias);
  const encId = encodeURIComponent(mapperId);
  const response = await adminFetch(`/identity-provider/instances/${encAlias}/mappers/${encId}`, {
    method: "DELETE",
  });
  await assertOk(response, "deleteIdpMapper");
}

/** Alias for callers that expect the name `getKeycloakAdminToken` (098 RBAC resource sync). */
export { getAdminToken as getKeycloakAdminToken };

// ─────────────────────────────────────────────────────────────────────────────
// Spec 104 helpers — Keycloak admin conveniences used during ReBAC sync.
//
// `ensureRealmRole` is retained for coarse/bootstrap role administration only.
// Per-resource grants such as `agent_user:<id>` and `tool_user:<id>` belong in
// OpenFGA relationships and should not be created here for new flows.
//
// `findUserIdByEmail` is a thin convenience around `searchRealmUsers` for the
// common "I have an email, give me the Keycloak `sub`" case used when
// reconciling team membership → OpenFGA tuples.
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureRealmRole(
  name: string,
  description?: string
): Promise<KeycloakRole> {
  try {
    return await getRoleByName(name);
  } catch {
    await createRealmRole(name, description);
    return await getRoleByName(name);
  }
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!email || !email.trim()) return null;
  const trimmed = email.trim().toLowerCase();
  const matches = await searchRealmUsers({ search: trimmed, max: 5 });
  for (const u of matches) {
    const userEmail = typeof u.email === "string" ? u.email.toLowerCase() : "";
    const userName = typeof u.username === "string" ? u.username.toLowerCase() : "";
    if (userEmail === trimmed || userName === trimmed) {
      const id = u.id;
      return typeof id === "string" && id ? id : null;
    }
  }
  // Fallback: if exactly one match and the prefix matches, return it. Keycloak's
  // `search` is a substring match; we don't want to accidentally pick the wrong
  // user, so we only accept the loose match when the result set is unambiguous.
  if (matches.length === 1) {
    const id = matches[0]?.id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function exactEmailUserId(email: string, users: Array<Record<string, unknown>>): string | null {
  const matches = users.filter((u) => {
    const userEmail = typeof u.email === "string" ? u.email.toLowerCase() : "";
    const userName = typeof u.username === "string" ? u.username.toLowerCase() : "";
    return userEmail === email || userName === email;
  });
  if (matches.length > 1) {
    throw new Error(`Keycloak returned multiple users for bootstrap email ${email}`);
  }
  const id = matches[0]?.id;
  return typeof id === "string" && id ? id : null;
}

export async function ensureUserByEmail(email: string): Promise<KeycloakUserEnsureResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Bootstrap admin email is empty");
  }

  const existingId = exactEmailUserId(trimmed, await findRealmUsersByExactEmail(trimmed));
  if (existingId) {
    return { id: existingId, email: trimmed, created: false };
  }

  const response = await adminFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      username: trimmed,
      email: trimmed,
      enabled: true,
      emailVerified: true,
      requiredActions: [],
    }),
  });
  if (!response.ok && response.status !== 409) {
    await assertOk(response, `ensureUserByEmail(${trimmed})`);
  }

  const createdId = exactEmailUserId(trimmed, await findRealmUsersByExactEmail(trimmed));
  if (!createdId) {
    throw new Error(`Keycloak user for bootstrap email ${trimmed} was not found after create`);
  }
  return { id: createdId, email: trimmed, created: response.status !== 409 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec 104 — per-team Keycloak client scopes for active_team claim.
//
// One client scope per team named `team-<slug>` carries a single
// `oidc-hardcoded-claim-mapper` injecting `active_team=<slug>` into the
// access token. We bind the scope BOTH as an optional scope on the
// `caipe-slack-bot` client (for code symmetry with team-personal) AND as
// a *default* scope on the bot OBO audience client. Keycloak's
// RFC 8693 token-exchange silently drops the `scope` request parameter,
// so the only reliable way to inject the `active_team` claim is via the
// target audience client's default scopes — see Spec 104 and the
// `_apply_active_team` comment in the slack-bot OBO module.
//
// CAVEAT: with multiple teams bound as defaults on the OBO audience, every
// hardcoded mapper fires and the last one wins (mapper order is
// undefined). The bot's mismatch check (`_do_exchange`) catches this and
// rejects, but multi-team users will see denials. Follow-up work should
// switch to a script-mapper that reads the requested team from a custom
// parameter rather than per-team default scopes.
//
// All operations are idempotent so the Web UI backend can re-run them on every
// startup as part of the team-scope auto-sync.
// ─────────────────────────────────────────────────────────────────────────────

const SLACK_BOT_CLIENT_ID =
  process.env.KEYCLOAK_BOT_CLIENT_ID?.trim() || "caipe-slack-bot";

const WEBEX_BOT_CLIENT_ID =
  process.env.KEYCLOAK_WEBEX_BOT_CLIENT_ID?.trim() || "caipe-webex-bot";

const BOT_OBO_AUDIENCE_CLIENT_ID =
  process.env.CAIPE_PLATFORM_AUDIENCE?.trim() || "caipe-platform";

// ─────────────────────────────────────────────────────────────────────────────
// Special-case "personal" team scope
//
// Spec 104 reserves `team-personal` as the DM-mode marker scope. Unlike real
// team scopes its slug is fixed (`personal`), its `active_team` mapper value
// is the sentinel `__personal__`, and it has no matching Mongo team row — it
// is provisioned exclusively by `init-token-exchange.sh` and re-asserted by
// the reconciliation migration.
//
// Architectural note: real `team-<slug>` scopes contribute `active_team` via
// the **default-on-audience** binding because Keycloak's RFC 8693
// token-exchange silently drops the `scope=` request parameter. Only one
// `team-*` scope can be default on a given audience at a time
// (`selectAgentGatewayActiveTeamScope` enforces this). For that reason
// `team-personal` is NOT bound on the audience — DMs currently land on
// whatever real team is default. Surfacing that as an explicit follow-up
// invariant is intentional; we don't silently "fix" it via an ambiguous
// binding here.
// ─────────────────────────────────────────────────────────────────────────────
export const PERSONAL_TEAM_SLUG = "personal";
export const PERSONAL_TEAM_SCOPE_NAME = `team-${PERSONAL_TEAM_SLUG}`;
export const PERSONAL_TEAM_ACTIVE_VALUE = "__personal__";
export const PERSONAL_TEAM_MAPPER_NAME = `active-team-${PERSONAL_TEAM_SLUG}`;

export function isPersonalTeamSlug(slug: string): boolean {
  return slug === PERSONAL_TEAM_SLUG;
}
export function isPersonalTeamScopeName(scopeName: string): boolean {
  return scopeName === PERSONAL_TEAM_SCOPE_NAME;
}

function canonicalBotPolicyName(policyName: string): string {
  if (policyName === "caipe-webex-bot-token-exchange-policy") {
    return "caipe-webex-bot-token-exchange";
  }
  return policyName;
}

interface KeycloakClient {
  id: string;
  clientId: string;
}

interface KeycloakClientScope {
  id: string;
  name: string;
  protocol?: string;
  description?: string;
}

interface KeycloakProtocolMapper {
  id: string;
  name: string;
  protocolMapper: string;
  config?: Record<string, string>;
}

interface KeycloakManagementPermissions {
  scopePermissions?: Record<string, string | undefined>;
}

interface KeycloakAuthzPolicy {
  id: string;
  name: string;
}

interface KeycloakScopePermission {
  id?: string;
  name?: string;
  policies?: string[];
  [key: string]: unknown;
}

interface KeycloakScopePermissionDetails {
  id?: string;
  name?: string;
  decisionStrategy?: string;
  policies: Array<KeycloakAttachedPolicy>;
}

// We enrich the attached-policy view with `type` and the resolved
// `client_ids` (NOT raw UUIDs) so the invariant evaluator can verify
// that every policy is a strict client allow-list (type === "client" +
// non-empty client_ids naming known bot clients) rather than a
// permissive js/role/regex policy. Required for the AFFIRMATIVE
// decision-strategy threat model: under AFFIRMATIVE a single permissive
// policy is sufficient to grant access, so we audit shape, not just
// presence.
//
// IMPORTANT — why `client_ids`, not `clients`:
//
// Keycloak's `/permission/scope/<id>/associatedPolicies` endpoint
// returns policies with `config: {}` — the allow-list is NOT included
// on that path. To get it, we have to call the type-specific endpoint
// `/policy/client/<id>` which returns `clients: ["<uuid>", ...]`.
// We then resolve each UUID to its `clientId` string via the live
// `/clients` registry so the audit shows operator-meaningful names
// (`caipe-slack-bot`) rather than UUIDs the human cannot recognise.
// The previous version of this type stored UUIDs in `clients[]` and
// the evaluator was unable to detect policy attachment because the
// associatedPolicies path returned an empty config — see the
// regression test for the exact ground-truth payloads.
export interface KeycloakAttachedPolicy {
  id: string;
  name: string;
  type?: string;
  /**
   * Resolved client IDs the policy authorises (e.g. `["caipe-slack-bot"]`).
   * Empty array means the policy is `type=client` but Keycloak returned
   * no allow-list (genuinely permissive). `undefined` means we either
   * didn't try to hydrate (non-client policy type) or the hydration call
   * failed; treat undefined as "unknown", not "empty".
   */
  client_ids?: string[];
}

export interface KeycloakRbacDiagnosticValues {
  team_scopes: Array<{
    scope: string;
    scope_id: string;
    active_team: string;
    active_team_mapper: string;
    optional_on_slack_bot: boolean;
    optional_on_webex_bot: boolean;
    default_on_obo_audience: boolean;
  }>;
  obo_permissions: Array<{
    bot_client_id: string;
    policy_name: string;
    policy_id: string;
    token_exchange_permission_id: string;
    token_exchange_policy_attached: boolean;
    users_impersonate_permission_id: string;
    users_impersonate_policy_attached: boolean;
  }>;
  bot_service_accounts: Array<{
    client_id: string;
    service_account_id: string;
    realm_management_roles: string[];
    impersonation_role_assigned: boolean;
  }>;
  token_exchange_permissions: Array<{
    client_id: string;
    token_exchange_permission_id: string;
    decision_strategy: string;
    policy_names: string[];
    /**
     * Full attached-policy view used by the invariant evaluator. Each
     * entry should be `type=client` with a non-empty `clients`
     * allow-list naming a known bot client. Anything else is a sign
     * that someone added a permissive policy via the Keycloak admin
     * console; under AFFIRMATIVE strategy that grants access without
     * the other policies needing to agree.
     */
    attached_policies: KeycloakAttachedPolicy[];
  }>;
  /**
   * Realm-level `users.impersonate` scope-permission. This is the
   * single permission that gates *all* OBO (token-exchange with
   * requested_subject) flows in this realm — every bot client must
   * have its allow-list policy attached here, and the strategy must
   * be AFFIRMATIVE so any one bot policy can vote PERMIT. Under the
   * default UNANIMOUS strategy, the second bot's per-client policy
   * starts voting DENY for the first bot and OBO fails with
   * `client not allowed to impersonate`.
   */
  users_impersonate_permission?: {
    permission_id: string;
    decision_strategy: string;
    attached_policies: KeycloakAttachedPolicy[];
  };
  active_team_defaults: Array<{
    audience_client_id: string;
    default_team_scopes: string[];
  }>;
}

async function getClientByClientId(clientId: string): Promise<KeycloakClient | null> {
  const enc = encodeURIComponent(clientId);
  const response = await adminFetch(`/clients?clientId=${enc}`, { method: "GET" });
  await assertOk(response, `getClientByClientId(${clientId})`);
  const arr = await parseJsonArray<Record<string, unknown>>(response);
  if (arr.length === 0) return null;
  const c = arr[0]!;
  const id = typeof c.id === "string" ? c.id : "";
  const cid = typeof c.clientId === "string" ? c.clientId : "";
  if (!id || !cid) return null;
  return { id, clientId: cid };
}

async function enableClientManagementPermissions(
  clientUuid: string,
  clientId: string
): Promise<KeycloakManagementPermissions> {
  const enc = encodeURIComponent(clientUuid);
  const response = await adminFetch(`/clients/${enc}/management/permissions`, {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  await assertOk(response, `enableClientManagementPermissions(${clientId})`);
  return readClientManagementPermissions(clientUuid, clientId);
}

async function readClientManagementPermissions(
  clientUuid: string,
  clientId: string
): Promise<KeycloakManagementPermissions> {
  const enc = encodeURIComponent(clientUuid);
  const response = await adminFetch(`/clients/${enc}/management/permissions`, {
    method: "GET",
  });
  await assertOk(response, `readClientManagementPermissions(${clientId})`);
  return (await response.json()) as KeycloakManagementPermissions;
}

async function getUsersImpersonatePermissionId(): Promise<string | null> {
  const response = await adminFetch("/users-management-permissions", { method: "GET" });
  await assertOk(response, "getUsersImpersonatePermissionId");
  const payload = (await response.json()) as KeycloakManagementPermissions;
  return payload.scopePermissions?.impersonate ?? null;
}

async function enableUsersManagementPermissions(): Promise<KeycloakManagementPermissions> {
  const response = await adminFetch("/users-management-permissions", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  await assertOk(response, "enableUsersManagementPermissions");
  const readResponse = await adminFetch("/users-management-permissions", { method: "GET" });
  await assertOk(readResponse, "readUsersManagementPermissions");
  return (await readResponse.json()) as KeycloakManagementPermissions;
}

async function getClientPolicyByName(
  realmManagementUuid: string,
  policyName: string
): Promise<KeycloakAuthzPolicy | null> {
  const response = await adminFetch(
    `/clients/${encodeURIComponent(realmManagementUuid)}/authz/resource-server/policy?name=${encodeURIComponent(policyName)}`,
    { method: "GET" }
  );
  await assertOk(response, `getClientPolicyByName(${policyName})`);
  const policies = await parseJsonArray<Record<string, unknown>>(response);
  const match = policies[0];
  if (!match) return null;
  const id = typeof match.id === "string" ? match.id : "";
  const name = typeof match.name === "string" ? match.name : policyName;
  return id ? { id, name } : null;
}

async function createClientPolicy(
  realmManagementUuid: string,
  policyName: string,
  description: string,
  clientUuid: string
): Promise<KeycloakAuthzPolicy> {
  const response = await adminFetch(
    `/clients/${encodeURIComponent(realmManagementUuid)}/authz/resource-server/policy/client`,
    {
      method: "POST",
      body: JSON.stringify({
        name: policyName,
        description,
        clients: [clientUuid],
      }),
    }
  );
  await assertOk(response, `createClientPolicy(${policyName})`);
  const payload = (await response.json()) as Record<string, unknown>;
  const id = typeof payload.id === "string" ? payload.id : "";
  if (!id) {
    throw new Error(`Keycloak client policy "${policyName}" was created without an id`);
  }
  return { id, name: policyName };
}

async function ensureClientPolicy(
  realmManagementUuid: string,
  policyName: string,
  description: string,
  clientUuid: string
): Promise<KeycloakAuthzPolicy> {
  const existing = await getClientPolicyByName(realmManagementUuid, policyName);
  if (existing) return existing;
  return createClientPolicy(realmManagementUuid, policyName, description, clientUuid);
}

async function attachPolicyToScopePermission(
  realmManagementUuid: string,
  permissionId: string,
  policyId: string
): Promise<void> {
  const encRealmManagement = encodeURIComponent(realmManagementUuid);
  const encPermission = encodeURIComponent(permissionId);
  const permissionPath = `/clients/${encRealmManagement}/authz/resource-server/permission/scope/${encPermission}`;
  const [response, associatedResponse] = await Promise.all([
    adminFetch(permissionPath, { method: "GET" }),
    adminFetch(`${permissionPath}/associatedPolicies`, { method: "GET" }),
  ]);
  await assertOk(response, `readScopePermission(${permissionId})`);
  await assertOk(associatedResponse, `readScopePermissionPolicies(${permissionId})`);
  const permission = (await response.json()) as KeycloakScopePermission;
  const associatedPolicies = await parseJsonArray<Record<string, unknown>>(associatedResponse);
  const policies = new Set(Array.isArray(permission.policies) ? permission.policies : []);
  for (const policy of associatedPolicies) {
    if (typeof policy.id === "string") {
      policies.add(policy.id);
    }
  }
  if (policies.has(policyId)) return;
  policies.add(policyId);

  const updateResponse = await adminFetch(permissionPath, {
    method: "PUT",
    body: JSON.stringify({ ...permission, policies: [...policies] }),
  });
  await assertOk(updateResponse, `attachPolicyToScopePermission(${permissionId})`);
}

async function setScopePermissionDecisionStrategy(
  realmManagementUuid: string,
  permissionId: string,
  decisionStrategy: "AFFIRMATIVE" | "UNANIMOUS"
): Promise<void> {
  const permissionPath = `/clients/${encodeURIComponent(realmManagementUuid)}/authz/resource-server/permission/scope/${encodeURIComponent(permissionId)}`;
  const response = await adminFetch(permissionPath, { method: "GET" });
  await assertOk(response, `readScopePermission(${permissionId})`);
  const permission = (await response.json()) as KeycloakScopePermission & { decisionStrategy?: string };
  if (permission.decisionStrategy === decisionStrategy) return;
  const updateResponse = await adminFetch(permissionPath, {
    method: "PUT",
    body: JSON.stringify({ ...permission, decisionStrategy }),
  });
  await assertOk(updateResponse, `setScopePermissionDecisionStrategy(${permissionId})`);
}

/**
 * Resolver from Keycloak client UUID → clientId string.
 *
 * We hand a single resolver instance down through one batched
 * `getKeycloakRbacDiagnosticValues` inspection so every per-policy
 * hydration shares the same UUID→clientId map (one `/clients` call
 * instead of N).
 */
type ClientUuidResolver = (uuid: string) => Promise<string | null>;

function createClientUuidResolver(): ClientUuidResolver {
  const cache = new Map<string, string | null>();
  let registryPromise: Promise<void> | null = null;
  // Lazy: only fetch the full client registry the first time we're
  // asked to resolve a UUID. If you only ever call this with UUIDs we
  // already know about (e.g. from a small fixture), we skip the call
  // entirely.
  const loadRegistry = async () => {
    if (registryPromise) return registryPromise;
    registryPromise = (async () => {
      // The default `max` on /clients is 100 in modern Keycloak; bump
      // it to 500 so a realm with many service-account clients still
      // returns the whole set in one go. (Pagination is a future
      // concern; we'd switch to a chunked iterator if a realm exceeds
      // 500 clients.)
      const response = await adminFetch(`/clients?max=500`, { method: "GET" });
      await assertOk(response, "listClientsForUuidResolver");
      const raw = await parseJsonArray<Record<string, unknown>>(response);
      for (const c of raw) {
        const id = typeof c.id === "string" ? c.id : "";
        const cid = typeof c.clientId === "string" ? c.clientId : "";
        if (id) cache.set(id, cid || null);
      }
    })();
    return registryPromise;
  };
  return async (uuid: string): Promise<string | null> => {
    if (cache.has(uuid)) return cache.get(uuid) ?? null;
    await loadRegistry();
    return cache.get(uuid) ?? null;
  };
}

/**
 * Hydrate a `type=client` Keycloak policy's allow-list by calling the
 * type-specific `/policy/client/<id>` endpoint. The `associatedPolicies`
 * endpoint that drives `readScopePermissionDetails` returns `config: {}`
 * on these policies, so we must round-trip per policy to get the real
 * `clients[]`. The trade-off is N extra HTTP calls per inspection where
 * N is the number of `type=client` policies attached across all probed
 * perms — in practice ≤6 across a healthy realm.
 *
 * Returns `null` if the policy is not `type=client` or if Keycloak
 * returns a 404 (e.g. orphaned policy). Returns `[]` when Keycloak
 * confirms the policy exists but has no clients in its allow-list —
 * that's a real "permissive policy" finding the invariant evaluator
 * surfaces.
 */
async function readClientPolicyClients(
  realmManagementUuid: string,
  policyId: string,
  resolveClientId: ClientUuidResolver
): Promise<string[] | null> {
  const path =
    `/clients/${encodeURIComponent(realmManagementUuid)}/authz/resource-server/policy/client/` +
    encodeURIComponent(policyId);
  const response = await adminFetch(path, { method: "GET" });
  if (response.status === 404) return null;
  await assertOk(response, `readClientPolicyClients(${policyId})`);
  const payload = (await response.json()) as Record<string, unknown>;
  // Keycloak returns `clients` either as a real array on /policy/client/<id>
  // or as a stringified array under `config.clients` on /policy/<id>;
  // we handle both shapes so the helper is robust if Keycloak versions
  // diverge on this endpoint.
  let uuids: string[] = [];
  if (Array.isArray(payload.clients)) {
    uuids = payload.clients.filter((v): v is string => typeof v === "string");
  } else if (payload.config && typeof payload.config === "object") {
    const raw = (payload.config as Record<string, unknown>).clients;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          uuids = parsed.filter((v): v is string => typeof v === "string");
        }
      } catch {
        uuids = [];
      }
    } else if (Array.isArray(raw)) {
      uuids = raw.filter((v): v is string => typeof v === "string");
    }
  }
  const resolved: string[] = [];
  for (const uuid of uuids) {
    const cid = await resolveClientId(uuid);
    // If we couldn't resolve a UUID (e.g. the client was deleted but
    // the policy still references it) we still want to surface
    // *something* in the audit — render the literal UUID so an admin
    // can find it in the Keycloak Admin Console. The invariant
    // evaluator treats unresolved UUIDs as not matching any known bot
    // (so they cannot satisfy "<bot> policy attached" checks).
    resolved.push(cid || uuid);
  }
  return resolved;
}

async function readScopePermissionDetails(
  realmManagementUuid: string,
  permissionId: string,
  resolveClientId?: ClientUuidResolver
): Promise<KeycloakScopePermissionDetails> {
  const permissionPath = `/clients/${encodeURIComponent(realmManagementUuid)}/authz/resource-server/permission/scope/${encodeURIComponent(permissionId)}`;
  const [response, associatedResponse] = await Promise.all([
    adminFetch(permissionPath, { method: "GET" }),
    adminFetch(`${permissionPath}/associatedPolicies`, { method: "GET" }),
  ]);
  await assertOk(response, `readScopePermissionDetails(${permissionId})`);
  await assertOk(associatedResponse, `readScopePermissionDetailsPolicies(${permissionId})`);
  const permission = (await response.json()) as KeycloakScopePermission & {
    decisionStrategy?: string;
  };
  const associatedPolicies = await parseJsonArray<Record<string, unknown>>(associatedResponse);

  // Project the associated-policy summary first. Then, in a second
  // pass, hydrate any `type=client` policies' `client_ids` via the
  // type-specific endpoint. Order is intentional so that the cheap
  // projection still works in tests / fixtures that mock only the
  // associated-policies call.
  const policies: KeycloakAttachedPolicy[] = associatedPolicies
    .map((policy): KeycloakAttachedPolicy | null => {
      const id = typeof policy.id === "string" ? policy.id : "";
      const name = typeof policy.name === "string" ? policy.name : id;
      if (!id) return null;
      const type = typeof policy.type === "string" ? policy.type : undefined;
      return { id, name, type };
    })
    .filter((policy): policy is KeycloakAttachedPolicy => policy !== null);

  if (resolveClientId) {
    await Promise.all(
      policies.map(async (policy) => {
        if (policy.type !== "client") return;
        const clientIds = await readClientPolicyClients(
          realmManagementUuid,
          policy.id,
          resolveClientId
        ).catch(() => null);
        if (clientIds !== null) policy.client_ids = clientIds;
      })
    );
  }

  return {
    id: typeof permission.id === "string" ? permission.id : permissionId,
    name: typeof permission.name === "string" ? permission.name : undefined,
    decisionStrategy:
      typeof permission.decisionStrategy === "string" ? permission.decisionStrategy : undefined,
    policies,
  };
}

async function listClientScopes(): Promise<KeycloakClientScope[]> {
  const response = await adminFetch("/client-scopes", { method: "GET" });
  await assertOk(response, "listClientScopes");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw
    .map((s) => {
      const id = typeof s.id === "string" ? s.id : "";
      const name = typeof s.name === "string" ? s.name : "";
      if (!id || !name) return null;
      return {
        id,
        name,
        protocol: typeof s.protocol === "string" ? s.protocol : undefined,
        description: typeof s.description === "string" ? s.description : undefined,
      } as KeycloakClientScope;
    })
    .filter((x): x is KeycloakClientScope => x !== null);
}

async function getClientScopeByName(name: string): Promise<KeycloakClientScope | null> {
  const all = await listClientScopes();
  return all.find((s) => s.name === name) ?? null;
}

async function createClientScope(
  name: string,
  description: string
): Promise<KeycloakClientScope> {
  console.log(`[KeycloakAdmin] createClientScope name=${name}`);
  const response = await adminFetch("/client-scopes", {
    method: "POST",
    body: JSON.stringify({
      name,
      protocol: "openid-connect",
      description,
      // Keep the scope name out of the access-token "scope" claim so
      // only the active_team mapper output leaks into the token. This
      // matters because the bot may request "openid team-<slug>" and we
      // don't want to advertise the team list back to clients.
      attributes: { "include.in.token.scope": "false" },
    }),
  });
  await assertOk(response, "createClientScope");
  const found = await getClientScopeByName(name);
  if (!found) {
    throw new Error(`Client scope "${name}" was created but could not be re-fetched`);
  }
  return found;
}

async function listProtocolMappers(scopeId: string): Promise<KeycloakProtocolMapper[]> {
  const enc = encodeURIComponent(scopeId);
  const response = await adminFetch(
    `/client-scopes/${enc}/protocol-mappers/models`,
    { method: "GET" }
  );
  await assertOk(response, "listProtocolMappers");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw
    .map((m) => {
      const id = typeof m.id === "string" ? m.id : "";
      const name = typeof m.name === "string" ? m.name : "";
      const protocolMapper = typeof m.protocolMapper === "string" ? m.protocolMapper : "";
      if (!id || !name) return null;
      return {
        id,
        name,
        protocolMapper,
        config:
          m.config && typeof m.config === "object" && !Array.isArray(m.config)
            ? (m.config as Record<string, string>)
            : undefined,
      } as KeycloakProtocolMapper;
    })
    .filter((x): x is KeycloakProtocolMapper => x !== null);
}

async function ensureHardcodedActiveTeamMapper(
  scopeId: string,
  mapperName: string,
  claimValue: string
): Promise<void> {
  const existing = await listProtocolMappers(scopeId);
  const match = existing.find((m) => m.name === mapperName);
  if (match) {
    // Treat config divergence as fatal — silently re-pointing active_team
    // would be a security regression.
    const currentValue = match.config?.["claim.value"];
    const currentName = match.config?.["claim.name"];
    if (currentName !== "active_team" || currentValue !== claimValue) {
      throw new Error(
        `Hardcoded mapper "${mapperName}" exists but maps to ${currentName}=${currentValue}; ` +
          `expected active_team=${claimValue}. Refusing to silently update.`
      );
    }
    return;
  }
  console.log(
    `[KeycloakAdmin] createHardcodedActiveTeamMapper scope=${scopeId} value=${claimValue}`
  );
  const enc = encodeURIComponent(scopeId);
  const response = await adminFetch(`/client-scopes/${enc}/protocol-mappers/models`, {
    method: "POST",
    body: JSON.stringify({
      name: mapperName,
      protocol: "openid-connect",
      protocolMapper: "oidc-hardcoded-claim-mapper",
      consentRequired: false,
      config: {
        "claim.name": "active_team",
        "claim.value": claimValue,
        "jsonType.label": "String",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
      },
    }),
  });
  await assertOk(response, "createHardcodedActiveTeamMapper");
}

async function bindScopeAsOptional(
  clientUuid: string,
  scopeId: string
): Promise<void> {
  // PUT is idempotent: 204 on success, 409 if already bound (treat as ok).
  const encClient = encodeURIComponent(clientUuid);
  const encScope = encodeURIComponent(scopeId);
  const response = await adminFetch(
    `/clients/${encClient}/optional-client-scopes/${encScope}`,
    { method: "PUT" }
  );
  if (!response.ok && response.status !== 204 && response.status !== 409) {
    const detail = await readErrorBody(response);
    throw new Error(`bindScopeAsOptional failed: ${response.status} ${detail}`);
  }
}

/**
 * Bind a client scope as a *default* scope on a client. Used for the
 * bot OBO audience client because Keycloak's RFC 8693 token-exchange
 * silently drops the `scope` request parameter — the only way to get a
 * scope's mappers (and therefore the `active_team` claim) into the minted
 * token is via default scopes on the *target audience* client.
 */
async function bindScopeAsDefault(
  clientUuid: string,
  scopeId: string
): Promise<void> {
  const encClient = encodeURIComponent(clientUuid);
  const encScope = encodeURIComponent(scopeId);
  const response = await adminFetch(
    `/clients/${encClient}/default-client-scopes/${encScope}`,
    { method: "PUT" }
  );
  if (!response.ok && response.status !== 204 && response.status !== 409) {
    const detail = await readErrorBody(response);
    throw new Error(`bindScopeAsDefault failed: ${response.status} ${detail}`);
  }
}

async function listDefaultClientScopes(clientUuid: string): Promise<KeycloakClientScope[]> {
  const response = await adminFetch(
    `/clients/${encodeURIComponent(clientUuid)}/default-client-scopes`,
    { method: "GET" }
  );
  await assertOk(response, "listDefaultClientScopes");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw
    .map((s) => {
      const id = typeof s.id === "string" ? s.id : "";
      const name = typeof s.name === "string" ? s.name : "";
      if (!id || !name) return null;
      return { id, name } as KeycloakClientScope;
    })
    .filter((scope): scope is KeycloakClientScope => scope !== null);
}

async function listOptionalClientScopes(clientUuid: string): Promise<KeycloakClientScope[]> {
  const response = await adminFetch(
    `/clients/${encodeURIComponent(clientUuid)}/optional-client-scopes`,
    { method: "GET" }
  );
  await assertOk(response, "listOptionalClientScopes");
  const raw = await parseJsonArray<Record<string, unknown>>(response);
  return raw
    .map((s) => {
      const id = typeof s.id === "string" ? s.id : "";
      const name = typeof s.name === "string" ? s.name : "";
      if (!id || !name) return null;
      return { id, name } as KeycloakClientScope;
    })
    .filter((scope): scope is KeycloakClientScope => scope !== null);
}

async function unbindDefaultScope(
  clientUuid: string,
  scopeId: string
): Promise<void> {
  const encClient = encodeURIComponent(clientUuid);
  const encScope = encodeURIComponent(scopeId);
  const response = await adminFetch(
    `/clients/${encClient}/default-client-scopes/${encScope}`,
    { method: "DELETE" }
  );
  if (!response.ok && response.status !== 204 && response.status !== 404) {
    const detail = await readErrorBody(response);
    throw new Error(`unbindDefaultScope failed: ${response.status} ${detail}`);
  }
}

async function unbindOptionalScope(
  clientUuid: string,
  scopeId: string
): Promise<void> {
  const encClient = encodeURIComponent(clientUuid);
  const encScope = encodeURIComponent(scopeId);
  const response = await adminFetch(
    `/clients/${encClient}/optional-client-scopes/${encScope}`,
    { method: "DELETE" }
  );
  // 404 = already unbound; treat as success.
  if (!response.ok && response.status !== 204 && response.status !== 404) {
    const detail = await readErrorBody(response);
    throw new Error(`unbindOptionalScope failed: ${response.status} ${detail}`);
  }
}

async function deleteClientScope(scopeId: string): Promise<void> {
  const enc = encodeURIComponent(scopeId);
  const response = await adminFetch(`/client-scopes/${enc}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204 && response.status !== 404) {
    const detail = await readErrorBody(response);
    throw new Error(`deleteClientScope failed: ${response.status} ${detail}`);
  }
}

/**
 * Validate a slug for a Keycloak client-scope name. Keycloak itself accepts a
 * fairly permissive set of characters but we keep this strict (lowercase
 * alphanumerics + hyphen) so the resulting `active_team` value renders cleanly
 * in JWTs, AGW logs, and OpenFGA relationship object IDs. Callers should reject invalid slugs
 * before trying to materialize a scope; this function is the canonical regex.
 */
export function isValidTeamSlug(slug: string): boolean {
  if (!slug || slug.length > 63) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

/**
 * Idempotently ensure a `team-<slug>` client scope exists with a hardcoded
 * `active_team=<slug>` claim mapper, and is bound as an optional scope on the
 * Slack-bot client. Safe to call repeatedly during startup auto-sync.
 *
 * Throws if the slug is invalid or if an existing mapper is misconfigured —
 * we never silently rewrite an existing claim value to a different team.
 */
export async function ensureTeamClientScope(slug: string): Promise<void> {
  if (!isValidTeamSlug(slug)) {
    throw new Error(
      `Invalid team slug "${slug}" — must be lowercase alphanumerics with hyphens, max 63 chars`
    );
  }
  const scopeName = `team-${slug}`;
  const description = `Spec 104: marks the user as acting in team "${slug}"`;

  const [slackBotClient, webexBotClient] = await Promise.all([
    getClientByClientId(SLACK_BOT_CLIENT_ID),
    getClientByClientId(WEBEX_BOT_CLIENT_ID),
  ]);
  if (!slackBotClient) {
    throw new Error(
      `Keycloak bot client "${SLACK_BOT_CLIENT_ID}" not found; cannot bind team scope`
    );
  }

  let scope = await getClientScopeByName(scopeName);
  if (!scope) {
    scope = await createClientScope(scopeName, description);
  }

  await ensureHardcodedActiveTeamMapper(scope.id, `active-team-${slug}`, slug);
  await bindScopeAsOptional(slackBotClient.id, scope.id);
  if (webexBotClient) {
    await bindScopeAsOptional(webexBotClient.id, scope.id);
  }

  // Spec 104: bind as DEFAULT on the OBO audience too. Token-exchange ignores
  // the `scope=` request parameter, so optional-on-bot alone produces a
  // token without the `active_team` claim. Default-on-audience is the only
  // wiring that actually injects the claim. Best-effort: if the
  // audience client doesn't exist yet, log
  // and skip rather than failing team creation entirely.
  const oboAudienceClient = await getClientByClientId(BOT_OBO_AUDIENCE_CLIENT_ID);
  if (!oboAudienceClient) {
    console.warn(
      `[keycloak-admin] OBO audience client "${BOT_OBO_AUDIENCE_CLIENT_ID}" not found; ` +
        `team scope "${scopeName}" will not appear in OBO tokens until you run ` +
        `init-idp.sh or create the target audience client manually.`
    );
    return;
  }
  await bindScopeAsDefault(oboAudienceClient.id, scope.id);
}

/**
 * Idempotently ensure the special `team-personal` client scope exists, has a
 * hardcoded `active_team=__personal__` mapper, and is bound as an *optional*
 * scope on both bot clients (`caipe-slack-bot` and `caipe-webex-bot`).
 *
 * This deliberately does **not** bind on the OBO audience client. Real team
 * scopes need default-on-audience because token-exchange drops `scope=`; we
 * intentionally do not "fix" that for `team-personal` because making it
 * default-on-audience would clobber whichever real team is currently default,
 * and making it optional-on-audience has no effect (verified live: KC still
 * drops `scope=team-personal` during token-exchange). The structural DM
 * limitation is surfaced as a separate advisory invariant; this function only
 * keeps the bot-side bindings symmetric and the mapper sane.
 */
export async function ensurePersonalTeamClientScope(): Promise<void> {
  const description = `Spec 104: marks the user as acting in personal (DM) mode`;

  const [slackBotClient, webexBotClient] = await Promise.all([
    getClientByClientId(SLACK_BOT_CLIENT_ID),
    getClientByClientId(WEBEX_BOT_CLIENT_ID),
  ]);
  if (!slackBotClient) {
    throw new Error(
      `Keycloak bot client "${SLACK_BOT_CLIENT_ID}" not found; cannot bind ${PERSONAL_TEAM_SCOPE_NAME} scope`
    );
  }

  let scope = await getClientScopeByName(PERSONAL_TEAM_SCOPE_NAME);
  if (!scope) {
    scope = await createClientScope(PERSONAL_TEAM_SCOPE_NAME, description);
  }

  await ensureHardcodedActiveTeamMapper(
    scope.id,
    PERSONAL_TEAM_MAPPER_NAME,
    PERSONAL_TEAM_ACTIVE_VALUE
  );
  await bindScopeAsOptional(slackBotClient.id, scope.id);
  if (webexBotClient) {
    await bindScopeAsOptional(webexBotClient.id, scope.id);
  } else {
    console.warn(
      `[keycloak-admin] Webex bot client "${WEBEX_BOT_CLIENT_ID}" not found; ` +
        `${PERSONAL_TEAM_SCOPE_NAME} will not be bound on Webex.`
    );
  }
}

/**
 * Delete any `team-<slug>` Keycloak client scopes whose slug is not in the
 * provided `keepSlugs` allow-list AND is not the special `personal` slug.
 *
 * Returns the list of deleted scope names so the caller can record the count
 * in migration metadata. Each delete unbinds the scope from the Slack bot,
 * Webex bot, and OBO audience client first (so we don't leave dangling
 * client-scope mappings), then removes the scope itself.
 *
 * Safe to call repeatedly: no-op when there's nothing to delete.
 */
export async function deleteOrphanTeamClientScopes(
  keepSlugs: Iterable<string>
): Promise<string[]> {
  const allowed = new Set<string>(keepSlugs);
  // `team-personal` is always allowed — it's a structural special-case scope
  // owned by `init-token-exchange.sh` / `ensurePersonalTeamClientScope`.
  allowed.add(PERSONAL_TEAM_SLUG);

  const [slackBotClient, webexBotClient, oboAudienceClient, allScopes] =
    await Promise.all([
      getClientByClientId(SLACK_BOT_CLIENT_ID),
      getClientByClientId(WEBEX_BOT_CLIENT_ID),
      getClientByClientId(BOT_OBO_AUDIENCE_CLIENT_ID),
      listClientScopes(),
    ]);

  const orphans = allScopes.filter((scope) => {
    if (!scope.name.startsWith("team-")) return false;
    const slug = scope.name.slice("team-".length);
    return !allowed.has(slug);
  });

  const deletedNames: string[] = [];
  for (const scope of orphans) {
    if (slackBotClient) {
      await unbindOptionalScope(slackBotClient.id, scope.id);
    }
    if (webexBotClient) {
      await unbindOptionalScope(webexBotClient.id, scope.id);
    }
    if (oboAudienceClient) {
      await unbindDefaultScope(oboAudienceClient.id, scope.id);
      await unbindOptionalScope(oboAudienceClient.id, scope.id);
    }
    await deleteClientScope(scope.id);
    deletedNames.push(scope.name);
    console.log(
      `[keycloak-admin] deleteOrphanTeamClientScopes deleted "${scope.name}" ` +
        `(no matching Mongo team and not a structural special-case scope)`
    );
  }
  return deletedNames;
}

/**
 * Select the single bot OBO audience `team-*` default scope that should contribute
 * `active_team` to token-exchange results.
 *
 * This is a narrow repair for Keycloak's token-exchange behavior: when multiple
 * hardcoded active-team mappers are default scopes on the target audience,
 * mapper order is undefined and the bot can receive the wrong `active_team`.
 */
export async function selectAgentGatewayActiveTeamScope(slug: string): Promise<void> {
  if (!isValidTeamSlug(slug)) {
    throw new Error(
      `Invalid team slug "${slug}" — must be lowercase alphanumerics with hyphens, max 63 chars`
    );
  }
  const oboAudienceClient = await getClientByClientId(BOT_OBO_AUDIENCE_CLIENT_ID);
  if (!oboAudienceClient) {
    throw new Error(`Keycloak audience client "${BOT_OBO_AUDIENCE_CLIENT_ID}" not found`);
  }
  const targetScope = await getClientScopeByName(`team-${slug}`);
  if (!targetScope) {
    throw new Error(`Keycloak client scope "team-${slug}" not found`);
  }

  const defaultScopes = await listDefaultClientScopes(oboAudienceClient.id);
  await Promise.all(
    defaultScopes
      .filter(
        (scope) =>
          scope.name.startsWith("team-") &&
          scope.id !== targetScope.id &&
          // Defensive: `team-personal` should never be default on the audience
          // (see `ensurePersonalTeamClientScope` for the rationale), but if a
          // previous run accidentally bound it we don't want this function to
          // be the one that strips it — keep that as an explicit operator
          // action via the dedicated orphan-cleanup / invariant flow.
          !isPersonalTeamScopeName(scope.name)
      )
      .map((scope) => unbindDefaultScope(oboAudienceClient.id, scope.id))
  );
  await bindScopeAsDefault(oboAudienceClient.id, targetScope.id);
}

async function ensureBotOboPermissions(botClientId: string, policyName: string): Promise<void> {
  const [botClient, oboAudienceClient, realmManagementClient] = await Promise.all([
    getClientByClientId(botClientId),
    getClientByClientId(BOT_OBO_AUDIENCE_CLIENT_ID),
    getClientByClientId("realm-management"),
  ]);

  if (!botClient) {
    throw new Error(`Keycloak bot client "${botClientId}" not found`);
  }
  if (!oboAudienceClient) {
    throw new Error(`Keycloak audience client "${BOT_OBO_AUDIENCE_CLIENT_ID}" not found`);
  }
  if (!realmManagementClient) {
    throw new Error('Keycloak client "realm-management" not found');
  }

  const [botPerms, oboAudiencePerms, usersPerms] = await Promise.all([
    enableClientManagementPermissions(botClient.id, botClient.clientId),
    enableClientManagementPermissions(oboAudienceClient.id, oboAudienceClient.clientId).catch(() =>
      readClientManagementPermissions(oboAudienceClient.id, oboAudienceClient.clientId)
    ),
    enableUsersManagementPermissions(),
  ]);

  const botTokenExchangePermissionId = botPerms.scopePermissions?.["token-exchange"];
  const oboAudienceTokenExchangePermissionId =
    oboAudiencePerms.scopePermissions?.["token-exchange"];
  const usersImpersonatePermissionId = usersPerms.scopePermissions?.impersonate;
  if (!botTokenExchangePermissionId) {
    throw new Error(`Keycloak client "${botClientId}" has no token-exchange permission`);
  }
  if (!oboAudienceTokenExchangePermissionId) {
    throw new Error(
      `Keycloak client "${BOT_OBO_AUDIENCE_CLIENT_ID}" has no token-exchange permission`
    );
  }
  if (!usersImpersonatePermissionId) {
    throw new Error("Keycloak users impersonate permission is not enabled");
  }

  const policy = await ensureClientPolicy(
    realmManagementClient.id,
    policyName,
    `Allows ${botClientId} to perform token exchange / OBO impersonation.`,
    botClient.id
  );

  await Promise.all([
    attachPolicyToScopePermission(
      realmManagementClient.id,
      botTokenExchangePermissionId,
      policy.id
    ),
    attachPolicyToScopePermission(
      realmManagementClient.id,
      usersImpersonatePermissionId,
      policy.id
    ),
    attachPolicyToScopePermission(
      realmManagementClient.id,
      oboAudienceTokenExchangePermissionId,
      policy.id
    ),
  ]);
}

export async function ensureSlackBotOboPermissions(): Promise<void> {
  return ensureBotOboPermissions(SLACK_BOT_CLIENT_ID, "caipe-slack-bot-token-exchange");
}

/**
 * Idempotently repairs the Keycloak token-exchange permissions required for
 * the Webex bot to mint user-scoped tokens whose target audience is the
 * CAIPE UI BFF resource server (`caipe-platform` by default).
 *
 * Keycloak authorizes token exchange on the target audience client. Enabling
 * management permissions on `caipe-webex-bot` is not enough; the Webex bot's
 * client policy must also be attached to the target audience client's
 * token-exchange scope permission.
 */
export async function ensureWebexBotOboPermissions(): Promise<void> {
  return ensureBotOboPermissions(WEBEX_BOT_CLIENT_ID, "caipe-webex-bot-token-exchange");
}

export async function ensureCaipePlatformTokenExchangeDecisionStrategy(
  decisionStrategy: "AFFIRMATIVE" | "UNANIMOUS" = "AFFIRMATIVE"
): Promise<void> {
  const [oboAudienceClient, realmManagementClient] = await Promise.all([
    getClientByClientId(BOT_OBO_AUDIENCE_CLIENT_ID),
    getClientByClientId("realm-management"),
  ]);
  if (!oboAudienceClient) {
    throw new Error(`Keycloak audience client "${BOT_OBO_AUDIENCE_CLIENT_ID}" not found`);
  }
  if (!realmManagementClient) {
    throw new Error('Keycloak client "realm-management" not found');
  }
  const perms = await enableClientManagementPermissions(
    oboAudienceClient.id,
    oboAudienceClient.clientId
  ).catch(() => readClientManagementPermissions(oboAudienceClient.id, oboAudienceClient.clientId));
  const tokenExchangePermissionId = perms.scopePermissions?.["token-exchange"];
  if (!tokenExchangePermissionId) {
    throw new Error(
      `Keycloak client "${BOT_OBO_AUDIENCE_CLIENT_ID}" has no token-exchange permission`
    );
  }
  await setScopePermissionDecisionStrategy(
    realmManagementClient.id,
    tokenExchangePermissionId,
    decisionStrategy
  );
}

export async function ensureBotServiceAccountImpersonationRoles(
  botClientIds: string[] = [SLACK_BOT_CLIENT_ID, WEBEX_BOT_CLIENT_ID]
): Promise<void> {
  const realmManagementClient = await getClientByClientId("realm-management");
  if (!realmManagementClient) {
    throw new Error('Keycloak client "realm-management" not found');
  }
  const roleResponse = await adminFetch(
    `/clients/${encodeURIComponent(realmManagementClient.id)}/roles/impersonation`,
    { method: "GET" }
  );
  await assertOk(roleResponse, "getRealmManagementImpersonationRole");
  const impersonationRole = (await roleResponse.json()) as KeycloakRole;

  for (const botClientId of botClientIds) {
    const botClient = await getClientByClientId(botClientId);
    if (!botClient) {
      throw new Error(`Keycloak bot client "${botClientId}" not found`);
    }
    const serviceAccountResponse = await adminFetch(
      `/clients/${encodeURIComponent(botClient.id)}/service-account-user`,
      { method: "GET" }
    );
    await assertOk(serviceAccountResponse, `getServiceAccountUser(${botClientId})`);
    const serviceAccount = (await serviceAccountResponse.json()) as { id?: string };
    if (!serviceAccount.id) {
      throw new Error(`Keycloak bot client "${botClientId}" service account has no id`);
    }
    const mappingsPath = `/users/${encodeURIComponent(serviceAccount.id)}/role-mappings/clients/${encodeURIComponent(realmManagementClient.id)}`;
    const currentResponse = await adminFetch(mappingsPath, { method: "GET" });
    await assertOk(currentResponse, `listServiceAccountRoleMappings(${botClientId})`);
    const current = await parseJsonArray<KeycloakRole>(currentResponse);
    if (current.some((role) => role.name === "impersonation")) continue;
    const assignResponse = await adminFetch(mappingsPath, {
      method: "POST",
      body: JSON.stringify([{ id: impersonationRole.id, name: impersonationRole.name }]),
    });
    await assertOk(assignResponse, `assignServiceAccountImpersonation(${botClientId})`);
  }
}

async function serviceAccountRoleValues(
  botClientId: string,
  realmManagementClient: KeycloakClient
): Promise<KeycloakRbacDiagnosticValues["bot_service_accounts"][number]> {
  const botClient = await getClientByClientId(botClientId);
  if (!botClient) {
    return {
      client_id: botClientId,
      service_account_id: "missing client",
      realm_management_roles: [],
      impersonation_role_assigned: false,
    };
  }
  const serviceAccountResponse = await adminFetch(
    `/clients/${encodeURIComponent(botClient.id)}/service-account-user`,
    { method: "GET" }
  );
  await assertOk(serviceAccountResponse, `inspectServiceAccountUser(${botClientId})`);
  const serviceAccount = (await serviceAccountResponse.json()) as { id?: string };
  if (!serviceAccount.id) {
    return {
      client_id: botClientId,
      service_account_id: "missing service account id",
      realm_management_roles: [],
      impersonation_role_assigned: false,
    };
  }
  const mappingsPath = `/users/${encodeURIComponent(serviceAccount.id)}/role-mappings/clients/${encodeURIComponent(realmManagementClient.id)}`;
  const currentResponse = await adminFetch(mappingsPath, { method: "GET" });
  await assertOk(currentResponse, `inspectServiceAccountRoleMappings(${botClientId})`);
  const current = await parseJsonArray<KeycloakRole>(currentResponse);
  const roles = current.map((role) => role.name).filter(Boolean).sort();
  return {
    client_id: botClientId,
    service_account_id: serviceAccount.id,
    realm_management_roles: roles,
    impersonation_role_assigned: roles.includes("impersonation"),
  };
}

/**
 * Read the Keycloak-side values managed by the RBAC reconciler. This is used
 * by the admin diagnostics UI and intentionally avoids mutating Keycloak.
 */
export async function getKeycloakRbacDiagnosticValues(): Promise<KeycloakRbacDiagnosticValues> {
  const [slackBotClient, webexBotClient, oboAudienceClient, realmManagementClient] =
    await Promise.all([
      getClientByClientId(SLACK_BOT_CLIENT_ID),
      getClientByClientId(WEBEX_BOT_CLIENT_ID),
      getClientByClientId(BOT_OBO_AUDIENCE_CLIENT_ID),
      getClientByClientId("realm-management"),
    ]);
  // One resolver instance per inspection — every `readScopePermissionDetails`
  // call below shares the same UUID→clientId map, so we only touch the
  // /clients registry once per probe even when N policies need hydrating.
  const resolveClientId = createClientUuidResolver();
  // Per-bot client `token-exchange` scope-permissions live on each
  // bot's *own* client (not on the audience). We inspect both so the
  // invariant evaluator can flag UNANIMOUS-with-multiple-policies on
  // either one — that's the exact failure mode that caused the
  // "client not allowed to exchange" outage we surfaced via this UI.
  const slackBotTokenExchangePerm =
    slackBotClient
      ? (await readClientManagementPermissions(slackBotClient.id, slackBotClient.clientId).catch(
          () => null
        ))?.scopePermissions?.["token-exchange"]
      : undefined;
  const webexBotTokenExchangePerm =
    webexBotClient
      ? (await readClientManagementPermissions(webexBotClient.id, webexBotClient.clientId).catch(
          () => null
        ))?.scopePermissions?.["token-exchange"]
      : undefined;
  const slackBotTokenExchangeDetails =
    realmManagementClient && slackBotTokenExchangePerm
      ? await readScopePermissionDetails(
          realmManagementClient.id,
          slackBotTokenExchangePerm,
          resolveClientId
        ).catch(() => null)
      : null;
  const webexBotTokenExchangeDetails =
    realmManagementClient && webexBotTokenExchangePerm
      ? await readScopePermissionDetails(
          realmManagementClient.id,
          webexBotTokenExchangePerm,
          resolveClientId
        ).catch(() => null)
      : null;
  const teamScopes = (await listClientScopes())
    .filter((scope) => scope.name.startsWith("team-"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [slackOptionalScopes, webexOptionalScopes, audienceDefaultScopes] = await Promise.all([
    slackBotClient ? listOptionalClientScopes(slackBotClient.id) : Promise.resolve([]),
    webexBotClient ? listOptionalClientScopes(webexBotClient.id) : Promise.resolve([]),
    oboAudienceClient ? listDefaultClientScopes(oboAudienceClient.id) : Promise.resolve([]),
  ]);
  const slackOptionalNames = new Set(slackOptionalScopes.map((scope) => scope.name));
  const webexOptionalNames = new Set(webexOptionalScopes.map((scope) => scope.name));
  const audienceDefaultNames = new Set(audienceDefaultScopes.map((scope) => scope.name));

  const teamScopeValues = await Promise.all(
    teamScopes.map(async (scope) => {
      const mappers = await listProtocolMappers(scope.id);
      const activeTeamMapper = mappers.find(
        (mapper) => mapper.config?.["claim.name"] === "active_team"
      );
      return {
        scope: scope.name,
        scope_id: scope.id,
        active_team: activeTeamMapper?.config?.["claim.value"] ?? "missing",
        active_team_mapper: activeTeamMapper?.name ?? "missing",
        optional_on_slack_bot: slackOptionalNames.has(scope.name),
        optional_on_webex_bot: webexOptionalNames.has(scope.name),
        default_on_obo_audience: audienceDefaultNames.has(scope.name),
      };
    })
  );

  const tokenExchangePermissionId =
    oboAudienceClient
      ? (await readClientManagementPermissions(
          oboAudienceClient.id,
          oboAudienceClient.clientId
        ).catch(() => null))?.scopePermissions?.["token-exchange"]
      : undefined;
  const usersImpersonatePermissionId = await getUsersImpersonatePermissionId().catch(() => null);
  const tokenExchangeDetails =
    realmManagementClient && tokenExchangePermissionId
      ? await readScopePermissionDetails(
          realmManagementClient.id,
          tokenExchangePermissionId,
          resolveClientId
        )
      : null;
  const usersImpersonateDetails =
    realmManagementClient && usersImpersonatePermissionId
      ? await readScopePermissionDetails(
          realmManagementClient.id,
          usersImpersonatePermissionId,
          resolveClientId
        )
      : null;

  const oboPermissionRows = await Promise.all(
    [
      { clientId: SLACK_BOT_CLIENT_ID, policyName: "caipe-slack-bot-token-exchange" },
      { clientId: WEBEX_BOT_CLIENT_ID, policyName: "caipe-webex-bot-token-exchange" },
    ].map(async ({ clientId, policyName }) => {
      const policy = realmManagementClient
        ? await getClientPolicyByName(realmManagementClient.id, policyName)
        : null;
      return {
        bot_client_id: clientId,
        policy_name: policyName,
        policy_id: policy?.id ?? "missing",
        token_exchange_permission_id: tokenExchangePermissionId ?? "missing",
        token_exchange_policy_attached: Boolean(
          policy?.id && tokenExchangeDetails?.policies.some((item) => item.id === policy.id)
        ),
        users_impersonate_permission_id: usersImpersonatePermissionId ?? "missing",
        users_impersonate_policy_attached: Boolean(
          policy?.id && usersImpersonateDetails?.policies.some((item) => item.id === policy.id)
        ),
      };
    })
  );

  const serviceAccountRows = realmManagementClient
    ? await Promise.all(
        [SLACK_BOT_CLIENT_ID, WEBEX_BOT_CLIENT_ID].map((clientId) =>
          serviceAccountRoleValues(clientId, realmManagementClient)
        )
      )
    : [];

  const tokenExchangePermissionRows: KeycloakRbacDiagnosticValues["token_exchange_permissions"] = [];
  if (oboAudienceClient) {
    tokenExchangePermissionRows.push({
      client_id: oboAudienceClient.clientId,
      token_exchange_permission_id: tokenExchangePermissionId ?? "missing",
      decision_strategy: tokenExchangeDetails?.decisionStrategy ?? "missing",
      policy_names:
        tokenExchangeDetails?.policies.map((policy) => canonicalBotPolicyName(policy.name)) ?? [],
      attached_policies: tokenExchangeDetails?.policies ?? [],
    });
  }
  if (slackBotClient) {
    tokenExchangePermissionRows.push({
      client_id: slackBotClient.clientId,
      token_exchange_permission_id: slackBotTokenExchangePerm ?? "missing",
      decision_strategy: slackBotTokenExchangeDetails?.decisionStrategy ?? "missing",
      policy_names:
        slackBotTokenExchangeDetails?.policies.map((policy) =>
          canonicalBotPolicyName(policy.name)
        ) ?? [],
      attached_policies: slackBotTokenExchangeDetails?.policies ?? [],
    });
  }
  if (webexBotClient) {
    tokenExchangePermissionRows.push({
      client_id: webexBotClient.clientId,
      token_exchange_permission_id: webexBotTokenExchangePerm ?? "missing",
      decision_strategy: webexBotTokenExchangeDetails?.decisionStrategy ?? "missing",
      policy_names:
        webexBotTokenExchangeDetails?.policies.map((policy) =>
          canonicalBotPolicyName(policy.name)
        ) ?? [],
      attached_policies: webexBotTokenExchangeDetails?.policies ?? [],
    });
  }

  return {
    team_scopes: teamScopeValues,
    obo_permissions: oboPermissionRows,
    bot_service_accounts: serviceAccountRows,
    token_exchange_permissions: tokenExchangePermissionRows,
    users_impersonate_permission:
      usersImpersonatePermissionId && usersImpersonateDetails
        ? {
            permission_id: usersImpersonatePermissionId,
            decision_strategy: usersImpersonateDetails.decisionStrategy ?? "missing",
            attached_policies: usersImpersonateDetails.policies,
          }
        : usersImpersonatePermissionId
          ? {
              permission_id: usersImpersonatePermissionId,
              decision_strategy: "missing",
              attached_policies: [],
            }
          : undefined,
    active_team_defaults: oboAudienceClient
      ? [
          {
            audience_client_id: oboAudienceClient.clientId,
            default_team_scopes: audienceDefaultScopes
              .map((scope) => scope.name)
              .filter((name) => name.startsWith("team-"))
              .sort(),
          },
        ]
      : [],
  };
}

/**
 * Idempotently remove a team scope. Unbinds from the bot client first, then
 * deletes the scope itself. Safe if the scope is already missing.
 */
export async function deleteTeamClientScope(slug: string): Promise<void> {
  if (!isValidTeamSlug(slug)) {
    // If the slug is invalid we can't have created a scope for it; nothing to do.
    return;
  }
  // Guard rail: never let team deletion remove the structural `team-personal`
  // scope (the DM-mode marker is provisioned at realm bootstrap, not by team
  // CRUD). If a maintainer renames a team to `personal` we want this to be a
  // visible no-op, not a quiet wipe of personal-mode wiring.
  if (isPersonalTeamSlug(slug)) {
    console.warn(
      `[keycloak-admin] Refusing to delete reserved scope "${PERSONAL_TEAM_SCOPE_NAME}" via deleteTeamClientScope`
    );
    return;
  }
  const scopeName = `team-${slug}`;
  const scope = await getClientScopeByName(scopeName);
  if (!scope) return;

  const [slackBotClient, webexBotClient, oboAudienceClient] = await Promise.all([
    getClientByClientId(SLACK_BOT_CLIENT_ID),
    getClientByClientId(WEBEX_BOT_CLIENT_ID),
    getClientByClientId(BOT_OBO_AUDIENCE_CLIENT_ID),
  ]);
  if (slackBotClient) {
    await unbindOptionalScope(slackBotClient.id, scope.id);
  }
  if (webexBotClient) {
    // Slack/Webex symmetry: previous implementations only unbound from Slack,
    // leaving an orphan optional binding on the Webex bot that the next
    // reconcile pass had to clean up. Unbind both sides as part of the delete.
    await unbindOptionalScope(webexBotClient.id, scope.id);
  }
  if (oboAudienceClient) {
    await unbindDefaultScope(oboAudienceClient.id, scope.id);
  }
  await deleteClientScope(scope.id);
}

function readAttributeValue(attrs: unknown, attributeName: string): string | undefined {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return undefined;
  const values = (attrs as Record<string, unknown>)[attributeName];
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const first = values[0];
  return typeof first === "string" && first.trim() ? first.trim() : undefined;
}

/**
 * Returns the Keycloak user id that currently owns `attributeValue` for `attributeName`, if any.
 */
export async function findRealmUserIdByAttribute(
  attributeName: string,
  attributeValue: string
): Promise<string | null> {
  const trimmed = attributeValue.trim();
  if (!trimmed) return null;

  const q = `${attributeName}:${trimmed}`;
  const response = await adminFetch(
    `/users?q=${encodeURIComponent(q)}&max=5`,
    { method: "GET" }
  );
  await assertOk(response, `findRealmUserIdByAttribute(${attributeName})`);
  const users = await parseJsonArray<Record<string, unknown>>(response);

  for (const user of users) {
    const value = readAttributeValue(user.attributes, attributeName);
    if (value !== trimmed) continue;
    const id = user.id;
    if (id !== undefined && id !== null) {
      return String(id);
    }
  }
  return null;
}
