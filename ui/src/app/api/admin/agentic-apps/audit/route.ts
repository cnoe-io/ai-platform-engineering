// assisted-by Codex Codex-sonnet-4-6

import { NextRequest, NextResponse } from "next/server";

import { requireAgenticAppsInstallEnabled } from "@/lib/agentic-apps/guard";
import { queryAgenticAppAuditEvents } from "@/lib/agentic-apps/audit";
import {
  ApiError,
  requireAdminView,
  withAuth,
  withErrorHandler,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  if (!isMongoDBConfigured) throw new ApiError("MongoDB is required for Agentic Apps", 503);

  return withAuth(request, async (_req, _user, session) => {
    requireAdminView(session);
    const url = new URL(request.url);
    const events = await queryAgenticAppAuditEvents({
      appId: optionalParam(url, "appId"),
      decisionId: optionalParam(url, "decisionId"),
      correlationId: optionalParam(url, "correlationId"),
      reasonCode: optionalParam(url, "reasonCode"),
      type: optionalParam(url, "type"),
      limit: Number(url.searchParams.get("limit") ?? "50"),
    });
    return NextResponse.json({ items: events });
  });
});

function optionalParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value && value.trim() ? value.trim() : undefined;
}
