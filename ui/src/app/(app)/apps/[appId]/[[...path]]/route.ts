// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";

import { evaluateAppAccess } from "@/lib/agentic-apps/access";
import {
  buildProxyTargetUrl,
  httpErrorForBlockedReason,
  isExecutableProxiedHttpOrigin,
  isExecutableProxyRuntimeManifest,
  resolveEffectiveRuntimeOrigin,
} from "@/lib/agentic-apps/execution-gateway";
import { buildPdpDecisionRecord, decideAgenticAppPdp } from "@/lib/agentic-apps/pdp";
import { getAgenticAppById } from "@/lib/agentic-apps/registry";
import {
  appendAppTokenGrant,
  appendPdpDecision,
  listAppInstallations,
  listAppPackages,
} from "@/lib/agentic-apps/store";
import { mintAppScopedToken } from "@/lib/agentic-apps/tokens";
import { ApiError } from "@/lib/api-error";
import { getAuthenticatedUser } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import type {
  AgenticAppBlockedReason,
  AgenticAppInstallationRecord,
  AgenticAppManifest,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

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
      if (e.statusCode === 401 && isDocumentNavigation(request)) {
        return redirectToLogin(request);
      }
      return Response.json({ error: e.message }, { status: e.statusCode });
    }
    throw e;
  }

  const params = await context.params;
  const appId = params.appId;
  const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();

  const binding = await resolveExecutionBinding(appId);
  if (binding.error) {
    return Response.json({ error: binding.error }, { status: binding.status });
  }
  const { installation, pkg } = binding;
  if (!installation || !pkg) {
    return Response.json({ error: "app_not_found" }, { status: 404 });
  }

  if (!isExecutableProxyRuntimeManifest(pkg.manifest)) {
    return Response.json({ error: "unsupported_runtime" }, { status: 501 });
  }

  if (shouldRedirectTopLevelIframeChromeRequest(request, pkg.manifest)) {
    return Response.redirect(new URL(`/apps/embed/${appId}`, request.url), 307);
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

  const subjectId = deriveUserId({ session, email: user.email });
  const action = `proxy:${request.method.toUpperCase()}`;
  const pdpDecision = decideAgenticAppPdp({
    action,
    user,
    session,
    pkg,
    installation,
    metadata: {
      path: `/${(params.path ?? []).join("/")}`,
      method: request.method.toUpperCase(),
    },
  });
  await appendPdpDecision(
    buildPdpDecisionRecord({
      appId,
      action,
      decision: pdpDecision,
      correlationId,
      userSubjectHash: hashStableIdentifier(subjectId),
      route: request.url,
      method: request.method.toUpperCase(),
    }),
  );
  if (pdpDecision.effect !== "allow") {
    return Response.json(
      {
        error: "pdp_denied",
        decisionId: pdpDecision.decisionId,
        reasonCode: pdpDecision.reasonCode,
      },
      {
        status: 403,
        headers: {
          "x-caipe-decision-id": pdpDecision.decisionId,
          "x-correlation-id": correlationId,
        },
      },
    );
  }

  const appToken = await mintAppScopedToken({
    appId,
    subject: subjectId,
    email: user.email,
    scopes: pdpDecision.scopes,
    decisionId: pdpDecision.decisionId,
    correlationId,
  });
  await appendAppTokenGrant({
    jti: appToken.jti,
    decisionId: pdpDecision.decisionId,
    correlationId,
    appId,
    audience: appToken.audience,
    scopes: pdpDecision.scopes,
    issuedAt: new Date().toISOString(),
    expiresAt: appToken.expiresAt,
    subject: { subjectHash: hashStableIdentifier(subjectId) },
    tokenHash: appToken.tokenHash,
  });

  const origin = resolveEffectiveRuntimeOrigin(installation, pkg.manifest);
  if (!isExecutableProxiedHttpOrigin(origin)) {
    return Response.json({ error: "unsupported_runtime" }, { status: 501 });
  }

  const targetUrl = buildProxyTargetUrl(origin!, params.path ?? [], request.url, {
    preserveMountPath: pkg.manifest.runtime.preserveMountPath === true,
    mountPath: pkg.manifest.runtime.mountPath,
  });

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
        appToken: appToken.token,
        decisionId: pdpDecision.decisionId,
        correlationId,
        userId: subjectId,
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
    headers: withGatewayResponseHeaders(
      filterResponseHeaders(upstream.headers),
      pdpDecision.decisionId,
      correlationId,
    ),
  });
}

