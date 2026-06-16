/**
 * Shared helpers for all Dynamic Agents proxy routes.
 *
 * Every request proxied to the DA backend must include an
 * ``X-User-Context`` header (base64-encoded JSON) so DA knows who the
 * caller is.  DA never validates JWTs directly — the Next.js gateway is
 * the auth boundary.
 *
 * Auth methods:
 *   1. Browser UI requests use the NextAuth session cookie first, even if
 *      the browser also sent an OIDC access token.
 *   2. Service/non-browser callers use Bearer token auth when present.
 *   3. Anonymous fallback is only allowed when SSO is disabled (local dev).
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getServerConfig } from "@/lib/config";
import {
  ApiError,
  getAuthenticatedUser,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from "@/lib/api-middleware";
import type { RbacResource, RbacScope } from "@/lib/rbac/types";

// ═══════════════════════════════════════════════════════════════
// Auth helper
// ═══════════════════════════════════════════════════════════════

export interface AuthResult {
  /** Stable caller subject for ReBAC/OpenFGA checks. */
  subject?: string;
  /** Human-readable email for privacy-aware audit display. */
  email?: string;
  /** Product role resolved by the UI auth middleware. */
  role?: string;
  /** Tenant/org context for audit scoping. */
  tenantId?: string;
  /** Base64-encoded JSON UserContext header, or undefined for anonymous */
  userContextHeader?: string;
  /**
   * The raw user JWT (Bearer access token) that authenticated this
   * request, when available. Forwarded to DA as ``Authorization:
   * Bearer <token>`` so DA's ``JwtAuthMiddleware`` can validate it
   * against Keycloak and bind ``current_user_token`` for downstream
   * MCP / AgentGateway calls. Browser sessions can temporarily fall back
   * to ``X-User-Context`` when the server-side token cache is lost.
   */
  bearerToken?: string;
  /** W3C trace context propagated from the Web UI backend authz span. */
  traceparent?: string;
  /**
   * Whether the caller authenticated as a Keycloak service account
   * (client-credentials). Propagated so OpenFGA checks graph the caller as
   * `service_account:<sub>` rather than `user:<sub>` (spec
   * 2026-06-05-service-accounts). assisted-by Claude claude-opus-4-8
   */
  isServiceAccount?: boolean;
}

export interface ProxyRbacPermission {
  resource: RbacResource;
  scope: RbacScope;
}

function schedulerTokenMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function authenticateSchedulerRunner(request: NextRequest): AuthResult | NextResponse | null {
  const schedulerToken = request.headers.get("X-Scheduler-Token");
  const ownerUser = request.headers.get("X-CAIPE-User");

  if (!schedulerToken && !ownerUser) return null;

  const expectedToken =
    process.env.SCHEDULER_SERVICE_TOKEN ||
    process.env.CAIPE_SCHEDULER_SERVICE_TOKEN ||
    "";

  if (!expectedToken) {
    console.error("[gateway] Scheduler auth requested but SCHEDULER_SERVICE_TOKEN is not configured");
    return NextResponse.json(
      { success: false, error: "Scheduler service token is not configured" },
      { status: 500 },
    );
  }

  if (!schedulerToken || !ownerUser || !schedulerTokenMatches(schedulerToken, expectedToken)) {
    return NextResponse.json(
      { success: false, error: "Invalid scheduler authentication" },
      { status: 401 },
    );
  }

  const userContext = {
    email: ownerUser,
    name: ownerUser,
    is_admin: false,
    is_authorized: true,
    can_view_admin: false,
    can_access_dynamic_agents: true,
    scheduler_run: true,
  };

  console.log(
    `[gateway] ${request.method} ${request.nextUrl.pathname} — auth=scheduler user=${ownerUser} client=caipe-cron-runner`,
  );

  return {
    userContextHeader: Buffer.from(JSON.stringify(userContext)).toString("base64"),
  };
}

/**
 * Resolve user identity from the request (session cookie or Bearer token).
 *
 * If the caller is authenticated, builds a base64-encoded ``X-User-Context``
 * header containing ``{ email, name, is_admin, is_authorized, can_view_admin,
 * can_access_dynamic_agents }``.  These are pre-computed boolean flags —
 * the DA backend treats them as opaque and passes them through to tools
 * like ``user_info``.
 *
 * Returns a 401 NextResponse if no valid auth is found and SSO is enabled.
 */
