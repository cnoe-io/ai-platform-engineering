/**
 * Shared helpers for unified streaming gateway routes.
 *
 * All streaming routes under /api/chat/conversations/[id]/stream/ proxy
 * requests to the appropriate backend based on the conversation's agent_id.
 *
 * Current routing:
 *   - agent_id present → Dynamic Agents service (DYNAMIC_AGENTS_URL)
 *   - agent_id absent  → Supervisor (not yet implemented — Phase 4)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { getAuthenticatedUser } from "@/lib/api-middleware";

// ═══════════════════════════════════════════════════════════════
// Auth helper
// ═══════════════════════════════════════════════════════════════

export interface AuthResult {
  accessToken?: string;
}

/**
 * Authenticate the request and extract the access token.
 * Returns a NextResponse error on failure, or AuthResult on success.
 */
export async function authenticateRequest(
  request: NextRequest,
): Promise<AuthResult | NextResponse> {
  try {
    const { session } = await getAuthenticatedUser(request, {
      allowAnonymous: !getServerConfig().ssoEnabled,
    });
    const accessToken = "accessToken" in session ? session.accessToken : undefined;
    return { accessToken } as AuthResult;
  } catch {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Dynamic Agents config check
// ═══════════════════════════════════════════════════════════════

export interface DynamicAgentsConfig {
  dynamicAgentsUrl: string;
  agentProtocol: string;
}

/**
 * Validate that dynamic agents are enabled and return the URL + protocol.
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
    agentProtocol: config.agentProtocol,
  };
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
 * @param body - JSON string body to forward
 * @param accessToken - Optional Bearer token
 * @param logPrefix - Log prefix for error messages (e.g. "[stream/start]")
 */
export async function proxySSEStream(
  backendUrl: string,
  body: string,
  accessToken: string | undefined,
  logPrefix: string,
): Promise<Response> {
  const backendHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  };
  if (accessToken) {
    backendHeaders["Authorization"] = `Bearer ${accessToken}`;
  }

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
 * Used for cancel.
 */
export async function proxyJSONRequest(
  backendUrl: string,
  body: string,
  accessToken: string | undefined,
  logPrefix: string,
): Promise<Response> {
  const backendHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    backendHeaders["Authorization"] = `Bearer ${accessToken}`;
  }

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