type ExecutionBindingResult =
  | {
      installation: AgenticAppInstallationRecord;
      pkg: AgenticAppPackageRecord;
      error?: undefined;
      status?: undefined;
    }
  | {
      installation?: undefined;
      pkg?: undefined;
      error: string;
      status: number;
    };

async function resolveExecutionBinding(appId: string): Promise<ExecutionBindingResult> {
  if (isMongoDBConfigured) {
    let installations: Awaited<ReturnType<typeof listAppInstallations>>;
    let packages: Awaited<ReturnType<typeof listAppPackages>>;
    try {
      [installations, packages] = await Promise.all([listAppInstallations(), listAppPackages()]);
    } catch {
      return { error: "gateway_store_unavailable", status: 503 };
    }

    const installation = installations.find((i) => i.appId === appId) ?? null;
    const pkg =
      installation !== null
        ? packages.find((p) => p.packageId === installation.packageId) ?? null
        : null;

    if (installation && pkg) {
      return { installation, pkg };
    }
  }

  const manifest = getAgenticAppById(appId);
  if (!manifest) {
    if (!isMongoDBConfigured) {
      return { error: "mongodb_required", status: 503 };
    }
    return { error: "app_not_found", status: 404 };
  }

  return buildEnvConfiguredExecutionBinding(manifest);
}

function buildEnvConfiguredExecutionBinding(manifest: AgenticAppManifest): ExecutionBindingResult {
  const now = new Date().toISOString();
  return {
    pkg: {
      packageId: manifest.id,
      source: "builtin",
      manifest,
      importedAt: now,
      importedBy: "env-registry",
      ...(manifest.catalog ? { catalog: manifest.catalog } : {}),
    },
    installation: {
      appId: manifest.id,
      packageId: manifest.id,
      installed: true,
      enabled: true,
      visible: true,
      runtimeMountPath: manifest.runtime.mountPath,
      runtimeHealth: "unknown",
      healthPolicy: {
        blockLaunchWhen: manifest.health.blockLaunchWhen ?? ["degraded", "unreachable"],
      },
      routeOwnership: { normalizedMountPath: manifest.runtime.mountPath },
      updatedAt: now,
      updatedBy: "env-registry",
    },
  };
}

function shouldRedirectTopLevelIframeChromeRequest(
  request: Request,
  manifest: AgenticAppManifest,
): boolean {
  if (manifest.runtime.chrome !== "iframe") {
    return false;
  }
  const fetchDest = request.headers.get("sec-fetch-dest")?.toLowerCase();
  return fetchDest === "document";
}

function isDocumentNavigation(request: Request): boolean {
  if (request.method.toUpperCase() !== "GET") {
    return false;
  }
  const fetchDest = request.headers.get("sec-fetch-dest")?.toLowerCase();
  if (fetchDest === "document") {
    return true;
  }
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  return accept.includes("text/html");
}

function redirectToLogin(request: Request): Response {
  const requestUrl = new URL(request.url);
  const loginUrl = new URL("/login", requestUrl);
  loginUrl.searchParams.set("callbackUrl", `${requestUrl.pathname}${requestUrl.search}`);
  return Response.redirect(loginUrl, 307);
}

function buildForwardHeaders(input: {
  request: Request;
  appId: string;
  appToken: string;
  decisionId: string;
  correlationId: string;
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
  headers.set("x-caipe-decision-id", input.decisionId);
  headers.set("x-correlation-id", input.correlationId);

  // Authoritative identity: short-lived app-scoped token minted by CAIPE.
  headers.set("authorization", `Bearer ${input.appToken}`);
  return headers;
}

function withGatewayResponseHeaders(
  headers: Headers,
  decisionId: string,
  correlationId: string,
): Headers {
  headers.set("x-caipe-decision-id", decisionId);
  headers.set("x-correlation-id", correlationId);
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

function hashStableIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
