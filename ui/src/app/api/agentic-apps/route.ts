// assisted-by claude code claude-sonnet-4-6
//
// GET /api/agentic-apps — public list of installed + enabled apps for the nav
// and TopNavSettingsTab. Returns a minimal shape; no infrastructure URLs leaked.

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  evaluateAppAccess,
  buildEffectiveAppsUserContext,
  type EvaluateAppAccessResult,
} from "@/lib/agentic-apps/access";
import { evaluateAgenticAppCasCompatibility } from "@/lib/agentic-apps/cas-compat";
import { deriveAgenticAppSubjectId } from "@/lib/agentic-apps/identity";
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
    { email: user.email ?? "anonymous", role: "user" },
    session,
  );
  const subjectId = deriveAgenticAppSubjectId(
    session as Record<string, unknown>,
    user.email ?? "anonymous",
  );
  const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();

  const items: unknown[] = [];
  const seenIds = new Set<string>();
  const installationByAppId = new Map<
    string,
    Awaited<ReturnType<typeof listAppInstallations>>[number]
  >();

  if (isMongoDBConfigured) {
    const [installations, packages] = await Promise.all([
      listAppInstallations(),
      listAppPackages(),
    ]);
    const byPackageId = new Map(packages.map((p) => [p.packageId, p]));
    for (const installation of installations) {
      installationByAppId.set(installation.appId, installation);
    }

    for (const inst of installations) {
      if (!inst.installed || inst.visible === false) continue;
      const pkg = byPackageId.get(inst.packageId);
      if (!pkg) continue;

      const canView = await applyCasGate({
        appId: inst.appId,
        subjectId,
        localAllowed: true,
        correlationId,
        hasCasContract: Boolean(pkg.manifest.authorization),
        action: "read",
      });
      if (!canView) continue;

      const localAccess = evaluateAppAccess({ user, session, pkg, installation: inst });
      const [canLaunch, canManage] = await Promise.all([
        applyCasGate({
          appId: inst.appId,
          subjectId,
          localAllowed: localAccess.canLaunch,
          correlationId,
          hasCasContract: Boolean(pkg.manifest.authorization),
          action: "use",
        }),
        applyCasGate({
          appId: inst.appId,
          subjectId,
          localAllowed: true,
          correlationId,
          hasCasContract: Boolean(pkg.manifest.authorization),
          action: "manage",
        }),
      ]);
      const accessResult: EvaluateAppAccessResult = canLaunch
        ? localAccess
        : {
            ...localAccess,
            canLaunch: false,
            blockedReasons: localAccess.canLaunch
              ? ["unauthorized"]
              : localAccess.blockedReasons,
          };
      items.push(
        buildPublicAgenticAppDetailPayload({
          pkg,
          installation: inst,
          accessResult,
          runtimeStatus: inst.runtimeHealth ?? "unknown",
          canManage,
        }),
      );
      seenIds.add(pkg.manifest.id);
    }
  }

  // Supplement with env-enabled built-ins not yet in MongoDB
  for (const manifest of getEnabledAgenticApps()) {
    if (seenIds.has(manifest.id)) continue;
    const localCanLaunch = userPassesAgenticAppAccessGates(manifest, userCtx);
    const canView = await applyCasGate({
      appId: manifest.id,
      subjectId,
      localAllowed: true,
      correlationId,
      hasCasContract: Boolean(manifest.authorization),
      action: "read",
    });
    if (!canView) continue;
    const canLaunch = await applyCasGate({
      appId: manifest.id,
      subjectId,
      localAllowed: localCanLaunch,
      correlationId,
      hasCasContract: Boolean(manifest.authorization),
      action: "use",
    });
    const canManage = await applyCasGate({
      appId: manifest.id,
      subjectId,
      localAllowed: true,
      correlationId,
      hasCasContract: Boolean(manifest.authorization),
      action: "manage",
    });
    const installation = installationByAppId.get(manifest.id);
    items.push({
      appId: manifest.id,
      packageId: manifest.id,
      href: manifest.runtime.mountPath,
      displayName: manifest.displayName,
      description: manifest.description,
      canLaunch,
      blockedReasons: canLaunch ? [] : ["unauthorized"],
      surfaces: manifest.surfaces,
      ...(manifest.ui ? { ui: manifest.ui } : {}),
      ...(manifest.assistant !== undefined
        ? {
            assistantEnabled: manifest.assistant.enabled ?? true,
            ...(manifest.assistant.agentId !== undefined
              ? { assistantAgentId: manifest.assistant.agentId }
              : {}),
            ...(manifest.assistant.label !== undefined
              ? { assistantLabel: manifest.assistant.label }
              : {}),
            ...(manifest.assistant.agentName !== undefined
              ? { assistantAgentName: manifest.assistant.agentName }
              : {}),
          }
        : {}),
      installation: {
        installed: true,
        enabled: true,
        visibility: installation?.visibility ?? "global",
        sharedWithTeams: installation?.sharedWithTeams ?? [],
        createdBy: installation?.createdBy ?? "Deployment config",
        canManage,
      },
      package: {
        id: manifest.id,
        displayName: manifest.displayName,
        description: manifest.description,
        surfaces: manifest.surfaces,
        runtime: { kind: manifest.runtime.kind, mountPath: manifest.runtime.mountPath },
        ...(manifest.ui ? { ui: manifest.ui } : {}),
      },
    });
  }

  return successResponse({ items });
});

async function applyCasGate(input: {
  appId: string;
  subjectId: string;
  localAllowed: boolean;
  correlationId: string;
  hasCasContract: boolean;
  action: "read" | "use" | "manage";
}): Promise<boolean> {
  if (!input.localAllowed || !input.hasCasContract) return input.localAllowed;
  const decision = await evaluateAgenticAppCasCompatibility({
    appId: input.appId,
    subjectId: input.subjectId,
    localEffect: "allow",
    correlationId: input.correlationId,
    action: input.action,
  });
  return decision.effectiveEffect === "allow";
}
