/**
 * Unified gateway route for non-streaming Dynamic Agent invocation.
 *
 * POST /api/chat/conversations/:id/invoke
 * Body: { message, agent_id, trace_id?, client_context? }
 * Response: JSON { success, content, agent_id, conversation_id, trace_id }
 *
 * The conversationId comes from the URL path — it is NOT in the body.
 * Used by clients that cannot consume SSE streams (e.g. Slack bot users).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyJSONRequest,
} from "../stream/_helpers";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes — invoke runs the full agent loop

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

  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/invoke`;

  return proxyJSONRequest(
    backendUrl,
    JSON.stringify(backendPayload),
    authResult.accessToken,
    "[invoke]",
  );
}
