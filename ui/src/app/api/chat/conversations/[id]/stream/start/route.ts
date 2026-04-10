/**
 * Unified gateway route for starting a Dynamic Agent stream.
 *
 * POST /api/chat/conversations/:id/stream/start
 * Body: { message, agent_id }
 * Response: SSE stream (text/event-stream)
 *
 * The conversationId comes from the URL path — it is NOT in the body.
 * The route authenticates the request, validates the body, and proxies
 * to the Dynamic Agents backend.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxySSEStream,
} from "../_helpers";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: conversationId } = await params;

  // Authenticate
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  // Check dynamic agents config
  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  // Parse body
  let body: { message: string; agent_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.message || !body.agent_id) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: message, agent_id" },
      { status: 400 },
    );
  }

  // Build backend request body — inject conversationId from URL path
  const backendBody = JSON.stringify({
    message: body.message,
    conversation_id: conversationId,
    agent_id: body.agent_id,
  });

  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/stream/start?protocol=${daConfig.agentProtocol}`;

  return proxySSEStream(
    backendUrl,
    backendBody,
    authResult.accessToken,
    "[stream/start]",
  );
}
