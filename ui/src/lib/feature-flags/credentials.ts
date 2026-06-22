export type CredentialStoreBackend = "mongodb-envelope";
export type CredentialKeyProvider = "aws-kms" | "local-cmk" | "dev-local";

export interface CredentialFeatureConfig {
  enabled: boolean;
  storeBackend: CredentialStoreBackend;
  keyProvider: CredentialKeyProvider;
  cmkId: string | null;
  kmsRegion: string | null;
  serviceAudience: string;
}

const DEFAULT_STORE_BACKEND: CredentialStoreBackend = "mongodb-envelope";
const DEFAULT_KEY_PROVIDER: CredentialKeyProvider = "local-cmk";
const DEFAULT_SERVICE_AUDIENCE = "caipe-credential-service";

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function envBoolean(name: string): boolean {
  return env(name)?.toLowerCase() === "true";
}

function credentialStoreBackend(): CredentialStoreBackend {
  const value = env("CREDENTIAL_STORE_BACKEND");
  return value === "mongodb-envelope" ? value : DEFAULT_STORE_BACKEND;
}

function credentialKeyProvider(): CredentialKeyProvider {
  const value = env("CREDENTIAL_KEY_PROVIDER");
  return value === "aws-kms" || value === "local-cmk" || value === "dev-local"
    ? value
    : DEFAULT_KEY_PROVIDER;
}

export function isCredentialFeatureEnabled(): boolean {
  return envBoolean("CAIPE_CREDENTIALS_ENABLED");
}

/**
 * Read an optional boolean sub-flag that defaults to the value of the master
 * credential flag when unset. This lets a deployment turn the whole credential
 * subsystem on/off with CAIPE_CREDENTIALS_ENABLED, while still being able to
 * independently hide one surface (e.g. user Credentials) by explicitly setting
 * its sub-flag to "false". A sub-flag can never be on when the master is off —
 * the subsystem (store, key wrapper, routes) must be enabled for either surface
 * to function.
 */
function subFeatureEnabled(name: string): boolean {
  if (!isCredentialFeatureEnabled()) return false;
  const raw = env(name)?.toLowerCase();
  if (raw === undefined) return true; // inherit master (backward-compatible)
  return raw === "true";
}

/**
 * Whether the user-facing Credentials surface (the /credentials
 * page + the Credentials nav link) is enabled. Independent of the
 * service-account token surface so a deployment without registered OAuth apps
 * can hide user credentials while still letting service accounts hold PATs.
 * Env: CAIPE_USER_CONNECTIONS_ENABLED (defaults to the master flag).
 */
export function isUserConnectionsEnabled(): boolean {
  return subFeatureEnabled("CAIPE_USER_CONNECTIONS_ENABLED");
}

/**
 * Whether the service-account Tokens surface (the SA Tokens section + its
 * token-providers / [id]/credentials routes) is enabled. Independent of the
 * user Credentials surface.
 * Env: CAIPE_SERVICE_ACCOUNT_TOKENS_ENABLED (defaults to the master flag).
 */
export function isServiceAccountTokensEnabled(): boolean {
  return subFeatureEnabled("CAIPE_SERVICE_ACCOUNT_TOKENS_ENABLED");
}

export function getCredentialFeatureConfig(): CredentialFeatureConfig {
  return {
    enabled: isCredentialFeatureEnabled(),
    storeBackend: credentialStoreBackend(),
    keyProvider: credentialKeyProvider(),
    cmkId: env("CREDENTIAL_KMS_CMK_ID"),
    kmsRegion: env("CREDENTIAL_KMS_REGION"),
    serviceAudience: env("CREDENTIAL_SERVICE_AUDIENCE") ?? DEFAULT_SERVICE_AUDIENCE,
  };
}
