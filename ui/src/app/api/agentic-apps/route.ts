// assisted-by Codex Codex-sonnet-4-6

import { NextRequest, NextResponse } from "next/server";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { ApiError, withAuth, withErrorHandler } from "@/lib/api-middleware";
import {
  buildEffectiveAppsUserContext,
  evaluateAppAccess,
} from "@/lib/agentic-apps/access";
import { requireAgenticAppsInstallEnabled } from "@/lib/agentic-apps/guard";
import { getEnabledAgenticApps } from "@/lib/agentic-apps/registry";
import {
  listAppInstallations,
  listAppPackages,
  userPassesAgenticAppAccessGates,
} from "@/lib/agentic-apps/store";
import type {
  AgenticAppBlockedReason,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

type ListedAgenticApp = {
  appId: string;
  packageId?: string;
  displayName: string;
  description: string;
  href: string;
  canLaunch: boolean;
  blockedReasons: AgenticAppBlockedReason[];
  surfaces: AgenticAppPackageRecord["manifest"]["surfaces"];
};

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  return withAuth(request, async (_req, user, session) => {
    const items: ListedAgenticApp[] = [];
    // Track manifest-level identifiers we've already returned so the
    // env-based fallback below doesn't duplicate Mongo-backed entries.
    const seenManifestIds = new Set<string>();

    // Mongo-backed installations are the source of truth when configured.
    if (isMongoDBConfigured) {
      const [installations, packages] = await Promise.all([
        listAppInstallations(),
        listAppPackages(),
      ]);
      const byPackageId = new Map(packages.map((p) => [p.packageId, p]));

      for (const inst of installations) {
        if (!inst.installed) continue;
        const pkg = byPackageId.get(inst.packageId);
        if (!pkg?.manifest?.surfaces?.showInHub) continue;
        const { manifest } = pkg;
        if (!manifest.runtime?.mountPath) continue;

        const access = evaluateAppAccess({ user, session, pkg, installation: inst });

        items.push({
          appId: inst.appId,
          packageId: inst.packageId,
          displayName: manifest.displayName,
          description: manifest.description,
          href: access.href ?? manifest.runtime.mountPath,
          canLaunch: access.canLaunch,
          blockedReasons: access.blockedReasons,
          surfaces: manifest.surfaces,
        });
        if (manifest.id) seenManifestIds.add(manifest.id);
      }

      items.sort((a, b) => {
        const ao = a.packageId ? byPackageId.get(a.packageId)?.manifest.surfaces?.navOrder : undefined;
        const bo = b.packageId ? byPackageId.get(b.packageId)?.manifest.surfaces?.navOrder : undefined;
        if (typeof ao === "number" && typeof bo === "number" && ao !== bo) {
          return ao - bo;
        }
        return a.appId.localeCompare(b.appId);
      });
    }

    // Env-based registry apps (configured via AGENTIC_APPS_ENABLED) are
    // surfaced when no Mongo installation references the same manifest id.
    // This keeps the home page Pinned Apps consistent with the Apps Hub
    // when running without Mongo-installed packages.
    const ctx = buildEffectiveAppsUserContext(user, session);
    for (const manifest of getEnabledAgenticApps()) {
      if (!manifest.surfaces?.showInHub) continue;
      if (seenManifestIds.has(manifest.id)) continue;
      const passes = userPassesAgenticAppAccessGates(manifest, ctx);
      const blockedReasons: AgenticAppBlockedReason[] = passes ? [] : ["unauthorized"];
      items.push({
        appId: manifest.id,
        displayName: manifest.displayName,
        description: manifest.description,
        href: manifest.runtime.mountPath,
        canLaunch: passes,
        blockedReasons,
        surfaces: manifest.surfaces,
      });
    }

    return NextResponse.json({ items });
  });
});
