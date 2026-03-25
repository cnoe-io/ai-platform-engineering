/**
 * API proxy route for cancelling Dynamic Agent streams.
 *
 * Requests the backend to cancel an active streaming request.
 * The stream will exit gracefully at the next chunk boundary.
 *
 * POST /api/dynamic-agents/chat/cancel
 * Body: { agent_id, session_id }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { getAuthenticatedUser } from "@/lib/api-middleware";

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

  // Authenticate the request
  let accessToken: string | undefined;
  try {
    const { session } = await getAuthenticatedUser(request);
    accessToken = "accessToken" in session ? session.accessToken : undefined;
  } catch {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
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

  // Forward the access token to the Dynamic Agents backend
  if (accessToken) {
    backendHeaders["Authorization"] = `Bearer ${accessToken}`;
  }

  const backendUrl = `${dynamicAgentsUrl}/api/v1/chat/cancel`;

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify(body),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(
        `[dynamic-agents/chat/cancel] Backend error: ${backendResponse.status}`,
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
      console.error("[dynamic-agents/chat/cancel] Backend unreachable:", message);
      return NextResponse.json(
        {
          success: false,
          error: "Dynamic agents service is not available",
        },
        { status: 503 }
      );
    }

    console.error("[dynamic-agents/chat/cancel] Proxy error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
