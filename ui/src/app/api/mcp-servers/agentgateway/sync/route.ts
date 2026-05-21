import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { syncSelectedAgentGatewayMcpServers } from "../_lib";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireResourcePermission(
    session,
    {
      type: "mcp_server",
      id: "agentgateway",
      action: "admin",
    }
  );

  const body = await request.json().catch(() => ({}));
  if (
    body.ids !== undefined &&
    (!Array.isArray(body.ids) || body.ids.some((id: unknown) => typeof id !== "string"))
  ) {
    throw new ApiError("ids must be an array of AgentGateway MCP target IDs", 400);
  }

  const result = await syncSelectedAgentGatewayMcpServers(body.ids);
  return successResponse(result);
});
