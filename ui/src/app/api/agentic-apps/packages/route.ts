// assisted-by Codex Codex-sonnet-4-6

import { NextRequest, NextResponse } from "next/server";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { ApiError, withAuth, withErrorHandler } from "@/lib/api-middleware";
import { evaluateAppAccess } from "@/lib/agentic-apps/access";
import { requireAgenticAppsInstallEnabled } from "@/lib/agentic-apps/guard";
import { listAppInstallations, listAppPackages } from "@/lib/agentic-apps/store";
import type { AgenticAppBlockedReason, AgenticAppInstallationRecord } from "@/types/agentic-app";

type InstallStatus = "not_installed" | "installed" | "disabled";

const VALID_INSTALL_STATUS_FILTERS = new Set<InstallStatus>([
  "not_installed",
  "installed",
  "disabled",
]);

function resolveInstallStatus(
  installs: AgenticAppInstallationRecord[],
  packageId: string,
): { status: InstallStatus; installation: AgenticAppInstallationRecord | null } {
  const rows = installs.filter((i) => i.packageId === packageId);
  if (rows.length === 0) {
    return { status: "not_installed", installation: null };
  }
  const prefer = rows.find((r) => r.installed) ?? rows[0];
  if (!prefer.installed) {
    return { status: "not_installed", installation: prefer };
  }
  if (!prefer.enabled) {
    return { status: "disabled", installation: prefer };
  }
  return { status: "installed", installation: prefer };
}

function matchesQuery(
  q: string,
  row: { packageId: string; displayName: string; description: string },
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.packageId.toLowerCase().includes(needle) ||
    row.displayName.toLowerCase().includes(needle) ||
    row.description.toLowerCase().includes(needle)
  );
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is required for Agentic Apps", 503);
  }
  return withAuth(request, async (_req, user, session) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const category = (url.searchParams.get("category") ?? "").trim().toLowerCase();
    const statusRaw = (url.searchParams.get("status") ?? "").trim().toLowerCase();
    if (statusRaw && !VALID_INSTALL_STATUS_FILTERS.has(statusRaw as InstallStatus)) {
      throw new ApiError("Invalid status filter", 400);
    }
    const statusFilter = statusRaw;

    const [packages, installations] = await Promise.all([
      listAppPackages(),
      listAppInstallations(),
    ]);

    const items = [];

    for (const pkg of packages) {
      const { manifest } = pkg;
      const displayName = manifest.displayName ?? pkg.packageId;
      const description = manifest.description ?? "";

      if (!matchesQuery(q, { packageId: pkg.packageId, displayName, description })) {
        continue;
      }

      const cats = pkg.catalog?.categories ?? [];
      if (category && !cats.some((c) => c.toLowerCase() === category)) {
        continue;
      }

      const { status, installation } = resolveInstallStatus(installations, pkg.packageId);
      if (statusFilter && status !== statusFilter) {
        continue;
      }

      const access = evaluateAppAccess({ user, session, pkg, installation });

      items.push({
        packageId: pkg.packageId,
        source: pkg.source,
        displayName,
        description,
        categories: cats.length > 0 ? cats : undefined,
        installStatus: status,
        installation:
          installation === null
            ? undefined
            : {
                appId: installation.appId,
                installed: installation.installed,
                enabled: installation.enabled,
              },
        href: access.href,
        canLaunch: access.canLaunch,
        blockedReasons: access.blockedReasons,
      });
    }

    items.sort((a, b) => a.packageId.localeCompare(b.packageId));

    return NextResponse.json({ items });
  });
});
