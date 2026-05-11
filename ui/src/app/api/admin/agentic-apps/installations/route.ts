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
  appendAgenticAppEvent,
  installAppPackage,
  listAppInstallations,
  listAppPackages,
} from "@/lib/agentic-apps/store";
import { normalizeAgenticAppMountPath } from "@/lib/agentic-apps/registry";

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
  return withAuth(request, async (requestInner, user, session) => {
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
    const [packages, installations] = await Promise.all([listAppPackages(), listAppInstallations()]);
    const pkg = packages.find((p) => p.packageId === packageId);
    if (!pkg) {
      throw new ApiError("package not found", 404);
    }
    const desiredMountPath =
      typeof body.runtimeMountPath === "string" && body.runtimeMountPath.trim()
        ? body.runtimeMountPath
        : pkg.manifest.runtime.mountPath;
    const normalizedMountPath = normalizeAgenticAppMountPath(desiredMountPath);
    if (!normalizedMountPath) {
      throw new ApiError("runtimeMountPath must stay under /apps/", 400);
    }
    const installedPackageIds = new Set(
      installations
        .filter((inst) => inst.appId !== appId && inst.installed !== false)
        .map((inst) => inst.packageId),
    );
    const packageById = new Map(packages.map((p) => [p.packageId, p]));
    const conflictingInstall = installations.find((inst) => {
      if (inst.appId === appId || inst.installed === false) {
        return false;
      }
      const existingPackage = packageById.get(inst.packageId);
      const existingMountPath =
        inst.routeOwnership?.normalizedMountPath ??
        normalizeAgenticAppMountPath(inst.runtimeMountPath ?? existingPackage?.manifest.runtime.mountPath ?? "");
      return existingMountPath === normalizedMountPath;
    });
    if (conflictingInstall || (installedPackageIds.has(packageId) && appId !== pkg.manifest.id)) {
      await appendAgenticAppEvent({
        type: "agentic_app_install_rejected",
        actorEmail: user.email,
        appId,
        packageId,
        payload: {
          reasonCode: "route_conflict",
          normalizedMountPath,
          conflictingAppId: conflictingInstall?.appId,
        },
      });
      throw new ApiError(`route conflict for ${normalizedMountPath}`, 409, "route_conflict");
    }

    const accessOverrides = parseStringArrayRecord(body.accessOverrides, [
      "requiredRoles",
      "requiredGroups",
    ]);
    const healthPolicy = parseHealthPolicy(body.healthPolicy);

    await installAppPackage({
      appId,
      packageId,
      ...(typeof body.installed === "boolean" ? { installed: body.installed } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.visible === "boolean" ? { visible: body.visible } : {}),
      ...(typeof body.isDefaultLanding === "boolean"
        ? { isDefaultLanding: body.isDefaultLanding }
        : {}),
      ...(typeof body.runtimeOriginOverride === "string"
        ? { runtimeOriginOverride: body.runtimeOriginOverride }
        : {}),
      ...(typeof body.runtimeMountPath === "string"
        ? { runtimeMountPath: body.runtimeMountPath }
        : {}),
      ...(accessOverrides !== undefined ? { accessOverrides } : {}),
      ...(healthPolicy !== undefined ? { healthPolicy } : {}),
      routeOwnership: { normalizedMountPath },
      updatedBy: user.email,
    });
    await appendAgenticAppEvent({
      type: "agentic_app_installation_updated",
      actorEmail: user.email,
      appId,
      packageId,
      payload: {
        installed: body.installed,
        enabled: body.enabled,
        visible: body.visible,
        normalizedMountPath,
      },
    });
    return successResponse({
      appId,
      packageId,
    });
  });
});

function parseStringArrayRecord(
  value: unknown,
  keys: Array<"requiredRoles" | "requiredGroups">,
): { requiredRoles?: string[]; requiredGroups?: string[] } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("accessOverrides must be an object", 400);
  }
  const raw = value as Record<string, unknown>;
  const out: { requiredRoles?: string[]; requiredGroups?: string[] } = {};
  for (const key of keys) {
    if (raw[key] === undefined) {
      continue;
    }
    if (!Array.isArray(raw[key]) || !raw[key].every((entry) => typeof entry === "string")) {
      throw new ApiError(`accessOverrides.${key} must be an array of strings`, 400);
    }
    out[key] = raw[key] as string[];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseHealthPolicy(
  value: unknown,
): { blockLaunchWhen?: Array<"unknown" | "degraded" | "unreachable"> } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("healthPolicy must be an object", 400);
  }
  const raw = value as Record<string, unknown>;
  if (raw.blockLaunchWhen === undefined) {
    return undefined;
  }
  const allowed = new Set(["unknown", "degraded", "unreachable"]);
  if (
    !Array.isArray(raw.blockLaunchWhen) ||
    !raw.blockLaunchWhen.every((entry) => typeof entry === "string" && allowed.has(entry))
  ) {
    throw new ApiError(
      "healthPolicy.blockLaunchWhen must include only unknown, degraded, or unreachable",
      400,
    );
  }
  return {
    blockLaunchWhen: raw.blockLaunchWhen as Array<"unknown" | "degraded" | "unreachable">,
  };
}
