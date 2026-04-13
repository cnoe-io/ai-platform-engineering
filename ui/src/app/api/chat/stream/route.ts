import { NextRequest } from "next/server";

/**
 * Proxy route: POST /api/chat/stream
 *
 * SUPERVISOR ONLY — this route proxies to the Supervisor (Platform Engineer) backend.
 * @deprecated Supervisor is being removed in 0.5.0. Use /api/chat/conversations/[id]/stream/* instead.
 *
 * Forwards requests to the backend AG-UI/SSE endpoint and streams the
 * response back to the client. This avoids CORS issues and lets us
 * forward the user's auth token server-side.
 *
 * Backend URL is configured via SUPERVISOR_SSE_URL env var. For local dev
 * with Docker, this should be http://caipe-supervisor:8000/chat/stream or
 * http://localhost:8000/chat/stream if the supervisor is on the host.
 */

// Force dynamic rendering to enable streaming
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Default to localhost for local dev (UI running via npm run dev on host)
  // In Docker, set SUPERVISOR_SSE_URL=http://caipe-supervisor:8000/chat/stream
  const backendUrl =
    process.env.SUPERVISOR_SSE_URL || "http://localhost:8000/chat/stream";

  console.log(`[chat/stream proxy] Forwarding to: ${backendUrl}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  };

  // Forward the Authorization header if present
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`[chat/stream proxy] Backend error: ${response.status} ${response.statusText}`);
      return new Response(
        JSON.stringify({ error: `Backend error: ${response.statusText}` }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Create a TransformStream to pass through the SSE data
    const { readable, writable } = new TransformStream();

    // Pipe the backend response to the client
    response.body?.pipeTo(writable).catch((err) => {
      console.error(`[chat/stream proxy] Pipe error:`, err);
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error(`[chat/stream proxy] Fetch error:`, error);
    return new Response(
      JSON.stringify({ error: `Failed to connect to backend: ${error}` }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
