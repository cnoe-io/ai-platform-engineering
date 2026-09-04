import { jwtVerify } from "jose";

import {
  buildTomeOidcAuth,
  createTomeOidcProof,
  isTomeSecondaryOidcConfigured,
  isValidTomeOidcProof,
  resetTomeSecondaryOidcJWTCache,
  validateTomeSecondaryOidcJWT,
} from "@/lib/tome/oidc-jwt";

const mockJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn().mockReturnValue("mock-secondary-oidc-jwks"),
  jwtVerify: jest.fn(),
}));

describe("TOME secondary OIDC JWT validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TOME_MCP_SECONDARY_OIDC_JWKS_URI = "https://identity.example.test/oauth2/keys";
    process.env.TOME_MCP_SECONDARY_OIDC_ISSUER = "https://identity.example.test/oauth2";
    process.env.TOME_MCP_SECONDARY_OIDC_AUDIENCES = "tome-api, mcp";
    process.env.TOME_MCP_INTERNAL_AUTH_SECRET = "internal-test-secret";
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "secondary-subject",
        email: "user@example.test",
        name: "Example User",
        groups: ["member"],
        iss: "https://identity.example.test/oauth2",
        aud: ["tome-api"],
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      protectedHeader: { alg: "RS256" },
    } as Awaited<ReturnType<typeof jwtVerify>>);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetTomeSecondaryOidcJWTCache();
    mockJwtVerify.mockReset();
  });

  it("requires all three secondary OIDC trust settings", () => {
    delete process.env.TOME_MCP_SECONDARY_OIDC_AUDIENCES;

    expect(isTomeSecondaryOidcConfigured).toThrow(/must all be configured/);
  });

  it("accepts the deprecated provider-specific aliases during migration", async () => {
    delete process.env.TOME_MCP_SECONDARY_OIDC_JWKS_URI;
    delete process.env.TOME_MCP_SECONDARY_OIDC_ISSUER;
    delete process.env.TOME_MCP_SECONDARY_OIDC_AUDIENCES;
    process.env.TOME_MCP_CIRCUIT_JWKS_URI = "https://identity.example.test/oauth2/keys";
    process.env.TOME_MCP_CIRCUIT_ISSUER = "https://identity.example.test/oauth2";
    process.env.TOME_MCP_CIRCUIT_AUDIENCES = "tome-api";

    expect(isTomeSecondaryOidcConfigured()).toBe(true);
    await validateTomeSecondaryOidcJWT("oidc-token");

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "oidc-token",
      "mock-secondary-oidc-jwks",
      expect.objectContaining({
        issuer: "https://identity.example.test/oauth2",
        audience: ["tome-api"],
      }),
    );
  });

  it("validates issuer, audience, and required expiration locally", async () => {
    const identity = await validateTomeSecondaryOidcJWT("oidc-token");

    expect(identity).toMatchObject({
      sub: "secondary-subject",
      email: "user@example.test",
      name: "Example User",
      groups: ["member"],
    });
    expect(mockJwtVerify).toHaveBeenCalledWith(
      "oidc-token",
      "mock-secondary-oidc-jwks",
      expect.objectContaining({
        issuer: "https://identity.example.test/oauth2",
        audience: ["tome-api", "mcp"],
        requiredClaims: ["iss", "aud", "exp"],
      }),
    );
  });

  it("binds the internal forwarding proof to the exact token", () => {
    const proof = createTomeOidcProof("oidc-token");

    expect(isValidTomeOidcProof("oidc-token", proof)).toBe(true);
    expect(isValidTomeOidcProof("different-token", proof)).toBe(false);
    expect(isValidTomeOidcProof("oidc-token", "forged-proof")).toBe(false);
  });

  it("builds an OpenFGA-compatible user session from the verified sub", () => {
    const result = buildTomeOidcAuth("oidc-token", {
      email: "user@example.test",
      name: "Example User",
      groups: [],
      sub: "secondary-subject",
    });

    expect(result).toMatchObject({
      user: { email: "user@example.test", name: "Example User", role: "user" },
      session: {
        accessToken: "oidc-token",
        principalType: "oidc_user",
        authMethod: "bearer",
        sub: "secondary-subject",
      },
    });
    expect(result.session.tomeOidcProof).toEqual(expect.any(String));
  });
});
