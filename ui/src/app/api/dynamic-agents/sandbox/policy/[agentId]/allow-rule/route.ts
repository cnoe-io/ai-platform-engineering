/**
 * API proxy route for adding allow rules to sandbox policy.
 *
 * POST /api/dynamic-agents/sandbox/policy/[agentId]/allow-rule
 * Body: { host, port, binary?, temporary? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { getAuthenticatedUser } from "@/lib/api-middleware";

export async function POST(
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const backendHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    backendHeaders["Authorization"] = `Bearer ${accessToken}`;
  }

  const backendUrl = `${dynamicAgentsUrl}/api/v1/sandbox/policy/${agentId}/allow-rule`;

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify(body),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "");
      console.error(
        `[sandbox/allow-rule] Backend error: ${backendResponse.status}`,
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
