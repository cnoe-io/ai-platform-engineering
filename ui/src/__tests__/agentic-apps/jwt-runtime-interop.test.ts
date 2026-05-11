/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 *
 * The standalone sample apps verify CAIPE app-scoped Bearer tokens.
 */

import { mintAppScopedToken } from "@/lib/agentic-apps/tokens";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- mjs import from CJS test runner
const { createAgenticAppJwtVerifier } = require("../../../apps/_lib/jwt-verify.mjs");

async function signAppToken(input: {
  appId?: string;
  subject?: string;
  email?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const minted = await mintAppScopedToken({
    appId: input.appId ?? "weather",
    subject: input.subject ?? "subject-from-caipe",
    email: input.email ?? "user@example.com",
    scopes: ["weather:read"],
    decisionId: "decision-1",
    ttlSeconds: input.ttlSeconds,
  });
  return minted.token;
}

describe("JWT verify interop between CAIPE gateway and sample runtimes", () => {
  const issuer = "caipe-agentic-apps";
  const audience = "agentic-app:weather";
  const secret = "test-agentic-app-token-secret";
  const originalEnv = process.env;

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    process.env = { ...originalEnv, AGENTIC_APP_TOKEN_SECRET: secret };
  });

  it("verifies a token forwarded by the gateway and exposes claims as identity", async () => {
    const token = await signAppToken({
      subject: "subject-from-caipe",
      email: "alice@example.com",
    });

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      audience,
      secret,
    });

    const result = await verify({ authorization: `Bearer ${token}` });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.subject).toBe("subject-from-caipe");
      expect(result.identity.email).toBe("alice@example.com");
      expect(result.identity.audience).toBe(audience);
      expect(result.identity.issuer).toBe(issuer);
      expect(result.identity.appId).toBe("weather");
      expect(result.identity.scopes).toEqual(["weather:read"]);
    }
  });

  it("rejects a request with no Authorization header", async () => {
    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      audience,
      secret,
    });

    const result = await verify({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("missing_authorization");
    }
  });

  it("rejects a token with a bad signature (signed by a different key)", async () => {
    process.env.AGENTIC_APP_TOKEN_SECRET = "different-signing-secret";
    const tamperedToken = await signAppToken({ subject: "attacker" });
    process.env.AGENTIC_APP_TOKEN_SECRET = secret;

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      audience,
      secret,
    });

    const result = await verify({ authorization: `Bearer ${tamperedToken}` });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a token whose audience does not match the configured value", async () => {
    const token = await signAppToken({ appId: "weather" });

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      audience: "some-other-app",
      secret,
    });

    const result = await verify({ authorization: `Bearer ${token}` });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("claim_invalid");
    }
  });

  it("rejects an expired token", async () => {
    const token = await signAppToken({ ttlSeconds: -60 });

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      audience,
      secret,
      clockTolerance: 0,
    });

    const result = await verify({ authorization: `Bearer ${token}` });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("supports development-only skipVerify by decoding without signature checks", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const token = await signAppToken({ subject: "subject-from-caipe" });

      const verify = createAgenticAppJwtVerifier({
        appId: "weather",
        skipVerify: true,
      });

      const result = await verify({ authorization: `Bearer ${token}` });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity.subject).toBe("subject-from-caipe");
      }
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("refuses skipVerify in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        createAgenticAppJwtVerifier({ appId: "weather", skipVerify: true }),
      ).toThrow(/forbidden in production/);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
