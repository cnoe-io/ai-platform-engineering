// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { evaluateAppAccess } from "@/lib/agentic-apps/access";
import {
  buildProxyTargetUrl,
  httpErrorForBlockedReason,
  isExecutableProxiedHttpOrigin,
  isExecutableProxyRuntimeManifest,
  resolveEffectiveRuntimeOrigin,
} from "@/lib/agentic-apps/execution-gateway";
import { listAppInstallations, listAppPackages } from "@/lib/agentic-apps/store";
import { ApiError } from "@/lib/api-error";
import { getAuthenticatedUser } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import type { AgenticAppBlockedReason } from "@/types/agentic-app";

const BLOCKED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "content-security-policy",
  "content-security-policy-report-only",
  "set-cookie",
  "transfer-encoding",
  "x-frame-options",
]);

const BLOCKED_REQUEST_HEADERS = new Set([
  "connection",
  "cookie",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  // The gateway is the only legitimate source of Authorization to the upstream
  // app. We strip any client-supplied Authorization to prevent JWT smuggling
  // and replace it with the user's id_token (if available).
  "authorization",
  // Defense-in-depth: never let a client smuggle the identity hint headers;
  // the gateway is the only legitimate source. These hints are
  // *non-authoritative* — the upstream MUST still verify the Bearer JWT —
  // but we still keep clients out of them as a hardening measure.
  "x-caipe-app-id",
  "x-caipe-user",
  "x-caipe-roles",
]);

interface ProxyContext {
  params: Promise<{
    appId: string;
    path?: string[];
  }>;
}

export async function GET(request: Request, context: ProxyContext): Promise<Response> {
  return proxyAgenticAppRequest(request, context);
}

export async function HEAD(request: Request, context: ProxyContext): Promise<Response> {
  return proxyAgenticAppRequest(request, context);
}

export async function POST(request: Request, context: ProxyContext): Promise<Response> {
  return proxyAgenticAppRequest(request, context);
}

export async function PUT(request: Request, context: ProxyContext): Promise<Response> {
  return proxyAgenticAppRequest(request, context);
}

export async function PATCH(request: Request, context: ProxyContext): Promise<Response> {
  return proxyAgenticAppRequest(request, context);
}

export async function DELETE(request: Request, context: ProxyContext): Promise<Response> {
  return proxyAgenticAppRequest(request, context);
}

