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
  "admin",
  "chat_user",
  "team_member",
  "kb_admin",
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
      console.warn("[KeycloakAdmin] client_credentials failed, falling back to password grant:", err);
    }
  } else {
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
// Spec 104 helpers — team-scoped RBAC role materialization.
//
// `ensureRealmRole` is idempotent: callers that need to bind a `tool_user:<id>`
// or `agent_user:<id>` role to users don't have to know whether the role
// already exists. We try to fetch first and only POST when missing because
// `createRealmRole` returns 409 on duplicates and we'd rather not log noise.
//
// `findUserIdByEmail` is a thin convenience around `searchRealmUsers` for the
// common "I have an email, give me the Keycloak `sub`" case used when
// reconciling team membership → realm-role assignments.
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

// ─────────────────────────────────────────────────────────────────────────────
// Spec 104 — per-team Keycloak client scopes for active_team claim.
//
// One client scope per team named `team-<slug>` carries a single
// `oidc-hardcoded-claim-mapper` injecting `active_team=<slug>` into the
// access token. We bind the scope BOTH as an optional scope on the
// `caipe-slack-bot` client (for code symmetry with team-personal) AND as
// a *default* scope on the `agentgateway` audience client. Keycloak's
// RFC 8693 token-exchange silently drops the `scope` request parameter,
// so the only reliable way to inject the `active_team` claim is via the
// target audience client's default scopes — see Spec 104 and the
// `_apply_active_team` comment in the slack-bot OBO module.
//
// CAVEAT: with multiple teams bound as defaults on agentgateway, every
// hardcoded mapper fires and the last one wins (mapper order is
// undefined). The bot's mismatch check (`_do_exchange`) catches this and
// rejects, but multi-team users will see denials. Follow-up work should
// switch to a script-mapper that reads the requested team from a custom
// parameter rather than per-team default scopes.
//
// All operations are idempotent so the BFF can re-run them on every
// startup as part of the team-scope auto-sync.
// ─────────────────────────────────────────────────────────────────────────────

const SLACK_BOT_CLIENT_ID =
  process.env.KEYCLOAK_BOT_CLIENT_ID?.trim() || "caipe-slack-bot";

const AGENTGATEWAY_CLIENT_ID =
  process.env.KEYCLOAK_AGENTGATEWAY_CLIENT_ID?.trim() || "agentgateway";

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
 * agentgateway audience client because Keycloak's RFC 8693 token-exchange
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
 * in JWTs, AGW logs, and CEL policies. Callers should reject invalid slugs
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

  const botClient = await getClientByClientId(SLACK_BOT_CLIENT_ID);
  if (!botClient) {
    throw new Error(
      `Keycloak bot client "${SLACK_BOT_CLIENT_ID}" not found; cannot bind team scope`
    );
  }

  let scope = await getClientScopeByName(scopeName);
  if (!scope) {
    scope = await createClientScope(scopeName, description);
  }

  await ensureHardcodedActiveTeamMapper(scope.id, `active-team-${slug}`, slug);
  await bindScopeAsOptional(botClient.id, scope.id);

  // Spec 104: bind as DEFAULT on agentgateway too. Token-exchange ignores
  // the `scope=` request parameter, so optional-on-bot alone produces a
  // token without the `active_team` claim. Default-on-audience is the only
  // wiring that actually injects the claim. Best-effort: if the
  // agentgateway client doesn't exist yet (older stack pre Spec 104), log
  // and skip rather than failing team creation entirely.
  const agwClient = await getClientByClientId(AGENTGATEWAY_CLIENT_ID);
  if (!agwClient) {
    console.warn(
      `[keycloak-admin] agentgateway client "${AGENTGATEWAY_CLIENT_ID}" not found; ` +
        `team scope "${scopeName}" will not appear in OBO tokens until you run ` +
        `init-idp.sh or create the client manually.`
    );
    return;
  }
  await bindScopeAsDefault(agwClient.id, scope.id);
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
  const scopeName = `team-${slug}`;
  const scope = await getClientScopeByName(scopeName);
  if (!scope) return;

  const botClient = await getClientByClientId(SLACK_BOT_CLIENT_ID);
  if (botClient) {
    await unbindOptionalScope(botClient.id, scope.id);
  }
  const agwClient = await getClientByClientId(AGENTGATEWAY_CLIENT_ID);
  if (agwClient) {
    await unbindDefaultScope(agwClient.id, scope.id);
  }
  await deleteClientScope(scope.id);
}
