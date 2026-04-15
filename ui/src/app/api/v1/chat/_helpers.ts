/**
 * Shared helpers for /api/v1/chat/ gateway routes.
 *
 * These routes are transparent proxies to the Dynamic Agents backend.
 * The gateway is the auth boundary:
 *
 * - **Authenticated callers** (UI browser): user is resolved from the
 *   NextAuth session cookie and injected as a trusted ``X-User-Context``
 *   header (base64-encoded JSON) on the proxied request.
 *
 * - **Unauthenticated callers** (Slack bot, test scripts): no session,
 *   no header.  DA falls back to a shared default service identity.
 *
 * Full RBAC is planned for 0.5.0.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { getAuthenticatedUser } from "@/lib/api-middleware";

// ═══════════════════════════════════════════════════════════════
// Auth helper
// ═══════════════════════════════════════════════════════════════

export interface AuthResult {
  /** Base64-encoded JSON UserContext header, or undefined for anonymous */
  userContextHeader?: string;
}

/**
 * Resolve user identity from the request (session cookie or Bearer token).
 *
 * If the caller is authenticated, builds a base64-encoded ``X-User-Context``
 * header containing ``{ email, name, is_admin, is_authorized, can_view_admin,
 * can_access_dynamic_agents }``.  These are pre-computed boolean flags —
 * the DA backend treats them as opaque and passes them through to tools
 * like ``user_info``.  No group arrays are sent (they were removed from
 * the session to keep cookie size under 4KB).
 *
 * If the caller is unauthenticated (e.g. Slack bot), returns an empty
 * result — DA will use its default internal user.
 */
export async function authenticateRequest(
  request: NextRequest,
): Promise<AuthResult> {
  try {
    const { user, session } = await getAuthenticatedUser(request, {
      allowAnonymous: true,
    });

    // Build X-User-Context from pre-computed authorization flags.
    // DA doesn't parse these — they pass through via extra="allow"
    // on UserContext and are available to the user_info tool.
    //
    // Cast session to Record to access optional fields that may not
    // be present on the anonymous fallback type (which only has
    // { role, canViewAdmin }).
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
    return { userContextHeader: encoded };
  } catch {
    // No session / unauthenticated — DA will use its default user
    return {};
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
function buildBackendHeaders(
  contentType: string,
  authResult: AuthResult,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };
  if (authResult.userContextHeader) {
    headers["X-User-Context"] = authResult.userContextHeader;
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

/**
 * Proxy a JSON request to the Dynamic Agents backend (non-streaming).
 * Used for cancel and invoke.
 */
export async function proxyJSONRequest(
  backendUrl: string,
  body: string,
  authResult: AuthResult,
  logPrefix: string,
): Promise<Response> {
  const backendHeaders = buildBackendHeaders("application/json", authResult);

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: backendHeaders,
      body,
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(`${logPrefix} Backend error: ${backendResponse.status}`, errorText);
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
