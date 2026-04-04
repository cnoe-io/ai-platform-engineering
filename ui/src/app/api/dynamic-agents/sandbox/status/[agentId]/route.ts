/**
 * API proxy route for sandbox status.
 *
 * GET /api/dynamic-agents/sandbox/status/[agentId] - Get sandbox provisioning status
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { getAuthenticatedUser } from "@/lib/api-middleware";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
): Promise<Response> {
  const { agentId } = await context.params;
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

  const backendHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    backendHeaders["Authorization"] = `Bearer ${accessToken}`;
  }

  const backendUrl = `${dynamicAgentsUrl}/api/v1/sandbox/status/${agentId}`;

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "GET",
      headers: backendHeaders,
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(
        `[sandbox/status] Backend error: ${backendResponse.status}`,
        errorText
      );
      return NextResponse.json(
        { success: false, error: `Backend error: ${backendResponse.status}` },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("fetch failed") || message.includes("ECONNREFUSED")) {
      return NextResponse.json(
        { success: false, error: "Dynamic agents service is not available" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
