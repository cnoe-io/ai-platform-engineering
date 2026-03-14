import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getServerConfig } from "@/lib/config";

/**
 * GET /api/agents/tools
 *
 * Proxies to the supervisor's /tools endpoint to return the dynamically
 * discovered tool names grouped by subagent.  The supervisor builds this
 * mapping from the actual MCP tools loaded at startup.
 *
 * Forwards the user's OAuth2 access token so the request passes through
 * the supervisor's auth middleware.
 */
export async function GET() {
  const { caipeUrl } = getServerConfig();
  const baseUrl = caipeUrl.replace(/\/$/, "");

  const headers: Record<string, string> = { Accept: "application/json" };

  try {
    const session = await getServerSession(authOptions);
    if (session?.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }
  } catch {
    // Continue without auth — supervisor may allow unauthenticated access
  }

  try {
    const res = await fetch(`${baseUrl}/tools`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Supervisor returned ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json({ success: true, data: { tools: data.tools ?? {} } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Supervisor unreachable";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 502 },
    );
  }
}
