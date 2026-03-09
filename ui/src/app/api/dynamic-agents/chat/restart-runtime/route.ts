/**
 * API proxy route for restarting Dynamic Agent runtime.
 *
 * Invalidates the cached agent runtime, forcing it to reconnect
 * to MCP servers on the next message. Useful when MCP servers
 * come back online after being unavailable.
 *
 * POST /api/dynamic-agents/chat/restart-runtime
 * Body: { agent_id, session_id }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";

export async function POST(request: NextRequest): Promise<Response> {
  const config = getServerConfig();

  if (!config.dynamicAgentsEnabled) {
    return NextResponse.json(
      { success: false, error: "Dynamic agents are not enabled" },
      { status: 403 }
    );
  }

  const dynamicAgentsUrl = config.dynamicAgentsUrl;
  if (!dynamicAgentsUrl) {
    return NextResponse.json(
      { success: false, error: "Dynamic agents URL not configured" },
      { status: 500 }
    );
  }

  // Parse the request body
  let body: { agent_id: string; session_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.agent_id || !body.session_id) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: agent_id, session_id" },
      { status: 400 }
    );
  }

  // Build headers for the backend request
  const backendHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Forward the access token if present
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    backendHeaders["Authorization"] = authHeader;
  }

  const backendUrl = `${dynamicAgentsUrl}/api/v1/chat/restart-runtime`;

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify(body),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(
        `[dynamic-agents/chat/restart-runtime] Backend error: ${backendResponse.status}`,
        errorText
      );
      return NextResponse.json(
        {
          success: false,
          error: `Backend error: ${backendResponse.status}`,
        },
        { status: backendResponse.status }
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
      console.error("[dynamic-agents/chat/restart-runtime] Backend unreachable:", message);
      return NextResponse.json(
        {
          success: false,
          error: "Dynamic agents service is not available",
        },
        { status: 503 }
      );
    }

    console.error("[dynamic-agents/chat/restart-runtime] Proxy error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
