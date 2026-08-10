/**
 * @jest-environment node
 *
 * Unit tests for `ui/src/lib/nextauth-secret-guard.ts` — R4.
 *
 * These tests pin the contract for the production-safety guard on
 * `NEXTAUTH_SECRET`. The guard's job is to refuse known dev placeholders
 * in production builds so we don't ship a BFF whose session cookies and
 * skills-API tokens are forgeable across every install that copied the
 * same placeholder out of docs/Makefile/compose. Sibling pins:
 *   - `keycloak-admin-token.test.ts` (R1 admin-fallback gate)
 *   - `jwt-validation.test.ts` (consumes the guard for HS256 mint+verify)
 *
 * assisted-by Claude:claude-opus-4-7
 */

import {
  assertNextAuthSecretSafe,
  getSafeNextAuthSecret,
  isStrictSecretMode,
} from "../nextauth-secret-guard";

describe("nextauth-secret-guard", () => {
  const originalEnv = { ...process.env };
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_NEXTAUTH_DEV_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.SKILLS_API_SECRET;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("isStrictSecretMode", () => {
    it("returns true when NODE_ENV=production and ALLOW_NEXTAUTH_DEV_SECRET is unset", () => {
      process.env.NODE_ENV = "production";
      expect(isStrictSecretMode()).toBe(true);
    });

    it("returns false when NODE_ENV=development", () => {
      process.env.NODE_ENV = "development";
      expect(isStrictSecretMode()).toBe(false);
    });

    it("explicit ALLOW_NEXTAUTH_DEV_SECRET=true wins over NODE_ENV=production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_NEXTAUTH_DEV_SECRET = "true";
      expect(isStrictSecretMode()).toBe(false);
    });

    it("explicit ALLOW_NEXTAUTH_DEV_SECRET=false wins over NODE_ENV=development", () => {
      process.env.NODE_ENV = "development";
      process.env.ALLOW_NEXTAUTH_DEV_SECRET = "false";
      expect(isStrictSecretMode()).toBe(true);
    });

    it("accepts `1` as a boolean alias for the override flag (treats as true)", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_NEXTAUTH_DEV_SECRET = "1";
      expect(isStrictSecretMode()).toBe(false);
    });

    it("accepts `0` as a boolean alias for the override flag (treats as false)", () => {
      process.env.NODE_ENV = "development";
      process.env.ALLOW_NEXTAUTH_DEV_SECRET = "0";
      expect(isStrictSecretMode()).toBe(true);
    });
  });

  describe("assertNextAuthSecretSafe (strict mode)", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("throws when secret is undefined", () => {
      expect(() => assertNextAuthSecretSafe(undefined)).toThrow(
        /NEXTAUTH_SECRET is not set.*openssl rand/s
      );
    });

    it("throws when secret is empty string", () => {
      expect(() => assertNextAuthSecretSafe("")).toThrow(
        /NEXTAUTH_SECRET is not set/
      );
    });

    it("throws on the literal Makefile placeholder `caipe-dev-secret`", () => {
      // Pin THE specific value that shipped in Makefile:199 before R4.
      // This is the regression guard: if anyone re-introduces it via a
      // copy-paste, the test fires.
      expect(() => assertNextAuthSecretSafe("caipe-dev-secret")).toThrow(
        /known dev placeholder.*caipe-dev-secret/s
      );
    });

    it("throws on the compose-file placeholder `caipe-dev-secret-change-in-production`", () => {
      // Pin the value docker-compose{,.dev}.yaml falls back to. Same
      // intent as the previous test — different placeholder string.
      expect(() =>
        assertNextAuthSecretSafe("caipe-dev-secret-change-in-production")
      ).toThrow(/known dev placeholder/);
    });

    it.each(["changeme", "change-me", "please-change-me", "secret", "test", "dev"])(
      "throws on generic placeholder %s",
      (placeholder) => {
        expect(() => assertNextAuthSecretSafe(placeholder)).toThrow(
          /known dev placeholder/
        );
      }
    );

    it("throws on secrets shorter than 32 chars", () => {
      // 31-char real-looking secret — not in the placeholder set, but
      // too short to plausibly be from `openssl rand -base64 24`.
      const tooShort = "x".repeat(31);
      expect(() => assertNextAuthSecretSafe(tooShort)).toThrow(
        /NEXTAUTH_SECRET is too short.*minimum 32/s
      );
    });

    it("accepts a real CSPRNG-shaped secret (≥32 chars, not a placeholder)", () => {
      // A high-entropy 32-char fake used to exercise the "looks like a real
      // CSPRNG-rand secret" acceptance branch of the guard. Not a credential
      // for any real system.
      const realSecret = "kQXf8vN3p2RmHcLwYj7tBdAeUgZsMnVx"; // gitleaks:allow
      expect(assertNextAuthSecretSafe(realSecret)).toBe(realSecret);
    });

    it("trims surrounding whitespace before checking the placeholder set", () => {
      // Operator pastes "  caipe-dev-secret  " from a doc. We MUST
      // still detect the placeholder — otherwise the gate is trivially
      // bypassable. assisted-by Claude:claude-opus-4-7
      expect(() => assertNextAuthSecretSafe("  caipe-dev-secret  ")).toThrow(
        /known dev placeholder/
      );
    });
  });

  describe("assertNextAuthSecretSafe (dev mode)", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("accepts the Makefile placeholder in dev (with a warn log)", () => {
      expect(assertNextAuthSecretSafe("caipe-dev-secret")).toBe("caipe-dev-secret");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("NEXTAUTH_SECRET is a known dev placeholder")
      );
    });

    it("accepts a short secret in dev (no length floor)", () => {
      expect(assertNextAuthSecretSafe("abc")).toBe("abc");
    });

    it("still throws on empty secret in dev (must be set explicitly somewhere)", () => {
      expect(() => assertNextAuthSecretSafe("")).toThrow(/NEXTAUTH_SECRET is not set/);
    });
  });

  describe("getSafeNextAuthSecret", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("returns SKILLS_API_SECRET when set (precedence preserved)", () => {
      // High-entropy fakes used only to verify env-var precedence. Not credentials.
      const real = "k1QXf8vN3p2RmHcLwYj7tBdAeUgZsMnVx"; // gitleaks:allow
      const decoy = "decoy_QXf8vN3p2RmHcLwYj7tBdAeUgZsMnVx"; // gitleaks:allow
      process.env.SKILLS_API_SECRET = real;
      process.env.NEXTAUTH_SECRET = decoy;
      expect(getSafeNextAuthSecret()).toBe(real);
    });

    it("falls back to NEXTAUTH_SECRET when SKILLS_API_SECRET is unset", () => {
      const real = "k1QXf8vN3p2RmHcLwYj7tBdAeUgZsMnVx"; // gitleaks:allow
      process.env.NEXTAUTH_SECRET = real;
      expect(getSafeNextAuthSecret()).toBe(real);
    });

    it("throws when both env vars are unset in production", () => {
      expect(() => getSafeNextAuthSecret()).toThrow(/NEXTAUTH_SECRET is not set/);
    });

    // Suppress unused-variable warnings — `errorSpy` is wired by
    // beforeEach for symmetry with other suites but not exercised in
    // this describe block.
    it("smoke: console.error spy was installed", () => {
      expect(errorSpy).toBeDefined();
    });
  });
});
