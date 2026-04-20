/**
 * Unified gateway route for resuming a Dynamic Agent stream after HITL.
 *
 * POST /api/chat/conversations/:id/stream/resume
 * Body: { agent_id, form_data, trace_id?, client_context? }
 * Response: SSE stream (text/event-stream)
 *
 * The conversationId comes from the URL path — it is NOT in the body.
 * Call this after the user submits (or dismisses) a HITL form that was
 * requested via an `input_required` event from /stream/start.
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
    agent_id: string;
    form_data: string;
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

  if (!body.agent_id || body.form_data === undefined) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: agent_id, form_data" },
      { status: 400 },
    );
  }

  // Build backend request body — inject conversationId from URL path
  const backendPayload: Record<string, unknown> = {
    conversation_id: conversationId,
    agent_id: body.agent_id,
    form_data: body.form_data,
  };
  if (body.trace_id) backendPayload.trace_id = body.trace_id;
  if (body.client_context) backendPayload.client_context = body.client_context;

  // Forward protocol query param from the request (default to server config)
  const protocol = request.nextUrl.searchParams.get("protocol") || daConfig.agentProtocol;
  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/stream/resume?protocol=${protocol}`;

  return proxySSEStream(
    backendUrl,
    JSON.stringify(backendPayload),
    authResult.accessToken,
    "[stream/resume]",
  );
}
