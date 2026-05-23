import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { fetchAgentGatewayMcpDiscovery } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireResourcePermission(
    session,
    {
      type: "mcp_server",
      id: "agentgateway",
      action: "discover",
    }
  );

  const discovery = await fetchAgentGatewayMcpDiscovery();
  return successResponse(discovery);
});
