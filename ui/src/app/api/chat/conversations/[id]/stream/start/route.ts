/**
 * Unified gateway route for starting a Dynamic Agent stream.
 *
 * POST /api/chat/conversations/:id/stream/start
 * Body: { message, agent_id, trace_id?, client_context? }
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
  let body: {
    message: string;
    agent_id: string;
    trace_id?: string | null;
    client_context?: Record<string, unknown> | null;
  };
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
  const backendPayload: Record<string, unknown> = {
    message: body.message,
    conversation_id: conversationId,
    agent_id: body.agent_id,
  };
  if (body.trace_id) backendPayload.trace_id = body.trace_id;
  if (body.client_context) backendPayload.client_context = body.client_context;

  // Forward protocol query param from the request (default to server config)
  const protocol = request.nextUrl.searchParams.get("protocol") || daConfig.agentProtocol;
  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/stream/start?protocol=${protocol}`;

  return proxySSEStream(
    backendUrl,
    JSON.stringify(backendPayload),
    authResult.accessToken,
    "[stream/start]",
  );
}
