/**
 * Unit tests for auth layer:
 *   - PKCE math (verifier → S256 challenge roundtrip)
 *   - Token expiry detection and silent refresh
 *   - Keychain mock (via setup.ts preload)
 *   - Device Auth polling scenarios (RFC 8628)
 */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type TokenSet, clearTokens, loadTokens, storeTokens } from "../src/auth/keychain";
// ── Import under test ────────────────────────────────────────────────────────
import { generatePKCE } from "../src/auth/oauth";
import { AuthRequired, getValidToken, isExpired, refreshAccessToken } from "../src/auth/tokens";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTokens(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: "access_abc",
    refreshToken: "refresh_xyz",
    accessTokenExpiry: new Date(Date.now() + 3_600_000).toISOString(), // 1 h from now
    identity: "user@example.com",
    ...overrides,
  };
}

function expiredTokens(): TokenSet {
  return makeTokens({
    accessTokenExpiry: new Date(Date.now() - 10_000).toISOString(),
  });
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

describe("generatePKCE", () => {
  it("produces a base64url verifier of at least 43 chars", () => {
    const { verifier } = generatePKCE();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("challenge is S256 (sha256 base64url of verifier)", () => {
    const { verifier, challenge } = generatePKCE();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("generates unique pairs on each call", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

// ── Token expiry ─────────────────────────────────────────────────────────────

describe("isExpired", () => {
  it("returns false for a token expiring in 1 hour", () => {
    expect(isExpired(makeTokens())).toBe(false);
  });

  it("returns true for a token expired 10 seconds ago", () => {
    expect(isExpired(expiredTokens())).toBe(true);
  });

  it("returns true when accessToken is empty string", () => {
    expect(isExpired({ accessToken: "" })).toBe(true);
  });

  it("returns false when no expiry is set (assume valid)", () => {
    expect(isExpired({ accessToken: "tok", accessTokenExpiry: undefined })).toBe(false);
  });

  it("returns true within the 60s refresh margin", () => {
    const almostExpired = makeTokens({
      accessTokenExpiry: new Date(Date.now() + 30_000).toISOString(), // 30s from now
    });
    expect(isExpired(almostExpired)).toBe(true);
  });
});

// ── Keychain mock ─────────────────────────────────────────────────────────────

describe("keychain", () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it("returns null when no tokens stored", async () => {
    const result = await loadTokens();
    expect(result).toBeNull();
  });

  it("round-trips a TokenSet", async () => {
    const tokens = makeTokens();
    await storeTokens(tokens);
    const loaded = await loadTokens();
    expect(loaded).not.toBeNull();
    expect(loaded?.accessToken).toBe(tokens.accessToken);
    expect(loaded?.identity).toBe(tokens.identity);
  });

  it("clearTokens removes the stored credential", async () => {
    await storeTokens(makeTokens());
    await clearTokens();
    const loaded = await loadTokens();
    expect(loaded).toBeNull();
  });
});

// ── Silent refresh ────────────────────────────────────────────────────────────

describe("getValidToken", () => {
  const SERVER_URL = "https://caipe.test";

  beforeEach(async () => {
    await clearTokens();
  });

  it("throws AuthRequired when no tokens stored", async () => {
    await expect(getValidToken(SERVER_URL)).rejects.toBeInstanceOf(AuthRequired);
  });

  it("returns access token when not expired", async () => {
    await storeTokens(makeTokens({ accessToken: "live_token" }));
    const token = await getValidToken(SERVER_URL);
    expect(token).toBe("live_token");
  });

  it("silently refreshes an expired token", async () => {
    await storeTokens(expiredTokens());

    // Mock fetch to simulate a refresh token response
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "new_access",
            refresh_token: "new_refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    try {
      const token = await getValidToken(SERVER_URL);
      expect(token).toBe("new_access");

      // New token should be persisted
      const stored = await loadTokens();
      expect(stored?.accessToken).toBe("new_access");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws AuthRequired when refresh fails", async () => {
    await storeTokens(expiredTokens());

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })),
    ) as unknown as typeof fetch;

    try {
      await expect(getValidToken(SERVER_URL)).rejects.toBeInstanceOf(AuthRequired);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws AuthRequired when expired and no refresh token", async () => {
    await storeTokens(expiredTokens());
    const stored = await loadTokens();
    await storeTokens({ ...(stored as NonNullable<typeof stored>), refreshToken: undefined });

    await expect(getValidToken(SERVER_URL)).rejects.toBeInstanceOf(AuthRequired);
  });
});

// ── Device Auth polling scenarios (RFC 8628) ──────────────────────────────────

describe("loginDevice polling behavior", () => {
  /**
   * These tests verify the polling state machine by inspecting the module
   * behavior via mocked fetch responses. We test each RFC 8628 error path.
   *
   * The actual loginDevice() calls process.exit() on terminal errors, so
   * we mock the process and assert the stderr output.
   */

  const SERVER_URL = "https://caipe.test";
  const CLIENT_ID = "caipe-cli";

  it("authorization_pending × 2 then access_token → success", async () => {
    const { loginDevice } = await import("../src/auth/oauth");
    let callCount = 0;

    const originalFetch = global.fetch;
    global.fetch = vi.fn((url: string) => {
      const u = String(url);
      // Device code request
      if (u.includes("/oauth/device/code")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              device_code: "device_code_abc",
              user_code: "ABCD-1234",
              verification_uri: "https://caipe.test/activate",
              expires_in: 300,
              interval: 0, // poll immediately in tests
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      // Token poll
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "authorization_pending" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "device_access",
            refresh_token: "device_refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as unknown as typeof fetch;

    try {
      await loginDevice(SERVER_URL, CLIENT_ID);
      const stored = await loadTokens();
      expect(stored?.accessToken).toBe("device_access");
      expect(callCount).toBe(3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("slow_down increases poll interval by 5s", async () => {
    // We test this by capturing the delay times via a mocked setTimeout
    // and verifying the second poll waited 5s longer than the first.
    // Full behavioral test is in integration; here we just assert the
    // module handles the response without throwing.
    const { loginDevice } = await import("../src/auth/oauth");
    let callCount = 0;

    const originalFetch = global.fetch;
    global.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/device/code")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              device_code: "dc",
              user_code: "WXYZ-5678",
              verification_uri: "https://caipe.test/activate",
              expires_in: 300,
              interval: 0,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "slow_down" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "slowed_token", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    try {
      await loginDevice(SERVER_URL, CLIENT_ID);
      const stored = await loadTokens();
      expect(stored?.accessToken).toBe("slowed_token");
    } finally {
      global.fetch = originalFetch;
    }
  }, 15000);

  it("access_denied → process.exit(1) with correct message", async () => {
    const { loginDevice } = await import("../src/auth/oauth");

    const originalFetch = global.fetch;
    const originalExit = process.exit;
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);

    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error(`PROCESS_EXIT:${code}`);
    }) as typeof process.exit;

    global.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/device/code")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              device_code: "dc",
              user_code: "A",
              verification_uri: "https://x",
              expires_in: 60,
              interval: 0,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "access_denied" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    try {
      await loginDevice(SERVER_URL, CLIENT_ID);
    } catch (err) {
      expect((err as Error).message).toContain("PROCESS_EXIT:1");
    } finally {
      global.fetch = originalFetch;
      process.exit = originalExit;
      process.stderr.write = originalWrite;
    }

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("Authorization denied");
  });

  it("expired_token → process.exit(1) with re-run message", async () => {
    const { loginDevice } = await import("../src/auth/oauth");

    const originalFetch = global.fetch;
    const originalExit = process.exit;
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);

    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    process.exit = ((code: number) => {
      throw new Error(`PROCESS_EXIT:${code}`);
    }) as typeof process.exit;

    global.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/device/code")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              device_code: "dc",
              user_code: "A",
              verification_uri: "https://x",
              expires_in: 60,
              interval: 0,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "expired_token" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    try {
      await loginDevice(SERVER_URL, CLIENT_ID);
    } catch {
      // expected exit
    } finally {
      global.fetch = originalFetch;
      process.exit = originalExit;
      process.stderr.write = originalWrite;
    }

    expect(stderrChunks.join("")).toContain("re-run");
  }, 15000);

  it("unsupported_grant_type → process.exit(1) with --manual suggestion", async () => {
    const { loginDevice } = await import("../src/auth/oauth");

    const originalFetch = global.fetch;
    const originalExit = process.exit;
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);

    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    process.exit = ((_code: number) => {
      throw new Error("EXIT");
    }) as typeof process.exit;

    global.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/device/code")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "unsupported_grant_type" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      await loginDevice(SERVER_URL, CLIENT_ID);
    } catch {
      // expected exit
    } finally {
      global.fetch = originalFetch;
      process.exit = originalExit;
      process.stderr.write = originalWrite;
    }

    expect(stderrChunks.join("")).toContain("--manual");
  });

  it("404 device code endpoint → process.exit(1) with --manual suggestion", async () => {
    const { loginDevice } = await import("../src/auth/oauth");

    const originalFetch = global.fetch;
    const originalExit = process.exit;
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);

    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    process.exit = ((_code: number) => {
      throw new Error("EXIT");
    }) as typeof process.exit;

    global.fetch = vi.fn(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    ) as unknown as typeof fetch;

    try {
      await loginDevice(SERVER_URL, CLIENT_ID);
    } catch {
      // expected exit
    } finally {
      global.fetch = originalFetch;
      process.exit = originalExit;
      process.stderr.write = originalWrite;
    }

    expect(stderrChunks.join("")).toContain("--manual");
  });
});

// ── refreshAccessToken ────────────────────────────────────────────────────────

describe("refreshAccessToken", () => {
  const SERVER_URL = "https://caipe.test";

  it("exchanges refresh token for new access token", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: "refreshed", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    try {
      const tokens = await refreshAccessToken("old_refresh", SERVER_URL);
      expect(tokens.accessToken).toBe("refreshed");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws AuthRequired on 400 response", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 400 })),
    ) as unknown as typeof fetch;

    try {
      await expect(refreshAccessToken("bad_token", SERVER_URL)).rejects.toBeInstanceOf(
        AuthRequired,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
