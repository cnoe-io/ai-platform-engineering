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
