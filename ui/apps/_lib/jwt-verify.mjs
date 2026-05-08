// assisted-by Codex Codex-sonnet-4-6
//
// Shared JWT verifier for sample agentic-app runtimes.
//
// CAIPE forwards the user's OIDC `id_token` as `Authorization: Bearer …`
// when proxying requests to an agentic app. Each app independently verifies
// the token against the IdP's JWKS endpoint and, if valid, treats the claims
// as the authoritative identity for the request. The non-authoritative
// `x-caipe-user`/`x-caipe-roles` hints from the gateway are *not* checked
// here; the upstream MUST derive identity from the JWT.
//
// Configuration (env vars), per app id (uppercased):
//   AGENTIC_APP_<ID>_JWT_ISSUER     — expected `iss` claim, e.g. https://idp.example/realms/caipe
//   AGENTIC_APP_<ID>_JWT_JWKS_URI   — JWKS endpoint (auto-discovered if omitted)
//   AGENTIC_APP_<ID>_JWT_AUDIENCE   — expected `aud` claim (defaults to the
//                                    CAIPE OIDC client id when sharing the IdP)
//
// Skipping verification (development only): set
//   AGENTIC_APP_<ID>_JWT_SKIP_VERIFY=true
// This is rejected when NODE_ENV=production.

import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;

/**
 * Build a verifier configured for one app instance.
 *
 * @param {object} input
 * @param {string} input.appId           Logical app id (e.g. "weather"); used
 *                                       only for env var prefix and logging.
 * @param {string} [input.issuer]        Override the env-derived issuer.
 * @param {string} [input.jwksUri]       Override the env-derived JWKS URI.
 * @param {string} [input.audience]      Override the env-derived audience.
 * @param {boolean} [input.skipVerify]   Override the env-derived skip flag.
 * @param {number} [input.clockTolerance] Seconds of clock skew (default 60).
 * @returns {(headers: Record<string, string|string[]|undefined>) => Promise<{ok: true, identity: object} | {ok: false, status: number, reason: string}>}
 */
export function createAgenticAppJwtVerifier(input) {
  const appId = String(input?.appId ?? "").trim();
  if (!appId) {
    throw new Error("createAgenticAppJwtVerifier: appId is required");
  }

  const envPrefix = `AGENTIC_APP_${appId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const issuer = (input?.issuer ?? process.env[`${envPrefix}_JWT_ISSUER`] ?? "").trim();
  const jwksUri = (input?.jwksUri ?? process.env[`${envPrefix}_JWT_JWKS_URI`] ?? "").trim();
  const audience = (input?.audience ?? process.env[`${envPrefix}_JWT_AUDIENCE`] ?? "").trim();
  const skipVerify =
    (input?.skipVerify ?? String(process.env[`${envPrefix}_JWT_SKIP_VERIFY`] ?? "").toLowerCase()) ===
      true ||
    String(process.env[`${envPrefix}_JWT_SKIP_VERIFY`] ?? "").toLowerCase() === "true";

  if (skipVerify) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `createAgenticAppJwtVerifier: ${envPrefix}_JWT_SKIP_VERIFY=true is forbidden in production`,
      );
    }
    console.warn(
      `[${appId}] ⚠️  JWT verification skipped via ${envPrefix}_JWT_SKIP_VERIFY — development only.`,
    );
    return async (headers) => {
      const token = extractBearer(headers);
      if (!token) return { ok: false, status: 401, reason: "missing_authorization" };
      try {
        const claims = decodeJwt(token);
        return { ok: true, identity: buildIdentity(claims) };
      } catch {
        return { ok: false, status: 401, reason: "invalid_token" };
      }
    };
  }

  if (!jwksUri) {
    throw new Error(
      `createAgenticAppJwtVerifier: ${envPrefix}_JWT_JWKS_URI is required (or set ${envPrefix}_JWT_SKIP_VERIFY=true for local dev)`,
    );
  }

  const jwks = createRemoteJWKSet(new URL(jwksUri), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });

  const verifyOptions = {
    clockTolerance: Number.isFinite(input?.clockTolerance)
      ? Number(input.clockTolerance)
      : DEFAULT_CLOCK_TOLERANCE_SECONDS,
  };
  if (issuer) verifyOptions.issuer = issuer;
  if (audience) verifyOptions.audience = audience;

  return async (headers) => {
    const token = extractBearer(headers);
    if (!token) {
      return { ok: false, status: 401, reason: "missing_authorization" };
    }
    try {
      const { payload } = await jwtVerify(token, jwks, verifyOptions);
      return { ok: true, identity: buildIdentity(payload) };
    } catch (error) {
      const code = error?.code ?? "";
      const reason =
        code === "ERR_JWT_EXPIRED"
          ? "expired"
          : code === "ERR_JWT_CLAIM_VALIDATION_FAILED"
            ? "claim_invalid"
            : code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED"
              ? "bad_signature"
              : "invalid_token";
      return { ok: false, status: 401, reason };
    }
  };
}

function extractBearer(headers) {
  const raw = headers?.authorization ?? headers?.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function buildIdentity(claims) {
  const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
  return {
    subject: typeof claims.sub === "string" ? claims.sub : null,
    email: typeof claims.email === "string" ? claims.email : null,
    name: typeof claims.name === "string" ? claims.name : null,
    issuer: typeof claims.iss === "string" ? claims.iss : null,
    audience: claims.aud ?? null,
    expiresAt: typeof claims.exp === "number" ? claims.exp : null,
    issuedAt: typeof claims.iat === "number" ? claims.iat : null,
    groups,
    raw: claims,
  };
}