export async function authenticateRequest(
  request: NextRequest,
  permission?: ProxyRbacPermission,
): Promise<AuthResult | NextResponse> {
  const method = request.method;
  const path = request.nextUrl.pathname;
  const clientSource = request.headers.get("X-Client-Source") ?? "browser";
  const hasBearer = request.headers.has("Authorization");
  let authMethod = hasBearer ? "bearer" : "session";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";

  const schedulerAuth = authenticateSchedulerRunner(request);
  if (schedulerAuth) return schedulerAuth;

  try {
    let auth = null as Awaited<ReturnType<typeof getAuthFromBearerOrSession>> | null;

    if (clientSource === "browser") {
      try {
        auth = await getAuthenticatedUser(request, {
          allowAnonymous: !getServerConfig().ssoEnabled,
        });
        authMethod = "session";
      } catch {
        auth = null;
      }
    }

    if (!auth) {
      auth = await getAuthFromBearerOrSession(request);
      authMethod = hasBearer ? "bearer" : "session";
    }

    const { user, session } = auth;
    if (permission) {
      await requireRbacPermission(session, permission.resource, permission.scope);
    }

    console.log(
      `[gateway] ${method} ${path} — auth=${authMethod} user=${user.email} role=${user.role} client=${clientSource} ip=${ip} ua=${ua}`,
    );

    // Build X-User-Context from pre-computed authorization flags.
    // DA doesn't parse these — they pass through via extra="allow"
    // on UserContext and are available to the user_info tool.
    const s = session as Record<string, unknown>;
    const userContext = {
      email: user.email,
      name: user.name ?? null,
      is_admin: user.role === "admin",
      is_authorized: (s?.isAuthorized as boolean) ?? true,
      can_view_admin: (s?.canViewAdmin as boolean) ?? false,
      can_access_dynamic_agents: (s?.canAccessDynamicAgents as boolean) ?? false,
    };

    const encoded = Buffer.from(JSON.stringify(userContext)).toString("base64");
    const bearerToken = (s?.accessToken as string | undefined) || undefined;
    const subject = (s?.sub as string | undefined) || user.email;
    const tenantId = (s?.org as string | undefined) || "default";
    const isServiceAccount = (s?.isServiceAccount as boolean | undefined) === true;
    return { subject, email: user.email, role: user.role, tenantId, userContextHeader: encoded, bearerToken, isServiceAccount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Forward structured ApiError shape so the web UI / slack-bot can render
    // a specific message (e.g. "session expired — sign in again" vs
    // "token audience mismatch — contact admin") instead of a generic
    // "Unauthorized". Falls back to 401 NOT_SIGNED_IN for any non-ApiError
    // throw — current call sites only throw ApiError, but this keeps us
    // safe if a new auth path leaks a plain Error.
    if (err instanceof ApiError) {
      console.error(
        `[gateway] ${method} ${path} — auth=${authMethod} DENIED client=${clientSource} ip=${ip} ua=${ua} ` +
          `status=${err.statusCode} reason=${err.reason ?? "unknown"} code=${err.code ?? "-"} msg=${err.message}`,
      );
      return NextResponse.json(
        {
          success: false,
          error: err.message,
          code: err.code,
          reason: err.reason,
          action: err.action,
        },
        { status: err.statusCode },
      );
    }

    console.error(
      `[gateway] ${method} ${path} — auth=${authMethod} DENIED client=${clientSource} ip=${ip} ua=${ua} reason=${message}`,
    );
    return NextResponse.json(
      {
        success: false,
        error: "You are not signed in. Please sign in to continue.",
        code: "NOT_SIGNED_IN",
        reason: "not_signed_in",
        action: "sign_in",
      },
      { status: 401 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Dynamic Agents config check
// ═══════════════════════════════════════════════════════════════

export interface DynamicAgentsConfig {
  dynamicAgentsUrl: string;
}

/**
 * Validate that dynamic agents are enabled and return the URL.
 * Returns a NextResponse error on failure, or config on success.
 */
export function getDynamicAgentsConfig(): DynamicAgentsConfig | NextResponse {
  const config = getServerConfig();

  if (!config.dynamicAgentsEnabled) {
    return NextResponse.json(
      { success: false, error: "Dynamic agents are not enabled" },
      { status: 403 },
    );
  }

  if (!config.dynamicAgentsUrl) {
    return NextResponse.json(
      { success: false, error: "Dynamic agents URL not configured" },
      { status: 500 },
    );
  }

  return {
    dynamicAgentsUrl: config.dynamicAgentsUrl,
  };
}

// ═══════════════════════════════════════════════════════════════
// Backend headers builder
// ═══════════════════════════════════════════════════════════════

/**
 * Build headers for the proxied request to the DA backend.
 *
 * Always sets Content-Type.  Adds X-User-Context if the caller was
 * authenticated (so DA knows who the user is).
 */
export function buildBackendHeaders(
  contentType: string,
  authResult: AuthResult,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };
  if (authResult.userContextHeader) {
    headers["X-User-Context"] = authResult.userContextHeader;
  }
  if (authResult.bearerToken) {
    headers["Authorization"] = `Bearer ${authResult.bearerToken}`;
  }
  if (authResult.traceparent) {
    headers.traceparent = authResult.traceparent;
  }
  return headers;
}

// ═══════════════════════════════════════════════════════════════
// SSE proxy helper
// ═══════════════════════════════════════════════════════════════

/**
 * Standard SSE response headers for streaming proxies.
 */
const SSE_RESPONSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/**
 * Proxy a streaming request to the Dynamic Agents backend and pipe the
 * SSE response back to the client.
 *
 * @param backendUrl - Full URL to the backend streaming endpoint
 * @param body - JSON string body to forward (passed through as-is)
 * @param authResult - Auth result containing optional X-User-Context header
 * @param logPrefix - Log prefix for error messages (e.g. "[stream/start]")
 */
export async function proxySSEStream(
  backendUrl: string,
  body: string,
  authResult: AuthResult,
  logPrefix: string,
): Promise<Response> {
  const backendHeaders = buildBackendHeaders("application/json", authResult);
  backendHeaders["Accept"] = "text/event-stream";

  console.log(
    `${logPrefix} Forwarding to ${backendUrl} hasAuth=${!!backendHeaders["Authorization"]} hasUserCtx=${!!backendHeaders["X-User-Context"]}`,
  );

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: backendHeaders,
      body,
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(
        `${logPrefix} Backend error: ${backendResponse.status} ${backendResponse.statusText}`,
        errorText,
      );
      return NextResponse.json(
        {
          success: false,
          error: `Backend error: ${backendResponse.status} ${backendResponse.statusText}`,
        },
        { status: backendResponse.status },
      );
    }

    if (!backendResponse.body) {
      return NextResponse.json(
        { success: false, error: "Backend returned no body" },
        { status: 502 },
      );
    }

    return new Response(backendResponse.body, {
      status: 200,
      headers: SSE_RESPONSE_HEADERS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (
      message.includes("fetch failed") ||
      message.includes("ECONNREFUSED") ||
      (err instanceof TypeError && message.includes("fetch"))
    ) {
      console.error(`${logPrefix} Backend unreachable:`, message);
      return NextResponse.json(
        {
          success: false,
          error: "Dynamic agents service is not available. Please ensure it is running.",
        },
        { status: 503 },
      );
    }

    console.error(`${logPrefix} Proxy error:`, err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// JSON proxy helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Proxy a JSON POST request to the Dynamic Agents backend (non-streaming).
 * Used for cancel, invoke, clear, etc.
 */
export async function proxyJSONRequest(
  backendUrl: string,
  body: string,
  authResult: AuthResult,
  logPrefix: string,
): Promise<Response> {
  return proxyRequest(backendUrl, "POST", authResult, logPrefix, body);
}

/**
 * Proxy any HTTP method to the Dynamic Agents backend and return the
 * JSON response.  Handles error mapping and connection failures.
 *
 * @param backendUrl - Full URL to the backend endpoint
 * @param method - HTTP method (GET, POST, DELETE, etc.)
 * @param authResult - Auth result containing optional X-User-Context header
 * @param logPrefix - Log prefix for error messages
 * @param body - Optional JSON string body (for POST/PUT/PATCH)
 */
export async function proxyRequest(
  backendUrl: string,
  method: string,
  authResult: AuthResult,
  logPrefix: string,
  body?: string,
): Promise<Response> {
  const backendHeaders = buildBackendHeaders("application/json", authResult);

  try {
    const backendResponse = await fetch(backendUrl, {
      method,
      headers: backendHeaders,
      ...(body ? { body } : {}),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(`${logPrefix} Backend error: ${backendResponse.status}`, errorText);

      // Try to forward the backend's JSON error body as-is
      try {
        const parsed = JSON.parse(errorText);
        if (parsed && typeof parsed === "object") {
          return NextResponse.json(parsed, { status: backendResponse.status });
        }
      } catch {
        // Not JSON — fall through to generic message
      }

      return NextResponse.json(
        {
          success: false,
          error: `Backend error: ${backendResponse.status}`,
        },
        { status: backendResponse.status },
      );
    }

    const result = await backendResponse.json();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (
      message.includes("fetch failed") ||
      message.includes("ECONNREFUSED")
    ) {
      console.error(`${logPrefix} Backend unreachable:`, message);
      return NextResponse.json(
        {
          success: false,
          error: "Dynamic agents service is not available",
        },
        { status: 503 },
      );
    }

    console.error(`${logPrefix} Proxy error:`, err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
