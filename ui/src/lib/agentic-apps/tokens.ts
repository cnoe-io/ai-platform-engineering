// assisted-by Codex Codex-sonnet-4-6

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type MintAppScopedTokenInput = {
  appId: string;
  subject: string;
  email?: string;
  scopes: string[];
  decisionId: string;
  correlationId?: string;
  ttlSeconds?: number;
};

export type MintedAppScopedToken = {
  token: string;
  tokenHash: string;
  jti: string;
  issuer: string;
  audience: string;
  expiresAt: string;
};

export type JwtPayload = Record<string, unknown> & {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  jti?: string;
};

export type VerifiedAppScopedToken = JwtPayload & {
  app_id: string;
  scp: string[];
  decision_id: string;
};

export type MintAgenticAppTokenInput = {
  appId: string;
  subject: string;
  name?: string;
  email?: string;
  scopes: string[];
  decisionId: string;
  correlationId: string;
  ttlSeconds?: number;
};

export type VerifiedAgenticAppToken = Record<string, unknown> & {
  iss: string;
  aud: string;
  sub: string;
  app_id: string;
  scp: string[];
  decision_id: string;
  exp: number;
};

const DEFAULT_TTL_SECONDS = 5 * 60;

function getTokenIssuer(): string {
  return process.env.AGENTIC_APP_TOKEN_ISSUER || "caipe-agentic-apps";
}

function getSigningKey(): Uint8Array {
  const secret = process.env.AGENTIC_APP_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AGENTIC_APP_TOKEN_SECRET or NEXTAUTH_SECRET must be at least 16 characters");
  }
  return new TextEncoder().encode(secret);
}

export function getAppTokenAudience(appId: string): string {
  return `agentic-app:${appId}`;
}

/** Fail startup before exposing an enabled deployment-owned runtime. */
export function validateAgenticAppTokenConfiguration(): void {
  hostedAppTokenSecret();
}

export function getAgenticAppTokenAudience(appId: string): string {
  return getAppTokenAudience(appId);
}

export async function mintAgenticAppToken(
  input: MintAgenticAppTokenInput,
): Promise<{ token: string; expiresAt: string }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload = {
    iss: getTokenIssuer(),
    aud: getAgenticAppTokenAudience(input.appId),
    sub: input.subject,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.email?.trim() ? { email: input.email.trim() } : {}),
    app_id: input.appId,
    scp: input.scopes,
    scope: input.scopes.join(" "),
    decision_id: input.decisionId,
    correlation_id: input.correlationId,
    jti: randomUUID(),
    iat: issuedAt,
    exp: expiresAt,
  };
  return {
    token: signHostedAppToken(payload),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyAgenticAppToken(
  token: string,
  appId: string,
): Promise<VerifiedAgenticAppToken> {
  const payload = verifyHostedAppToken(token);
  if (payload.iss !== getTokenIssuer()) throw new Error("invalid token issuer");
  if (payload.aud !== getAgenticAppTokenAudience(appId)) {
    throw new Error("invalid token audience");
  }
  if (payload.app_id !== appId) throw new Error("invalid app id");
  if (typeof payload.sub !== "string" || !payload.sub.trim()) {
    throw new Error("invalid token subject");
  }
  if (!Array.isArray(payload.scp)) throw new Error("invalid token scopes");
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("expired token");
  }
  return payload as VerifiedAgenticAppToken;
}

export function hashAppScopedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function mintAppScopedToken(
  input: MintAppScopedTokenInput,
): Promise<MintedAppScopedToken> {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + ttlSeconds;
  const jti = randomUUID();
  const issuer = getTokenIssuer();
  const audience = getAppTokenAudience(input.appId);
  const payload: JwtPayload = {
    app_id: input.appId,
    email: input.email,
    scp: input.scopes,
    scope: input.scopes.join(" "),
    decision_id: input.decisionId,
    correlation_id: input.correlationId,
    iss: issuer,
    aud: audience,
    sub: input.subject,
    jti,
    iat: Math.floor(Date.now() / 1000),
    exp: expiresAtEpoch,
  };
  const token = signHs256Jwt(payload);

  return {
    token,
    tokenHash: hashAppScopedToken(token),
    jti,
    issuer,
    audience,
    expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
  };
}

export async function verifyAppScopedToken(
  token: string,
  appId: string,
): Promise<VerifiedAppScopedToken> {
  const payload = verifyHs256Jwt(token);
  if (payload.iss !== getTokenIssuer()) {
    throw new Error("invalid app-scoped token issuer");
  }
  if (payload.aud !== getAppTokenAudience(appId)) {
    throw new Error("invalid app-scoped token audience");
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("expired app-scoped token");
  }
  if (payload.app_id !== appId || !Array.isArray(payload.scp)) {
    throw new Error("invalid app-scoped token claims");
  }
  return payload as VerifiedAppScopedToken;
}

function signHs256Jwt(payload: JwtPayload): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac("sha256", getSigningKey())
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function verifyHs256Jwt(token: string): JwtPayload {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("invalid app-scoped token format");
  }
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as {
    alg?: string;
  };
  if (header.alg !== "HS256") {
    throw new Error("invalid app-scoped token algorithm");
  }
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac("sha256", getSigningKey()).update(signingInput).digest();
  const actual = Buffer.from(encodedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("invalid app-scoped token signature");
  }
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as JwtPayload;
}

function hostedAppTokenSecret(): string {
  const secret = process.env.AGENTIC_APP_TOKEN_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AGENTIC_APP_TOKEN_SECRET must be at least 32 bytes");
  }
  return secret;
}

function signHostedAppToken(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac("sha256", hostedAppTokenSecret())
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function verifyHostedAppToken(token: string): Record<string, unknown> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) throw new Error("invalid token format");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as {
    alg?: string;
  };
  if (header.alg !== "HS256") throw new Error("invalid token algorithm");
  const expected = createHmac("sha256", hostedAppTokenSecret())
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64url");
  if (signaturePart.length !== expected.length) throw new Error("invalid token signature");
  const actualBuffer = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expected);
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("invalid token signature");
  }
  return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
