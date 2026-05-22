import { NextRequest, NextResponse } from "next/server";
import { getInternalA2AUrl } from "@/lib/config";
import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  withErrorHandler,
} from "@/lib/api-middleware";

/**
 * GET /api/agents/tools
 *
 * Proxies to the supervisor's /tools endpoint to return the dynamically
 * discovered tool names grouped by subagent.  The supervisor builds this
 * mapping from the actual MCP tools loaded at startup.
 *
 * Requires mcp_server#read before forwarding the user's OAuth2 access token
 * so the supervisor request passes through downstream auth middleware.
 */
export const GET = withErrorHandler<unknown>(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "mcp_server", "read");

  const baseUrl = getInternalA2AUrl();

  const headers: Record<string, string> = { Accept: "application/json" };
  if (session.accessToken) {
    headers["Authorization"] = `Bearer ${session.accessToken}`;
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
});