async function proxyAgenticAppRequest(
  request: Request,
  context: ProxyContext,
): Promise<Response> {
  // Server-only gate — never honor NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED.
  if (process.env.AGENTIC_APPS_INSTALL_ENABLED !== "true") {
    return Response.json({ error: "app_not_found" }, { status: 404 });
  }

  const nextRequest =
    request instanceof NextRequest ? request : new NextRequest(request.url, { headers: request.headers });

  let user: { email: string; name: string; role: string };
  let session: {
    role?: string;
    canViewAdmin?: boolean;
    groups?: string[];
    sub?: string;
    idToken?: string;
  };
  try {
    // Execution gateway never uses anonymous/no-SSO fallback — real session required.
    const auth = await getAuthenticatedUser(nextRequest, { allowAnonymous: false });
    user = auth.user;
    session = auth.session;
  } catch (e) {
    if (e instanceof ApiError) {
      return Response.json({ error: e.message }, { status: e.statusCode });
    }
    throw e;
  }

  if (!isMongoDBConfigured) {
    return Response.json({ error: "mongodb_required" }, { status: 503 });
  }

  const params = await context.params;
  const appId = params.appId;

  let installations: Awaited<ReturnType<typeof listAppInstallations>>;
  let packages: Awaited<ReturnType<typeof listAppPackages>>;
  try {
    [installations, packages] = await Promise.all([listAppInstallations(), listAppPackages()]);
  } catch {
    return Response.json({ error: "gateway_store_unavailable" }, { status: 503 });
  }

  const installation = installations.find((i) => i.appId === appId) ?? null;
  const pkg =
    installation !== null
      ? packages.find((p) => p.packageId === installation.packageId) ?? null
      : null;

  if (!installation || !pkg) {
    return Response.json({ error: "app_not_found" }, { status: 404 });
  }

  if (!isExecutableProxyRuntimeManifest(pkg.manifest)) {
    return Response.json({ error: "unsupported_runtime" }, { status: 501 });
  }

  const accessResult = evaluateAppAccess({
    user,
    session,
    pkg,
    installation,
  });

  if (!accessResult.canLaunch) {
    const primary = accessResult.blockedReasons[0] as AgenticAppBlockedReason | undefined;
    const { status, error } = primary
      ? httpErrorForBlockedReason(primary)
      : { status: 404 as const, error: "app_not_found" };
    return Response.json({ error }, { status });
  }

  const origin = resolveEffectiveRuntimeOrigin(installation, pkg.manifest);
  if (!isExecutableProxiedHttpOrigin(origin)) {
    return Response.json({ error: "unsupported_runtime" }, { status: 501 });
  }

  const targetUrl = buildProxyTargetUrl(origin!, params.path ?? [], request.url);

  // Buffer the request body for body-bearing methods so the upstream `fetch`
  // gets a fully-materialised payload (some Node fetch implementations do not
  // accept streaming Web Request bodies).
  const bodyBuffer: Buffer | null = shouldForwardBody(request.method)
    ? await readBodyAsBuffer(request)
    : null;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers: buildForwardHeaders({
        request,
        appId,
        idToken: typeof session.idToken === "string" ? session.idToken : undefined,
        userId: deriveUserId({ session, email: user.email }),
        roles: deriveRoles({ session, role: user.role }),
      }),
      ...(bodyBuffer ? { body: toArrayBuffer(bodyBuffer) } : {}),
      redirect: "manual",
    });
  } catch {
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: filterResponseHeaders(upstream.headers),
  });
}

function buildForwardHeaders(input: {
  request: Request;
  appId: string;
  idToken: string | undefined;
  userId: string;
  roles: string[];
}): Headers {
  const headers = new Headers();
  input.request.headers.forEach((value, key) => {
    if (!BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  // Identity hints — non-authoritative. The upstream MUST verify the Bearer
  // JWT before trusting these. They exist only to reduce token-decoding work
  // and to give logs a stable correlation id.
  headers.set("x-caipe-app-id", input.appId);
  if (input.userId) headers.set("x-caipe-user", input.userId);
  if (input.roles.length > 0) headers.set("x-caipe-roles", input.roles.join(","));

  // Authoritative identity: the user's OIDC id_token. Apps verify it via JWKS.
  if (input.idToken && input.idToken.length > 0) {
    headers.set("authorization", `Bearer ${input.idToken}`);
  }
  return headers;
}

function filterResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  return headers;
}

function shouldForwardBody(method: string): boolean {
  const upper = method.toUpperCase();
  return upper !== "GET" && upper !== "HEAD";
}

async function readBodyAsBuffer(request: Request): Promise<Buffer> {
  const buf = await request.arrayBuffer();
  return Buffer.from(buf);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function deriveUserId(input: { session: { sub?: string }; email: string }): string {
  const sub = input.session.sub?.trim();
  if (sub && sub.length > 0) {
    return sub;
  }
  // Fallback: hash the email so PII never leaves the host. We keep the full
  // 64-char digest so collisions remain astronomical.
  return createHash("sha256").update(input.email).digest("hex");
}

function deriveRoles(input: {
  session: { role?: string; canViewAdmin?: boolean };
  role: string;
}): string[] {
  const set = new Set<string>();
  if (input.role) set.add(input.role);
  if (input.session.role) set.add(input.session.role);
  // Admin implicitly inherits user privileges in this UI; mirror that
  // expectation downstream so a runtime gating on `user` works for admins.
  if (set.has("admin")) {
    set.add("user");
  }
  return Array.from(set).sort();
}
