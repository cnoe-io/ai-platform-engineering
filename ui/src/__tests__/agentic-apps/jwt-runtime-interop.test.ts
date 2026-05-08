/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 *
 * The standalone sample apps verify the user's OIDC id_token against the
 * configured JWKS endpoint. This suite wires the gateway's contract — a
 * Bearer JWT — to the runtime verifier in ui/apps/_lib/jwt-verify.mjs and
 * confirms that valid tokens are accepted and tampered tokens are rejected.
 */

import { generateKeyPair, exportJWK, SignJWT } from "jose";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- mjs import from CJS test runner
const { createAgenticAppJwtVerifier } = require("../../../apps/_lib/jwt-verify.mjs");

interface JwkWithMeta extends Record<string, unknown> {
  kid: string;
  alg: string;
  use: string;
}

interface KeyFixture {
  privateKey: CryptoKey;
  publicJwk: JwkWithMeta;
  jwksUri: string;
  cleanup: () => void;
}

async function createKeyFixture(): Promise<KeyFixture> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as JwkWithMeta;
  publicJwk.kid = "test-kid-1";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const jwksDoc = { keys: [publicJwk] };

  const jwksUri = "https://idp.test/realms/caipe/jwks.json";
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === jwksUri) {
      return new Response(JSON.stringify(jwksDoc), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  return {
    privateKey,
    publicJwk,
    jwksUri,
    cleanup: () => {
      global.fetch = originalFetch;
    },
  };
}

async function signIdToken(input: {
  privateKey: CryptoKey;
  audience: string;
  issuer: string;
  subject?: string;
  email?: string;
  expiresIn?: string;
}): Promise<string> {
  return new SignJWT({
    email: input.email ?? "user@example.com",
    name: "Test User",
    groups: ["users"],
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid-1" })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setSubject(input.subject ?? "subject-from-oidc")
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? "5m")
    .sign(input.privateKey);
}

describe("JWT verify interop between CAIPE gateway and sample runtimes", () => {
  const issuer = "https://idp.test/realms/caipe";
  const audience = "caipe-ui";

  let fixture: KeyFixture;

  beforeAll(async () => {
    fixture = await createKeyFixture();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  it("verifies a token forwarded by the gateway and exposes claims as identity", async () => {
    const token = await signIdToken({
      privateKey: fixture.privateKey,
      issuer,
      audience,
      subject: "subject-from-oidc",
      email: "alice@example.com",
    });

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      jwksUri: fixture.jwksUri,
      audience,
    });

    const result = await verify({ authorization: `Bearer ${token}` });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.subject).toBe("subject-from-oidc");
      expect(result.identity.email).toBe("alice@example.com");
      expect(result.identity.audience).toBe(audience);
      expect(result.identity.issuer).toBe(issuer);
    }
  });

  it("rejects a request with no Authorization header", async () => {
    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      jwksUri: fixture.jwksUri,
      audience,
    });

    const result = await verify({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("missing_authorization");
    }
  });

  it("rejects a token with a bad signature (signed by a different key)", async () => {
    const otherKey = await generateKeyPair("RS256", { extractable: true });
    const tamperedToken = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-kid-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("attacker")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(otherKey.privateKey);

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      jwksUri: fixture.jwksUri,
      audience,
    });

    const result = await verify({ authorization: `Bearer ${tamperedToken}` });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a token whose audience does not match the configured value", async () => {
    const token = await signIdToken({
      privateKey: fixture.privateKey,
      issuer,
      audience: "some-other-app",
    });

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      jwksUri: fixture.jwksUri,
      audience,
    });

    const result = await verify({ authorization: `Bearer ${token}` });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("claim_invalid");
    }
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-kid-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("subject-from-oidc")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
      .sign(fixture.privateKey);

    const verify = createAgenticAppJwtVerifier({
      appId: "weather",
      issuer,
      jwksUri: fixture.jwksUri,
      audience,
    });

    const result = await verify({ authorization: `Bearer ${token}` });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("supports development-only skipVerify by decoding without signature checks", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const token = await signIdToken({
        privateKey: fixture.privateKey,
        issuer,
        audience: "anything",
        subject: "subject-from-oidc",
      });

      const verify = createAgenticAppJwtVerifier({
        appId: "weather",
        skipVerify: true,
      });

      const result = await verify({ authorization: `Bearer ${token}` });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity.subject).toBe("subject-from-oidc");
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
