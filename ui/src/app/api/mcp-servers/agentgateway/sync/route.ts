import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { syncSelectedAgentGatewayMcpServers } from "../_lib";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "mcp_server", "manage");

  const body = await request.json();
  if (!Array.isArray(body.ids) || body.ids.some((id: unknown) => typeof id !== "string")) {
    throw new ApiError("ids must be an array of AgentGateway MCP target IDs", 400);
  }

  const result = await syncSelectedAgentGatewayMcpServers(body.ids);
  return successResponse(result);
});
