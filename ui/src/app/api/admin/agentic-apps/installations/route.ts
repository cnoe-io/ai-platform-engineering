// assisted-by Codex Codex-sonnet-4-6

import { NextRequest, NextResponse } from "next/server";
import { isMongoDBConfigured } from "@/lib/mongodb";
import {
  ApiError,
  requireAdmin,
  requireAdminView,
  successResponse,
  validateRequired,
  withAuth,
  withErrorHandler,
} from "@/lib/api-middleware";
import { requireAgenticAppsInstallEnabled } from "@/lib/agentic-apps/guard";
import { AGENTIC_APP_ID_PATTERN } from "@/lib/agentic-apps/manifest-validation";
import {
  installAppPackage,
  listAppInstallations,
  listAppPackages,
} from "@/lib/agentic-apps/store";

function requireAgenticResourceId(value: unknown, field: "appId" | "packageId"): string {
  if (typeof value !== "string" || !AGENTIC_APP_ID_PATTERN.test(value)) {
    throw new ApiError(
      `${field} must be a string matching ${String(AGENTIC_APP_ID_PATTERN)}`,
      400,
    );
  }
  return value;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  if (!isMongoDBConfigured) throw new ApiError("MongoDB is required for Agentic Apps", 503);
  return withAuth(request, async (_req, _user, session) => {
    requireAdminView(session);
    const [installations, packages] = await Promise.all([
      listAppInstallations(),
      listAppPackages(),
    ]);
    return NextResponse.json({ installations, packages });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  if (!isMongoDBConfigured) throw new ApiError("MongoDB is required for Agentic Apps", 503);
  return withAuth(request, async (requestInner, _user, session) => {
    requireAdmin(session);
    let body: Record<string, unknown>;
    try {
      body = (await requestInner.json()) as Record<string, unknown>;
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }
    validateRequired(body, ["appId", "packageId"]);
    const appId = requireAgenticResourceId(body.appId, "appId");
    const packageId = requireAgenticResourceId(body.packageId, "packageId");
    await installAppPackage({
      appId,
      packageId,
      ...(typeof body.installed === "boolean" ? { installed: body.installed } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.isDefaultLanding === "boolean"
        ? { isDefaultLanding: body.isDefaultLanding }
        : {}),
    });
    return successResponse({
      appId,
      packageId,
    });
  });
});
