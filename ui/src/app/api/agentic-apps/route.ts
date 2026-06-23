// assisted-by claude code claude-sonnet-4-6
//
// GET /api/agentic-apps — public list of installed + enabled apps for the nav
// and TopNavSettingsTab. Returns a minimal shape; no infrastructure URLs leaked.

import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { evaluateAppAccess, buildEffectiveAppsUserContext } from "@/lib/agentic-apps/access";
import { buildPublicAgenticAppDetailPayload } from "@/lib/agentic-apps/public-detail-dto";
import {
  getEnabledAgenticApps,
  isAgenticAppsInstallEnabled,
} from "@/lib/agentic-apps/registry";
import {
  listAppInstallations,
  listAppPackages,
  userPassesAgenticAppAccessGates,
} from "@/lib/agentic-apps/store";
import { isMongoDBConfigured } from "@/lib/mongodb";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isAgenticAppsInstallEnabled()) {
    return successResponse({ items: [] });
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  const userCtx = buildEffectiveAppsUserContext(
    { email: user.email ?? "anonymous", name: user.email ?? "anonymous", role: "user" },
    session,
  );

  const items: unknown[] = [];
  const seenIds = new Set<string>();

  if (isMongoDBConfigured) {
    const [installations, packages] = await Promise.all([
      listAppInstallations(),
      listAppPackages(),
    ]);
    const byPackageId = new Map(packages.map((p) => [p.packageId, p]));

    for (const inst of installations) {
      if (!inst.installed || inst.visible === false) continue;
      const pkg = byPackageId.get(inst.packageId);
      if (!pkg) continue;

      const accessResult = evaluateAppAccess({ user: userCtx, session, pkg, installation: inst });
      items.push(
        buildPublicAgenticAppDetailPayload({
          pkg,
          installation: inst,
          accessResult,
          runtimeStatus: inst.runtimeHealth ?? "unknown",
        }),
      );
      seenIds.add(pkg.manifest.id);
    }
  }

  // Supplement with env-enabled built-ins not yet in MongoDB
  for (const manifest of getEnabledAgenticApps()) {
    if (seenIds.has(manifest.id)) continue;
    const canLaunch = userPassesAgenticAppAccessGates(manifest, userCtx);
    items.push({
      appId: manifest.id,
      packageId: manifest.id,
      href: manifest.runtime.mountPath,
      displayName: manifest.displayName,
      canLaunch,
      surfaces: manifest.surfaces,
      installation: { installed: true, enabled: true },
      package: {
        id: manifest.id,
        displayName: manifest.displayName,
        description: manifest.description,
        surfaces: manifest.surfaces,
        runtime: { kind: manifest.runtime.kind, mountPath: manifest.runtime.mountPath },
      },
    });
  }

  return successResponse({ items });
});
