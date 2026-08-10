/**
 * R4: NEXTAUTH_SECRET production-safety guard.
 *
 * `NEXTAUTH_SECRET` HS256-signs both the NextAuth session cookies and
 * the internal skills-API JWTs (see `jwt-validation.ts::getLocalSigningKey`).
 * Two cross-cutting concerns motivate this module:
 *
 *  1. **Forgery across installs.** If two operators copy the same value
 *     (e.g. `caipe-dev-secret` from a docs example or the Makefile target
 *     before R4 landed), session cookies and skills-API tokens minted in
 *     install A are byte-for-byte valid in install B. That's a single-key
 *     compromise that defeats the BFF's entire authn boundary.
 *  2. **Silent insecurity at startup.** A misconfigured prod install where
 *     `NEXTAUTH_SECRET` is unset or set to a known placeholder shows no
 *     symptoms until an attacker reuses a known cookie/token. We want
 *     loud-on-startup failure instead of latent compromise.
 *
 * `assertNextAuthSecretSafe()` returns the secret if it's safe and throws
 * a descriptive configuration error otherwise. It is intentionally
 * permissive when `NODE_ENV !== "production"` so local dev (notably
 * docker-compose.dev.yaml's `caipe-dev-secret-change-in-production`
 * default and the integration-test stubs) keeps working unchanged.
 *
 * The gate can be force-overridden with
 * `ALLOW_NEXTAUTH_DEV_SECRET=true` for a tightly-controlled CI box
 * (mirrors the R1 `ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK` pattern).
 *
 * assisted-by Claude:claude-opus-4-7
 */

/**
 * Known placeholder values that ship in docs, compose files, Makefile
 * targets, and integration-test fixtures. Adding to this list is a
 * one-way ratchet — never remove an entry, only add new ones we
 * discover via incident postmortems or PR review.
 */
export const KNOWN_NEXTAUTH_PLACEHOLDERS: ReadonlySet<string> = new Set([
  // The hard-coded literal we shipped in Makefile:199 before R4.
  "caipe-dev-secret",
  // The compose-file fallback we shipped in docker-compose{,.dev}.yaml.
  "caipe-dev-secret-change-in-production",
  // Generic "I forgot to set this" placeholders an operator might copy
  // from Stack Overflow / GitHub examples.
  "changeme",
  "change-me",
  "please-change-me",
  "secret",
  "test",
  "dev",
  "development",
  "your-secret-here",
  "replace-me",
]);

/**
 * Production-strictness signal. Mirrors the R1 gate semantics so the
 * two production-safety guards behave identically — see
 * `ui/src/lib/rbac/keycloak-admin.ts::adminPasswordFallbackAllowed`.
 *
 * Precedence:
 *   1. `ALLOW_NEXTAUTH_DEV_SECRET=true|1` → strict mode OFF (explicit opt-out)
 *   2. `ALLOW_NEXTAUTH_DEV_SECRET=false|0` → strict mode ON (explicit opt-in)
 *   3. otherwise → strict mode iff `NODE_ENV === "production"`
 */
export function isStrictSecretMode(): boolean {
  const explicit = process.env.ALLOW_NEXTAUTH_DEV_SECRET?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return false;
  if (explicit === "false" || explicit === "0") return true;
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

/**
 * Validate `NEXTAUTH_SECRET` against the placeholder list and minimum
 * length. Throws a descriptive `Error` instead of returning a boolean
 * so the failure mode is loud and the error string lands directly in
 * Sentry / pod logs with everything an operator needs to fix it.
 *
 * @param value The raw `process.env.NEXTAUTH_SECRET` value (or
 *   any other source).
 * @returns The (validated, non-placeholder) secret value.
 */
export function assertNextAuthSecretSafe(value: string | undefined): string {
  const secret = value?.trim() ?? "";

  if (secret.length === 0) {
    throw new Error(
      "NEXTAUTH_SECRET is not set. Generate one with `openssl rand -base64 48` " +
        "and set it via your Helm chart / Compose .env / Secret store."
    );
  }

  if (!isStrictSecretMode()) {
    // Dev mode: allow placeholders but still log a warning the first
    // time we see one, so a developer who accidentally promotes their
    // dev stack to staging notices the message in their logs.
    if (KNOWN_NEXTAUTH_PLACEHOLDERS.has(secret)) {
      console.warn(
        "[NextAuthSecretGuard] NEXTAUTH_SECRET is a known dev placeholder. " +
          "This is OK in development; in production, set " +
          "ALLOW_NEXTAUTH_DEV_SECRET=false (or unset NODE_ENV !== 'production') " +
          "to enable strict mode."
      );
    }
    return secret;
  }

  // Strict mode (production) — reject placeholders and short secrets.
  if (KNOWN_NEXTAUTH_PLACEHOLDERS.has(secret)) {
    throw new Error(
      `NEXTAUTH_SECRET is set to a known dev placeholder (${JSON.stringify(secret)}). ` +
        "Generate a real secret with `openssl rand -base64 48` and update your " +
        "Helm chart / Compose .env / Secret store. " +
        "To override for a throwaway CI box only: set ALLOW_NEXTAUTH_DEV_SECRET=true."
    );
  }

  // 32 chars is a conservative floor: `openssl rand -base64 24` produces
  // 32 chars; anything shorter is almost certainly not from a CSPRNG.
  if (secret.length < 32) {
    throw new Error(
      `NEXTAUTH_SECRET is too short (${secret.length} chars; minimum 32 in strict mode). ` +
        "Generate a real secret with `openssl rand -base64 48`. " +
        "To override for a throwaway CI box only: set ALLOW_NEXTAUTH_DEV_SECRET=true."
    );
  }

  return secret;
}

/**
 * Convenience: read `process.env.NEXTAUTH_SECRET` (or its
 * `SKILLS_API_SECRET` override, mirroring `jwt-validation.ts`) and
 * validate it. Throws on the same conditions as
 * `assertNextAuthSecretSafe`.
 */
export function getSafeNextAuthSecret(): string {
  // SKILLS_API_SECRET, when set, takes precedence — this preserves the
  // existing override path while still running it through the guard.
  const raw = process.env.SKILLS_API_SECRET || process.env.NEXTAUTH_SECRET;
  return assertNextAuthSecretSafe(raw);
}
