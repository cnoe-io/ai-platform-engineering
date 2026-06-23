// assisted-by claude code claude-sonnet-4-6
import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const backstageUrl =
    process.env.BACKSTAGE_URL?.trim() || process.env.BACKSTAGE_API_URL?.trim();
  const backstageToken = process.env.BACKSTAGE_API_TOKEN?.trim();

  const configured = Boolean(backstageUrl && backstageToken);

  const { session } = await getAuthFromBearerOrSession(request);
  const canManage = await canManageProjectsOrganization(session);

  return successResponse({ configured, can_manage: canManage });
});
