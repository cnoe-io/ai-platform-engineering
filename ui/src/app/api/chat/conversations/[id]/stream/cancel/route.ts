/**
 * Unified gateway route for cancelling a Dynamic Agent stream.
 *
 * POST /api/chat/conversations/:id/stream/cancel
 * Body: { agent_id }
 * Response: JSON { cancelled: boolean }
 *
 * The conversationId comes from the URL path.
 * Requests the backend to cancel an active streaming request.
 * The stream will exit gracefully at the next chunk boundary.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyJSONRequest,
} from "../_helpers";

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
  let body: { agent_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.agent_id) {
    return NextResponse.json(
      { success: false, error: "Missing required field: agent_id" },
      { status: 400 },
    );
  }

  // Backend expects { agent_id, conversation_id }
  const backendBody = JSON.stringify({
    agent_id: body.agent_id,
    conversation_id: conversationId,
  });

  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/stream/cancel`;

  return proxyJSONRequest(
    backendUrl,
    backendBody,
    authResult.accessToken,
    "[stream/cancel]",
  );
}
