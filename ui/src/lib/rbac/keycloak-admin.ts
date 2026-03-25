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

export async function deleteIdpMapper(alias: string, mapperId: string): Promise<void> {
  console.log(`[KeycloakAdmin] deleteIdpMapper alias=${alias} mapperId=${mapperId}`);
  const encAlias = encodeURIComponent(alias);
  const encId = encodeURIComponent(mapperId);
  const response = await adminFetch(`/identity-provider/instances/${encAlias}/mappers/${encId}`, {
    method: "DELETE",
  });
  await assertOk(response, "deleteIdpMapper");
}
