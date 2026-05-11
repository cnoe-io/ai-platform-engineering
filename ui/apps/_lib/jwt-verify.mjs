// assisted-by Codex Codex-sonnet-4-6
//
// Shared JWT verifier for sample agentic-app runtimes.
//
// CAIPE forwards an app-scoped token as `Authorization: Bearer …` when
// proxying requests to an agentic app. Each app verifies that token and, if
// valid, treats the claims as the authoritative identity for the request. The non-authoritative
// `x-caipe-user`/`x-caipe-roles` hints from the gateway are *not* checked
// here; the upstream MUST derive identity from the JWT.
//
// Configuration (env vars), per app id (uppercased):
//   AGENTIC_APP_TOKEN_SECRET        — shared verifier secret for local sample runtimes
//   AGENTIC_APP_TOKEN_ISSUER        — expected `iss` claim (defaults to caipe-agentic-apps)
//   AGENTIC_APP_<ID>_JWT_AUDIENCE   — expected `aud` claim (defaults to agentic-app:<id>)
//
// Skipping verification (development only): set
//   AGENTIC_APP_<ID>_JWT_SKIP_VERIFY=true
// This is rejected when NODE_ENV=production.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;

/**
 * Build a verifier configured for one app instance.
 *
 * @param {object} input
 * @param {string} input.appId           Logical app id (e.g. "weather"); used
 *                                       only for env var prefix and logging.
 * @param {string} [input.issuer]        Override the env-derived issuer.
 * @param {string} [input.secret]        Override the env-derived shared secret.
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
  const issuer = (input?.issuer ?? process.env.AGENTIC_APP_TOKEN_ISSUER ?? "caipe-agentic-apps").trim();
  const secret = (input?.secret ?? process.env.AGENTIC_APP_TOKEN_SECRET ?? "").trim();
  const audience = (
    input?.audience ??
    process.env[`${envPrefix}_JWT_AUDIENCE`] ??
    `agentic-app:${appId}`
  ).trim();
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
        const claims = decodeJwtPayload(token);
        return { ok: true, identity: buildIdentity(claims) };
      } catch {
        return { ok: false, status: 401, reason: "invalid_token" };
      }
    };
  }

  if (!secret || secret.length < 16) {
    throw new Error(
      "createAgenticAppJwtVerifier: AGENTIC_APP_TOKEN_SECRET is required and must be at least 16 characters",
    );
  }
  const clockTolerance = Number.isFinite(input?.clockTolerance)
    ? Number(input.clockTolerance)
    : DEFAULT_CLOCK_TOLERANCE_SECONDS;

  return async (headers) => {
    const token = extractBearer(headers);
    if (!token) {
      return { ok: false, status: 401, reason: "missing_authorization" };
    }
    try {
      const payload = verifyAppScopedToken(token, {
        appId,
        issuer,
        audience,
        secret,
        clockTolerance,
      });
      return { ok: true, identity: buildIdentity(payload) };
    } catch (error) {
      const reason = error?.message ?? "invalid_token";
      return { ok: false, status: 401, reason };
    }
  };
}

function verifyAppScopedToken(token, options) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("invalid_token");
  }
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  if (header.alg !== "HS256") {
    throw new Error("invalid_algorithm");
  }
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac("sha256", options.secret).update(signingInput).digest();
  const actual = Buffer.from(encodedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("bad_signature");
  }
  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== options.issuer || claims.aud !== options.audience) {
    throw new Error("claim_invalid");
  }
  if (claims.app_id !== options.appId || !Array.isArray(claims.scp)) {
    throw new Error("claim_invalid");
  }
  if (typeof claims.exp !== "number" || claims.exp + options.clockTolerance <= now) {
    throw new Error("expired");
  }
  return claims;
}

function decodeJwtPayload(token) {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) throw new Error("invalid_token");
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
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
    appId: typeof claims.app_id === "string" ? claims.app_id : null,
    scopes: Array.isArray(claims.scp) ? claims.scp.map(String) : [],
    decisionId: typeof claims.decision_id === "string" ? claims.decision_id : null,
    raw: claims,
  };
}
