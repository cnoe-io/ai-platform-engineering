/**
 * API proxy route for Dynamic Agent chat streaming (start).
 *
 * Forwards the browser's POST request to the Dynamic Agents backend
 * and pipes the SSE response back to the client without buffering.
 *
 * The browser cannot hit the backend directly (different host / internal URL),
 * so Next.js acts as a transparent SSE proxy.
 *
 * POST /api/dynamic-agents/chat/start-stream
 * Body: { message, conversation_id, agent_id }
 * Response: SSE stream (text/event-stream)
 *
 * The stream may end with an `input_required` event if the agent needs
 * user input. In that case, use /resume-stream to continue after form submission.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { getAuthenticatedUser } from "@/lib/api-middleware";

export const runtime = "nodejs";
// Disable body size limit for streaming responses
export const maxDuration = 300; // 5 minutes

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
  let session: { accessToken?: string };
  try {
    const auth = await getAuthenticatedUser(request);
    session = auth.session;
  } catch {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Parse the request body
  let body: { message: string; conversation_id: string; agent_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.message || !body.conversation_id || !body.agent_id) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: message, conversation_id, agent_id" },
      { status: 400 }
    );
  }

  // Build headers for the backend request
  const backendHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  };

  // Forward the access token to the Dynamic Agents backend
  if (session.accessToken) {
    backendHeaders["Authorization"] = `Bearer ${session.accessToken}`;
  }

  const backendUrl = `${dynamicAgentsUrl}/api/v1/chat/start-stream`;

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify(body),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(
        `[dynamic-agents/chat/start-stream] Backend error: ${backendResponse.status} ${backendResponse.statusText}`,
        errorText
      );
      return NextResponse.json(
        {
          success: false,
          error: `Backend error: ${backendResponse.status} ${backendResponse.statusText}`,
        },
        { status: backendResponse.status }
      );
    }

    // Pipe the SSE stream through to the client
    if (!backendResponse.body) {
      return NextResponse.json(
        { success: false, error: "Backend returned no body" },
        { status: 502 }
      );
    }

    // Return a streaming response that pipes the backend SSE through
    return new Response(backendResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Handle connection errors to the backend
    if (
      message.includes("fetch failed") ||
      message.includes("ECONNREFUSED") ||
      (err instanceof TypeError && message.includes("fetch"))
    ) {
      console.error("[dynamic-agents/chat/start-stream] Backend unreachable:", message);
      return NextResponse.json(
        {
          success: false,
          error: "Dynamic agents service is not available. Please ensure it is running.",
        },
        { status: 503 }
      );
    }

    console.error("[dynamic-agents/chat/start-stream] Proxy error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
