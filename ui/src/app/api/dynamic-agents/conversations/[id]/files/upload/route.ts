/**
 * Proxy route for uploading dynamic agent conversation files.
 *
 * POST /api/dynamic-agents/conversations/[id]/files/upload?agent_id=X
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
} from "@/lib/da-proxy";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: conversationId } = await context.params;

  if (!conversationId) {
    return NextResponse.json(
      { success: false, error: "Conversation ID is required" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId) {
    return NextResponse.json(
      { success: false, error: "agent_id query parameter is required" },
      { status: 400 },
    );
  }

  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid multipart form data" },
      { status: 400 },
    );
  }

  if (formData.getAll("files").length === 0) {
    return NextResponse.json(
      { success: false, error: "At least one file is required" },
      { status: 400 },
    );
  }

  const backendUrl = new URL(
    `/api/v1/conversations/${conversationId}/files/upload`,
    daConfig.dynamicAgentsUrl,
  );
  backendUrl.searchParams.set("agent_id", agentId);

  const headers: Record<string, string> = {};
  if (authResult.userContextHeader) {
    headers["X-User-Context"] = authResult.userContextHeader;
  }

  try {
    const backendResponse = await fetch(backendUrl.toString(), {
      method: "POST",
      headers,
      body: formData,
    });

    const responseText = await backendResponse.text();
    let payload: unknown = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = { success: false, error: responseText };
      }
    }

    return NextResponse.json(payload ?? {}, { status: backendResponse.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (
      message.includes("fetch failed") ||
      message.includes("ECONNREFUSED")
    ) {
      return NextResponse.json(
        { success: false, error: "Dynamic agents service is not available" },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
