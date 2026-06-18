import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import {
  getCredentialFeatureConfig,
  isCredentialFeatureEnabled,
  isServiceAccountTokensEnabled,
  isUserConnectionsEnabled,
} from "../credentials";

const ORIGINAL_ENV = process.env;

function resetEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env = { ...ORIGINAL_ENV, ...overrides };
  delete process.env.CAIPE_CREDENTIALS_ENABLED;
  delete process.env.CREDENTIAL_STORE_BACKEND;
  delete process.env.CREDENTIAL_KEY_PROVIDER;
  delete process.env.CREDENTIAL_KMS_CMK_ID;
  delete process.env.CREDENTIAL_KMS_REGION;
  delete process.env.CREDENTIAL_SERVICE_AUDIENCE;
  delete process.env.CAIPE_USER_CONNECTIONS_ENABLED;
  delete process.env.CAIPE_SERVICE_ACCOUNT_TOKENS_ENABLED;

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

describe("credential sub-surface flags (Connections vs SA Tokens)", () => {
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    resetEnv();
  });

  it("both sub-surfaces are off when the master flag is off, regardless of sub-flag", () => {
    resetEnv({
      CAIPE_CREDENTIALS_ENABLED: "false",
      CAIPE_USER_CONNECTIONS_ENABLED: "true",
      CAIPE_SERVICE_ACCOUNT_TOKENS_ENABLED: "true",
    });
    // A sub-flag can never be on when the subsystem master is off.
    expect(isUserConnectionsEnabled()).toBe(false);
    expect(isServiceAccountTokensEnabled()).toBe(false);
  });

  it("both sub-surfaces inherit the master flag when their sub-flags are unset", () => {
    resetEnv({ CAIPE_CREDENTIALS_ENABLED: "true" });
    expect(isUserConnectionsEnabled()).toBe(true);
    expect(isServiceAccountTokensEnabled()).toBe(true);
  });

  it("hides user Connections independently while keeping SA Tokens on", () => {
    resetEnv({
      CAIPE_CREDENTIALS_ENABLED: "true",
      CAIPE_USER_CONNECTIONS_ENABLED: "false",
      // SA tokens flag unset → inherits master (on)
    });
    expect(isUserConnectionsEnabled()).toBe(false);
    expect(isServiceAccountTokensEnabled()).toBe(true);
  });

  it("hides SA Tokens independently while keeping user Connections on", () => {
    resetEnv({
      CAIPE_CREDENTIALS_ENABLED: "true",
      CAIPE_SERVICE_ACCOUNT_TOKENS_ENABLED: "false",
    });
    expect(isServiceAccountTokensEnabled()).toBe(false);
    expect(isUserConnectionsEnabled()).toBe(true);
  });
});
