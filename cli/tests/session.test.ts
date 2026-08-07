import { describe, expect, it } from "vitest";

import {
  claimsFromOAuthTokenResponse,
  displayIdentity,
  enrichTokenSet,
  hasRecognizedIdentity,
  isAuthenticatedSession,
} from "../src/auth/session";
import { isExpired } from "../src/auth/tokens";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("enrichTokenSet", () => {
  it("fills identity from access token JWT when stored fields are empty", () => {
    const accessToken = fakeJwt({
      sub: "user-123",
      preferred_username: "alice",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const enriched = enrichTokenSet({ accessToken });
    expect(enriched.identity).toBe("user-123");
    expect(enriched.displayName).toBe("alice");
    expect(enriched.accessTokenExpiry).toBeDefined();
  });
});

describe("claimsFromOAuthTokenResponse", () => {
  it("prefers id_token but falls back to access_token", () => {
    const accessToken = fakeJwt({ sub: "from-access" });
    const idToken = fakeJwt({ sub: "from-id", name: "Bob" });
    const claims = claimsFromOAuthTokenResponse({ access_token: accessToken, id_token: idToken });
    expect(claims.identity).toBe("from-id");
    expect(claims.displayName).toBe("Bob");
  });
});

describe("isAuthenticatedSession", () => {
  it("returns false when identity is unknown even if token is not expired", () => {
    const tokens = enrichTokenSet({
      accessToken: "opaque-not-a-jwt",
      accessTokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(hasRecognizedIdentity(tokens)).toBe(false);
    expect(isAuthenticatedSession(tokens, isExpired)).toBe(false);
  });

  it("returns true when JWT carries identity and is not expired", () => {
    const accessToken = fakeJwt({
      sub: "user@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const tokens = enrichTokenSet({ accessToken });
    expect(isAuthenticatedSession(tokens, isExpired)).toBe(true);
    expect(displayIdentity(tokens)).toBe("user@example.com");
  });
});
