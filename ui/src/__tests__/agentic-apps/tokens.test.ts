/**
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  hashAppScopedToken,
  mintAppScopedToken,
  verifyAppScopedToken,
} from "@/lib/agentic-apps/tokens";

describe("agentic app-scoped tokens", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AGENTIC_APP_TOKEN_SECRET: "test-agentic-app-token-secret",
      AGENTIC_APP_TOKEN_ISSUER: "test-caipe",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("mints and verifies audience, app id, scopes, expiry, and decision claims", async () => {
    const minted = await mintAppScopedToken({
      appId: "finops",
      subject: "user-123",
      email: "user@example.com",
      scopes: ["finops:read"],
      decisionId: "decision-1",
      correlationId: "corr-1",
      ttlSeconds: 60,
    });

    expect(minted.audience).toBe("agentic-app:finops");
    expect(minted.tokenHash).toBe(hashAppScopedToken(minted.token));
    const verified = await verifyAppScopedToken(minted.token, "finops");
    expect(verified.app_id).toBe("finops");
    expect(verified.scp).toEqual(["finops:read"]);
    expect(verified.decision_id).toBe("decision-1");
  });

  it("rejects tokens verified for the wrong app audience", async () => {
    const minted = await mintAppScopedToken({
      appId: "finops",
      subject: "user-123",
      scopes: ["finops:read"],
      decisionId: "decision-1",
    });

    await expect(verifyAppScopedToken(minted.token, "weather")).rejects.toThrow();
  });
});
