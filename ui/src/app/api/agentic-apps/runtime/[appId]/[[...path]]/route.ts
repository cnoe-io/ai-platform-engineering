// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { evaluateAppAccess } from "@/lib/agentic-apps/access";
import {
  evaluateAgenticAppCasCompatibility,
  type AgenticAppCasCompatibilityResult,
} from "@/lib/agentic-apps/cas-compat";
import {
  buildProxyTargetUrl,
  httpErrorForBlockedReason,
  isExecutableProxiedHttpOrigin,
  isExecutableProxyRuntimeManifest,
  resolveEffectiveRuntimeOrigin,
} from "@/lib/agentic-apps/execution-gateway";
import { resolveAgenticAppExecutionBinding } from "@/lib/agentic-apps/execution-binding";
import {
  deriveAgenticAppSubjectId,
  hashAgenticAppIdentifier,
} from "@/lib/agentic-apps/identity";
import { buildPdpDecisionRecord, decideAgenticAppPdp } from "@/lib/agentic-apps/pdp";
import { resolveAgenticAppHttpPolicyAction } from "@/lib/agentic-apps/policy-routing";
import { buildAgenticAppRuntimePath } from "@/lib/agentic-apps/runtime-path";
import {
  appendAppTokenGrant,
  appendPdpDecision,
} from "@/lib/agentic-apps/store";
import { mintAppScopedToken } from "@/lib/agentic-apps/tokens";
import { ApiError } from "@/lib/api-error";
import { getAuthenticatedUser } from "@/lib/api-middleware";
import type {
  AgenticAppBlockedReason,
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
  // app. Strip client-supplied credentials to prevent JWT smuggling, then add
  // the short-lived, app-audience token minted for this decision.
  "authorization",
  // Defense-in-depth: never let a client smuggle the identity hint headers;
  // the gateway is the only legitimate source. These hints are
  // *non-authoritative* — the upstream MUST still verify the Bearer JWT —
  // but we still keep clients out of them as a hardening measure.
  "x-caipe-app-id",
  "x-caipe-user",
  "x-caipe-roles",
  "x-forwarded-prefix",
  "x-caipe-surface",
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
  let session: unknown;
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

  const binding = await resolveAgenticAppExecutionBinding(appId);
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

  const subjectId = deriveAgenticAppSubjectId(
    session as Record<string, unknown>,
    user.email,
  );
  const runtimePath = `/${(params.path ?? []).join("/")}`;
  const policyAction = resolveAgenticAppHttpPolicyAction(
    pkg.manifest,
    request.method,
    runtimePath,
  );
  const action = policyAction?.action ?? `undeclared:${request.method.toUpperCase()}:${runtimePath}`;
  const localDecision = decideAgenticAppPdp({
    action,
    user,
    session,
    pkg,
    installation,
    metadata: {
      path: runtimePath,
      method: request.method.toUpperCase(),
    },
  });
  const casCompatibility: AgenticAppCasCompatibilityResult = pkg.manifest.authorization
    ? await evaluateAgenticAppCasCompatibility({
        appId,
        subjectId,
        localEffect: localDecision.effect,
        correlationId,
        action: policyAction?.casAction ?? "use",
      })
    : {
        mode: "off" as const,
        casDecision: "NOT_EVALUATED" as const,
        effectiveEffect: localDecision.effect,
      };
  const pdpDecision = {
    ...localDecision,
    effect: casCompatibility.effectiveEffect,
    reasonCode:
      casCompatibility.effectiveEffect === "deny" && localDecision.effect === "allow"
        ? `cas_${(casCompatibility.casReason ?? "NO_CAPABILITY").toLowerCase()}`
        : localDecision.reasonCode,
    scopes: casCompatibility.effectiveEffect === "allow" ? localDecision.scopes : [],
    metadata: {
      ...localDecision.metadata,
      casMode: casCompatibility.mode,
      casDecision: casCompatibility.casDecision,
      ...(casCompatibility.casReason ? { casReason: casCompatibility.casReason } : {}),
    },
  };
  await appendPdpDecision(
    buildPdpDecisionRecord({
      appId,
      action,
      decision: pdpDecision,
      correlationId,
      userSubjectHash: hashAgenticAppIdentifier(subjectId),
      route: request.url,
      method: request.method.toUpperCase(),
    }),
  );
  if (pdpDecision.effect !== "allow") {
    const unavailable = casCompatibility.casReason === "AUTHZ_UNAVAILABLE";
    return Response.json(
      {
        error: unavailable ? "authorization_unavailable" : "pdp_denied",
        decisionId: pdpDecision.decisionId,
        reasonCode: pdpDecision.reasonCode,
      },
      {
        status: unavailable ? 503 : 403,
        headers: {
          "cache-control": "no-store",
          "x-caipe-decision-id": pdpDecision.decisionId,
          "x-correlation-id": correlationId,
          "x-caipe-cas-mode": casCompatibility.mode,
          "x-caipe-cas-decision": casCompatibility.casDecision,
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
    subject: { subjectHash: hashAgenticAppIdentifier(subjectId) },
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
        roles: deriveRoles({ session: session as Record<string, unknown>, role: user.role }),
      }),
      ...(bodyBuffer ? { body: toArrayBuffer(bodyBuffer) } : {}),
      redirect: "manual",
    });
  } catch {
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  const responseHeaders = withGatewayResponseHeaders(
    filterResponseHeaders(upstream.headers),
    pdpDecision.decisionId,
    correlationId,
  );
  responseHeaders.set("x-caipe-cas-mode", casCompatibility.mode);
  responseHeaders.set("x-caipe-cas-decision", casCompatibility.casDecision);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function isDocumentNavigation(request: Request): boolean {
  if (request.method.toUpperCase() !== "GET") {
    return false;
  }
  const fetchDest = request.headers.get("sec-fetch-dest")?.toLowerCase();
  // Only redirect top-level document navigations — not iframe/frame loads.
  // iframe requests send Sec-Fetch-Dest: iframe; redirecting those into the
  // SSO flow causes the login page to load inside the iframe, which then
  // tries to redirect to the IdP and breaks with ERR_CONNECTION_REFUSED.
  if (fetchDest === "document") {
    return true;
  }
  if (fetchDest && fetchDest !== "") {
    // Any other explicit Sec-Fetch-Dest (iframe, frame, embed, etc.) is not a
    // top-level navigation — return JSON 401 so the iframe shows a blank page
    // rather than an auth redirect loop.
    return false;
  }
  // No Sec-Fetch-Dest header (older browser or non-browser client) — fall
  // back to Accept-based heuristic but only if it looks like a full page load.
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
  // The runtime uses this trusted gateway-owned prefix when generating its
  // in-frame API and navigation URLs. Client-supplied values are stripped.
  headers.set("x-forwarded-prefix", buildAgenticAppRuntimePath(input.appId));
  headers.set("x-caipe-surface", "hosted");

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

function deriveRoles(input: {
  session: Record<string, unknown>;
  role: string;
}): string[] {
  const set = new Set<string>();
  if (input.role) set.add(input.role);
  const sessionRole = input.session.role;
  if (typeof sessionRole === "string" && sessionRole) set.add(sessionRole);
  // Admin implicitly inherits user privileges in this UI; mirror that
  // expectation downstream so a runtime gating on `user` works for admins.
  if (set.has("admin")) {
    set.add("user");
  }
  return Array.from(set).sort();
}
