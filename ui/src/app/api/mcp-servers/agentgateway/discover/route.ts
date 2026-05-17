import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { fetchAgentGatewayMcpDiscovery } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "mcp_server", "manage");

  const discovery = await fetchAgentGatewayMcpDiscovery();
  return successResponse(discovery);
});
