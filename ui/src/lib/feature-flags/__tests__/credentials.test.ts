import {
  getCredentialFeatureConfig,
  isCredentialFeatureEnabled,
} from "@/lib/feature-flags/credentials";

const ORIGINAL_ENV = process.env;

function resetEnv(overrides: NodeJS.ProcessEnv = {}): void {
  process.env = { ...ORIGINAL_ENV, ...overrides };
  delete process.env.CAIPE_CREDENTIALS_ENABLED;
  delete process.env.CREDENTIAL_STORE_BACKEND;
  delete process.env.CREDENTIAL_KEY_PROVIDER;
  delete process.env.CREDENTIAL_KMS_CMK_ID;
  delete process.env.CREDENTIAL_KMS_REGION;
  delete process.env.CREDENTIAL_SERVICE_AUDIENCE;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("credential feature flags", () => {
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    resetEnv();
  });

  it("keeps Connections & Secrets disabled by default", () => {
    expect(isCredentialFeatureEnabled()).toBe(false);
    expect(getCredentialFeatureConfig()).toMatchObject({
      enabled: false,
      storeBackend: "mongodb-envelope",
      keyProvider: "local-cmk",
      cmkId: null,
      kmsRegion: null,
      serviceAudience: "caipe-credential-service",
    });
  });

  it("enables the feature only for a true value", () => {
    resetEnv({ CAIPE_CREDENTIALS_ENABLED: " true " });
    expect(isCredentialFeatureEnabled()).toBe(true);

    resetEnv({ CAIPE_CREDENTIALS_ENABLED: "1" });
    expect(isCredentialFeatureEnabled()).toBe(false);
  });

  it("reads local CMK and service audience configuration without exposing secrets", () => {
    resetEnv({
      CAIPE_CREDENTIALS_ENABLED: "true",
      CREDENTIAL_STORE_BACKEND: "mongodb-envelope",
      CREDENTIAL_KEY_PROVIDER: "local-cmk",
      CREDENTIAL_KMS_CMK_ID: "alias/caipe-local-credentials",
      CREDENTIAL_KMS_REGION: "us-west-2",
      CREDENTIAL_SERVICE_AUDIENCE: "caipe-credential-service-local",
    });

    expect(getCredentialFeatureConfig()).toEqual({
      enabled: true,
      storeBackend: "mongodb-envelope",
      keyProvider: "local-cmk",
      cmkId: "alias/caipe-local-credentials",
      kmsRegion: "us-west-2",
      serviceAudience: "caipe-credential-service-local",
    });
  });
});
