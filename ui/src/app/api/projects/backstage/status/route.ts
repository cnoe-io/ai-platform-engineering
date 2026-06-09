// assisted-by Cursor Composer

import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  backstageConfiguredHost,
  isBackstageConfigured,
} from "@/lib/projects/backstage-client";
import { canManageProjectsOrganization } from "@/lib/projects/project-admin";

/** Lightweight readiness check — does not call Backstage (no VPN required). */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const configured = isBackstageConfigured();
  const canManage = await canManageProjectsOrganization(session);

  return successResponse({
    configured,
    can_manage: canManage,
    host: configured ? backstageConfiguredHost() : null,
  });
});

export const dynamic = "force-dynamic";
