/**
 * Persona token fixture (TypeScript side) — spec 102 `data-model.md` §E5.
 *
 * Parity with `tests/rbac/fixtures/keycloak.py`. Tested by T031 in
 * `tests/rbac/unit/py/test_persona_parity.py`.
 *
 * Mints real Keycloak access tokens for the six personas defined in
 * `spec.md` §Personas. Resource Owner Password Credentials grant is enabled
 * ONLY on the test client `caipe-platform`
 * (`directAccessGrantsEnabled: true` in `deploy/keycloak/realm-config.json`).
 */

export type PersonaName =
  | "alice_admin"
  | "bob_chat_user"
  | "carol_kb_ingestor"
  | "dave_no_role"
  | "eve_dynamic_agent_user"
  | "frank_service_account";

export const PERSONAS: readonly PersonaName[] = [
  "alice_admin",
  "bob_chat_user",
  "carol_kb_ingestor",
  "dave_no_role",
  "eve_dynamic_agent_user",
  "frank_service_account",
] as const;

export interface PersonaToken {
  accessToken: string;
  refreshToken: string;
  decodedClaims: Record<string, unknown>;
  expiresAt: number; // unix seconds
}

const REFRESH_SLACK_S = 30;
const DEFAULT_PASSWORD = "test-password-123"; // test-only — never used in prod

const cache = new Map<PersonaName, PersonaToken>();

function kcBaseUrl(): string {
  return (process.env.KEYCLOAK_URL ?? "http://localhost:7080").replace(/\/$/, "");
}

function kcRealm(): string {
  return process.env.KEYCLOAK_REALM ?? "caipe";
}

function kcClientId(): string {
  return process.env.KEYCLOAK_TEST_CLIENT_ID ?? "caipe-platform";
}

function kcClientSecret(): string {
  return process.env.KEYCLOAK_TEST_CLIENT_SECRET ?? "caipe-platform-dev-secret";
}

function personaPassword(name: PersonaName): string {
  const envVar = `${name.toUpperCase()}_PASSWORD`;
  return process.env[envVar] ?? DEFAULT_PASSWORD;
}

function decodePayloadUnsafe(token: string): Record<string, unknown> {
  // TEST FIXTURE ONLY — does not verify signature. The TS helpers in
  // `ui/src/lib/rbac/keycloak-authz.ts` perform the real validation.
  const parts = token.split(".");
  if (parts.length !== 3) return {};
  try {
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    const buf = Buffer.from(padded, "base64");
    return JSON.parse(buf.toString("utf-8"));
  } catch {
    return {};
  }
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) search.set(k, v);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: search.toString(),
  });
}

async function mintPasswordGrant(name: PersonaName): Promise<PersonaToken> {
  const url = `${kcBaseUrl()}/realms/${kcRealm()}/protocol/openid-connect/token`;
  const resp = await postForm(url, {
    grant_type: "password",
    client_id: kcClientId(),
    client_secret: kcClientSecret(),
    username: name,
    password: personaPassword(name),
    scope: "openid profile email",
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Keycloak token mint for persona ${name} failed: HTTP ${resp.status} — ${text.slice(0, 500)}`,
    );
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const accessToken = String(data.access_token ?? "");
  const expiresIn = Number(data.expires_in ?? 60);
  return {
    accessToken,
    refreshToken: String(data.refresh_token ?? ""),
    decodedClaims: decodePayloadUnsafe(accessToken),
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
  };
}

async function mintClientCredentials(): Promise<PersonaToken> {
  const url = `${kcBaseUrl()}/realms/${kcRealm()}/protocol/openid-connect/token`;
  const resp = await postForm(url, {
    grant_type: "client_credentials",
    client_id: kcClientId(),
    client_secret: kcClientSecret(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Keycloak client_credentials mint failed: HTTP ${resp.status} — ${text.slice(0, 500)}`,
    );
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const accessToken = String(data.access_token ?? "");
  const expiresIn = Number(data.expires_in ?? 60);
  return {
    accessToken,
    refreshToken: String(data.refresh_token ?? ""),
    decodedClaims: decodePayloadUnsafe(accessToken),
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
  };
}

export async function getPersonaToken(name: PersonaName): Promise<PersonaToken> {
  if (!PERSONAS.includes(name)) {
    throw new Error(`Unknown persona ${name}; expected one of ${PERSONAS.join(", ")}`);
  }
  const cached = cache.get(name);
  if (cached && cached.expiresAt - Math.floor(Date.now() / 1000) > REFRESH_SLACK_S) {
    return cached;
  }
  const minted =
    name === "frank_service_account"
      ? await mintClientCredentials()
      : await mintPasswordGrant(name);
  cache.set(name, minted);
  return minted;
}

export async function clearPersonaCache(): Promise<void> {
  cache.clear();
}
