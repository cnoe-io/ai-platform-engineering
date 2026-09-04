import { createHmac, timingSafeEqual } from "crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

import type { JWTIdentity } from "@/lib/jwt-validation";

/**
 * Server-only proof used after a secondary OIDC token has been validated.
 * The proof binds internal forwarding to the exact bearer token without
 * forwarding a provider-specific credential to downstream routes.
 */
export const TOME_MCP_OIDC_PROOF_HEADER = "x-tome-mcp-oidc-proof";

const SECONDARY_OIDC_JWKS_URI = "TOME_MCP_SECONDARY_OIDC_JWKS_URI";
const SECONDARY_OIDC_ISSUER = "TOME_MCP_SECONDARY_OIDC_ISSUER";
const SECONDARY_OIDC_AUDIENCES = "TOME_MCP_SECONDARY_OIDC_AUDIENCES";

// Deprecated aliases retained so existing deployments can migrate without a
// flag day. New installations should use the provider-neutral names above.
const LEGACY_JWKS_URI = "TOME_MCP_CIRCUIT_JWKS_URI";
const LEGACY_ISSUER = "TOME_MCP_CIRCUIT_ISSUER";
const LEGACY_AUDIENCES = "TOME_MCP_CIRCUIT_AUDIENCES";

interface SecondaryOidcConfig {
  audiences: string[];
  issuer: string;
  jwksUri: string;
}

interface TomeOidcSession {
  accessToken: string;
  authMethod: "bearer";
  org?: string;
  principalType: "oidc_user";
  role: "user";
  sub?: string;
  tomeOidcProof: string;
  user: { email: string; name: string };
}

export interface TomeOidcAuthResult {
  session: TomeOidcSession;
  user: { email: string; name: string; role: string };
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function csv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envValue(primary: string, legacy: string): string {
  return process.env[primary]?.trim() || process.env[legacy]?.trim() || "";
}

function getSecondaryOidcConfig(): SecondaryOidcConfig | null {
  const jwksUri = envValue(SECONDARY_OIDC_JWKS_URI, LEGACY_JWKS_URI);
  const issuer = envValue(SECONDARY_OIDC_ISSUER, LEGACY_ISSUER);
  const audiences = csv(
    process.env[SECONDARY_OIDC_AUDIENCES] || process.env[LEGACY_AUDIENCES],
  );
  const configured = Boolean(jwksUri || issuer || audiences.length);

  if (!configured) return null;
  if (!jwksUri || !issuer || audiences.length === 0) {
    throw new Error(
      `${SECONDARY_OIDC_JWKS_URI}, ${SECONDARY_OIDC_ISSUER}, and ${SECONDARY_OIDC_AUDIENCES} must all be configured`,
    );
  }

  const parsed = new URL(jwksUri);
  if (parsed.protocol !== "https:") {
    throw new Error(`${SECONDARY_OIDC_JWKS_URI} must use HTTPS`);
  }

  return { audiences, issuer, jwksUri };
}

export function isTomeSecondaryOidcConfigured(): boolean {
  return getSecondaryOidcConfig() !== null;
}

function getJWKS(config: SecondaryOidcConfig): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(config.jwksUri);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(new URL(config.jwksUri));
  jwksCache.set(config.jwksUri, jwks);
  return jwks;
}

function identityFromPayload(payload: JWTPayload): JWTIdentity {
  const email =
    (typeof payload.email === "string" && payload.email) ||
    (typeof payload.preferred_username === "string" && payload.preferred_username) ||
    (typeof payload.sub === "string" && payload.sub) ||
    "unknown";
  const name =
    (typeof payload.name === "string" && payload.name) ||
    (typeof payload.fullname === "string" && payload.fullname) ||
    email;
  const groups = Array.isArray(payload.groups)
    ? payload.groups.map(String)
    : typeof payload.groups === "string"
      ? payload.groups.split(/[;,\s]+/).filter(Boolean)
      : [];

  return {
    email,
    name,
    groups,
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    org:
      (typeof payload.org === "string" && payload.org) ||
      (typeof payload.tenant_id === "string" && payload.tenant_id) ||
      (typeof payload.organization === "string" && payload.organization) ||
      undefined,
  };
}

/** Validate a secondary OIDC JWT locally against cached remote JWKS keys. */
export async function validateTomeSecondaryOidcJWT(token: string): Promise<JWTIdentity> {
  const config = getSecondaryOidcConfig();
  if (!config) {
    throw new Error("TOME secondary OIDC JWT validation is not configured");
  }

  const { payload } = await jwtVerify(token, getJWKS(config), {
    issuer: config.issuer,
    audience: config.audiences,
    requiredClaims: ["iss", "aud", "exp"],
  });
  return identityFromPayload(payload);
}

function internalProofSecret(): string {
  const secret = process.env.TOME_MCP_INTERNAL_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret?.trim()) {
    throw new Error("TOME_MCP_INTERNAL_AUTH_SECRET or NEXTAUTH_SECRET is required");
  }
  return secret;
}

function proofForToken(token: string): string {
  return createHmac("sha256", internalProofSecret()).update(token).digest("base64url");
}

export function createTomeOidcProof(token: string): string {
  return proofForToken(token);
}

/** Verify the proof before accepting a secondary OIDC token internally. */
export function isValidTomeOidcProof(token: string, proof: string | null): boolean {
  if (!proof) return false;
  try {
    const expected = Buffer.from(proofForToken(token));
    const actual = Buffer.from(proof);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function buildTomeOidcAuth(
  token: string,
  identity: JWTIdentity,
): TomeOidcAuthResult {
  const user = { email: identity.email, name: identity.name, role: "user" };
  return {
    user,
    session: {
      role: "user",
      accessToken: token,
      sub: identity.sub,
      org: identity.org,
      principalType: "oidc_user",
      authMethod: "bearer",
      tomeOidcProof: createTomeOidcProof(token),
      user: { email: identity.email, name: identity.name },
    },
  };
}

export function resetTomeSecondaryOidcJWTCache(): void {
  jwksCache.clear();
}
