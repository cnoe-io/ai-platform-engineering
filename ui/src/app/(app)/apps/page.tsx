// assisted-by Codex Codex-sonnet-4-6

import { AgenticAppsHub } from "@/components/agentic-apps/AgenticAppsHub";
import { AuthGuard } from "@/components/auth-guard";
import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import {
  buildEffectiveAppsUserContext,
  evaluateAppAccess,
} from "@/lib/agentic-apps/access";
import { evaluateAgenticAppCasCompatibility } from "@/lib/agentic-apps/cas-compat";
import { deriveAgenticAppSubjectId } from "@/lib/agentic-apps/identity";
import {
  getEnabledAgenticApps,
  isAgenticAppsInstallEnabled,
} from "@/lib/agentic-apps/registry";
import {
  listAppInstallations,
  listAppPackages,
  userPassesAgenticAppAccessGates,
} from "@/lib/agentic-apps/store";
import { effectiveAgenticAppVisibility } from "@/lib/agentic-apps/sharing";
import { authOptions } from "@/lib/auth-config";
import { isMongoDBConfigured } from "@/lib/mongodb";
import type {
  AgenticAppBlockedReason,
  AgenticAppHealthStatus,
  AgenticAppManifest,
  AgenticAppVisibility,
} from "@/types/agentic-app";
import { notFound, redirect } from "next/navigation";

type HubApp = AgenticAppManifest & {
  canLaunch?: boolean;
  blockedReasons?: AgenticAppBlockedReason[];
  runtimeStatus?: AgenticAppHealthStatus;
  visibility: AgenticAppVisibility;
  sharedWithTeams: string[];
  createdBy: string;
  canManage: boolean;
};

export default async function AppsPage() {
  if (!isAgenticAppsInstallEnabled()) {
    notFound();
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !session.sub) {
    redirect("/login?callbackUrl=%2Fapps");
  }
  const localUser = {
    email: session.user.email,
    name: session.user.name ?? session.user.email,
    role: session.role ?? "user",
  };
  const apps = await getHubApps(localUser, session);

  return (
    <AuthGuard>
      <AgenticAppsHub apps={apps} />
    </AuthGuard>
  );
}

async function getHubApps(
  localUser: { email: string; name: string; role: string },
  localSession: { sub?: string; role?: string; canViewAdmin?: boolean; groups?: string[] },
): Promise<HubApp[]> {
  const apps: HubApp[] = [];
  const seenManifestIds = new Set<string>();
  const installationByAppId = new Map<
    string,
    Awaited<ReturnType<typeof listAppInstallations>>[number]
  >();
  const subjectId = deriveAgenticAppSubjectId(
    localSession as Record<string, unknown>,
    localUser.email,
  );
  const correlationId = randomUUID();

  if (isMongoDBConfigured) {
    const [installations, packages] = await Promise.all([
      listAppInstallations(),
      listAppPackages(),
    ]);
    const byPackageId = new Map(packages.map((pkg) => [pkg.packageId, pkg]));
    for (const installation of installations) {
      installationByAppId.set(installation.appId, installation);
    }

    for (const installation of installations) {
      if (!installation.installed || installation.visible === false) {
        continue;
      }
      const pkg = byPackageId.get(installation.packageId);
      if (!pkg?.manifest.surfaces.showInHub) {
        continue;
      }
      const access = evaluateAppAccess({
        user: localUser,
        session: localSession,
        pkg,
        installation,
      });
      const manifest = pkg.manifest;
      const canView = await passesCasGate({
        appId: installation.appId,
        subjectId,
        localAllowed: true,
        correlationId,
        hasCasContract: Boolean(manifest.authorization),
        action: "read",
      });
      if (!canView) continue;
      const [canLaunch, canManage] = await Promise.all([
        passesCasGate({
          appId: installation.appId,
          subjectId,
          localAllowed: access.canLaunch,
          correlationId,
          hasCasContract: Boolean(manifest.authorization),
          action: "use",
        }),
        passesCasGate({
          appId: installation.appId,
          subjectId,
          localAllowed: true,
          correlationId,
          hasCasContract: Boolean(manifest.authorization),
          action: "manage",
        }),
      ]);
      apps.push({
        ...manifest,
        id: installation.appId,
        runtime: {
          ...manifest.runtime,
          ...(installation.runtimeMountPath ? { mountPath: installation.runtimeMountPath } : {}),
          ...(installation.runtimeOriginOverride ? { origin: installation.runtimeOriginOverride } : {}),
        },
        canLaunch,
        blockedReasons: canLaunch
          ? access.blockedReasons
          : access.canLaunch
            ? ["unauthorized"]
            : access.blockedReasons,
        runtimeStatus: installation.runtimeHealth,
        visibility: effectiveAgenticAppVisibility(installation),
        sharedWithTeams: installation.sharedWithTeams ?? [],
        createdBy: installation.createdBy ?? "system",
        canManage,
      });
      seenManifestIds.add(manifest.id);
    }
  }

  const ctx = buildEffectiveAppsUserContext(localUser, localSession);
  for (const manifest of getEnabledAgenticApps()) {
    if (!manifest.surfaces.showInHub || seenManifestIds.has(manifest.id)) {
      continue;
    }
    const canLaunch = userPassesAgenticAppAccessGates(manifest, ctx);
    const installation = installationByAppId.get(manifest.id);
    const canView = await passesCasGate({
      appId: manifest.id,
      subjectId,
      localAllowed: true,
      correlationId,
      hasCasContract: Boolean(manifest.authorization),
      action: "read",
    });
    if (!canView) continue;
    const [casCanLaunch, canManage] = await Promise.all([
      passesCasGate({
        appId: manifest.id,
        subjectId,
        localAllowed: canLaunch,
        correlationId,
        hasCasContract: Boolean(manifest.authorization),
        action: "use",
      }),
      passesCasGate({
        appId: manifest.id,
        subjectId,
        localAllowed: true,
        correlationId,
        hasCasContract: Boolean(manifest.authorization),
        action: "manage",
      }),
    ]);
    apps.push({
      ...manifest,
      canLaunch: casCanLaunch,
      blockedReasons: casCanLaunch ? [] : ["unauthorized"],
      visibility: effectiveAgenticAppVisibility(installation),
      sharedWithTeams: installation?.sharedWithTeams ?? [],
      createdBy: installation?.createdBy ?? "Deployment config",
      canManage,
    });
  }

  return apps.sort((a, b) => {
    const ao = a.surfaces.navOrder;
    const bo = b.surfaces.navOrder;
    if (typeof ao === "number" && typeof bo === "number" && ao !== bo) return ao - bo;
    if (typeof ao === "number") return -1;
    if (typeof bo === "number") return 1;
    return a.id.localeCompare(b.id);
  });
}

async function passesCasGate(input: {
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
