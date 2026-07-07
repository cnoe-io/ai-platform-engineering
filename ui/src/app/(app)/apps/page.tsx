// assisted-by Codex Codex-sonnet-4-6

import { AgenticAppsHub } from "@/components/agentic-apps/AgenticAppsHub";
import { AuthGuard } from "@/components/auth-guard";
import {
  buildEffectiveAppsUserContext,
  evaluateAppAccess,
} from "@/lib/agentic-apps/access";
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
import type {
  AgenticAppBlockedReason,
  AgenticAppHealthStatus,
  AgenticAppManifest,
} from "@/types/agentic-app";
import { notFound } from "next/navigation";

type HubApp = AgenticAppManifest & {
  canLaunch?: boolean;
  blockedReasons?: AgenticAppBlockedReason[];
  runtimeStatus?: AgenticAppHealthStatus;
};

const localUser = { email: "anonymous@local", name: "Anonymous", role: "user" };
const localSession = { role: "user" };

export default async function AppsPage() {
  if (!isAgenticAppsInstallEnabled()) {
    notFound();
  }

  const apps = await getHubApps();

  return (
    <AuthGuard>
      <AgenticAppsHub apps={apps} />
    </AuthGuard>
  );
}

async function getHubApps(): Promise<HubApp[]> {
  const apps: HubApp[] = [];
  const seenManifestIds = new Set<string>();

  if (isMongoDBConfigured) {
    const [installations, packages] = await Promise.all([
      listAppInstallations(),
      listAppPackages(),
    ]);
    const byPackageId = new Map(packages.map((pkg) => [pkg.packageId, pkg]));

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
      apps.push({
        ...manifest,
        id: installation.appId,
        runtime: {
          ...manifest.runtime,
          ...(installation.runtimeMountPath ? { mountPath: installation.runtimeMountPath } : {}),
          ...(installation.runtimeOriginOverride ? { origin: installation.runtimeOriginOverride } : {}),
        },
        canLaunch: access.canLaunch,
        blockedReasons: access.blockedReasons,
        runtimeStatus: installation.runtimeHealth,
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
    apps.push({
      ...manifest,
      canLaunch,
      blockedReasons: canLaunch ? [] : ["unauthorized"],
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
