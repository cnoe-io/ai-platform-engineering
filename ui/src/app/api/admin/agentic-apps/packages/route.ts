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
import { validateAgenticAppManifest } from "@/lib/agentic-apps/manifest-validation";
import { parseAgenticPackageCatalogInput } from "@/lib/agentic-apps/package-catalog-input";
import {
  appendAgenticAppEvent,
  listAppPackages,
  upsertAppPackageFromManifest,
} from "@/lib/agentic-apps/store";
import type { AgenticAppPackageSource } from "@/types/agentic-app";

const SOURCES = new Set<AgenticAppPackageSource>(["builtin", "admin-import", "helm", "api"]);

function parseSource(value: unknown): AgenticAppPackageSource {
  if (typeof value === "string" && SOURCES.has(value as AgenticAppPackageSource)) {
    return value as AgenticAppPackageSource;
  }
  return "admin-import";
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  if (!isMongoDBConfigured) throw new ApiError("MongoDB is required for Agentic Apps", 503);
  return withAuth(request, async (_req, _user, session) => {
    requireAdminView(session);
    return NextResponse.json({ items: await listAppPackages() });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  if (!isMongoDBConfigured) throw new ApiError("MongoDB is required for Agentic Apps", 503);
  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }
    validateRequired(body, ["manifest"]);
    const result = validateAgenticAppManifest(body.manifest);
    if (result.ok === false) {
      throw new ApiError(result.errors.join("; "), 400);
    }
    const packageId =
      typeof body.packageId === "string" ? body.packageId : result.manifest.id;
    if (packageId !== result.manifest.id) {
      throw new ApiError("packageId must match manifest.id", 400);
    }
    const source = parseSource(body.source);
    const catalog = parseAgenticPackageCatalogInput(body.catalog);

    await upsertAppPackageFromManifest({
      packageId,
      source,
      manifest: result.manifest,
      importedAt: new Date().toISOString(),
      importedBy: user.email,
      ...(catalog !== undefined ? { catalog } : {}),
    });

    await appendAgenticAppEvent({
      type: "agentic_app_package_upserted",
      actorEmail: user.email,
      packageId,
      payload: { source, warnings: result.warnings },
    });

    return successResponse({ packageId, warnings: result.warnings });
  });
});
