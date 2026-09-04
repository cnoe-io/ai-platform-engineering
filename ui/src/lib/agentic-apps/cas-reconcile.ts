import { reconcileTupleDiff } from "@/lib/authz/reconcile";
import { loadConfiguredAgenticApps } from "@/lib/agentic-apps/config";
import { effectiveAgenticAppVisibility } from "@/lib/agentic-apps/sharing";
import type { TeamResourceTupleDiff } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";
import type {
  AgenticAppVisibility,
  ConfiguredAgenticApp,
} from "@/types/agentic-app";

export function buildConfiguredAgenticAppCasTupleDiff(
  apps: readonly ConfiguredAgenticApp[],
  persistedVisibility: ReadonlyMap<string, AgenticAppVisibility> = new Map(),
): TeamResourceTupleDiff {
  const writes: TeamResourceTupleDiff["writes"] = [];
  const deletes: TeamResourceTupleDiff["deletes"] = [];

  for (const app of apps) {
    const appId = app.installation.appId;
    const publicUseTuple = {
      user: "user:*",
      relation: "user",
      object: `agentic_app:${appId}`,
    };
    const orgAdminTuple = {
      user: `${organizationObjectId()}#admin`,
      relation: "manager",
      object: `agentic_app:${appId}`,
    };
    const active = app.installation.installed
      && app.installation.enabled
      && app.installation.visible;
    const visibility = persistedVisibility.get(appId) ?? "global";

    if (active && visibility === "global") {
      writes.push(publicUseTuple, orgAdminTuple);
      continue;
    }
    deletes.push(publicUseTuple);
    if (active && visibility === "team") {
      writes.push(orgAdminTuple);
    } else {
      deletes.push(orgAdminTuple);
    }
  }
  return { writes, deletes };
}

export async function reconcileConfiguredAgenticAppCasAccess(): Promise<void> {
  const apps = loadConfiguredAgenticApps();
  const persistedVisibility = new Map<string, AgenticAppVisibility>();
  const { isMongoDBConfigured } = await import("@/lib/mongodb");
  if (isMongoDBConfigured) {
    const { listAppInstallations } = await import("@/lib/agentic-apps/store");
    const configuredIds = new Set(apps.map((app) => app.installation.appId));
    for (const installation of await listAppInstallations()) {
      if (configuredIds.has(installation.appId)) {
        persistedVisibility.set(
          installation.appId,
          effectiveAgenticAppVisibility(installation),
        );
      }
    }
  }

  const diff = buildConfiguredAgenticAppCasTupleDiff(apps, persistedVisibility);
  const result = await reconcileTupleDiff(diff, {
    source: "external_apps_configured_access",
  });
  if (result.enabled && (result.writes > 0 || result.deletes > 0)) {
    console.log(
      `[external-apps/cas] Reconciled configured access: ${result.writes} grants, ${result.deletes} revocations`,
    );
  }
}
