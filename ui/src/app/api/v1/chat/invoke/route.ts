/**
 * POST /api/v1/chat/invoke — transparent proxy to Dynamic Agents.
 *
 * Body: { message, conversation_id, agent_id, trace_id?, client_context? }
 * Response: JSON { success, content, agent_id, conversation_id, trace_id }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyJSONRequest,
} from "../_helpers";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes — invoke runs the full agent loop

export async function POST(request: NextRequest): Promise<Response> {
  // Resolve user identity (if authenticated)
  const authResult = await authenticateRequest(request);

  // Check dynamic agents config
  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.message || !body.conversation_id || !body.agent_id) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: message, conversation_id, agent_id" },
      { status: 400 },
    );
  }

  // Forward body as-is to DA backend (same path, same body format)
  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/invoke`;

  return proxyJSONRequest(
    backendUrl,
    JSON.stringify(body),
    authResult,
    "[invoke]",
  );
}
