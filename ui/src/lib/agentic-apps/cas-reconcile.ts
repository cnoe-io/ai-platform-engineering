import { reconcileTupleDiff } from "@/lib/authz/reconcile";
import { BUILTIN_AGENTIC_APP_PACKAGE_SEEDS } from "@/lib/agentic-apps/builtin-packages";
import { getEnabledAgenticApps } from "@/lib/agentic-apps/registry";
import { effectiveAgenticAppVisibility } from "@/lib/agentic-apps/sharing";
import type { TeamResourceTupleDiff } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";

/**
 * Built-in apps declare `requiredRoles: ["user"]`, so their corresponding
 * CAS grant is the typed wildcard `user:* user agentic_app:<id>`. Disabled
 * built-ins lose that platform-owned wildcard while explicit user/team/admin
 * grants remain untouched.
 */
export function buildBuiltinAgenticAppCasTupleDiff(
  enabledAppIds: ReadonlySet<string>,
  builtinAppIds: readonly string[],
  nonGlobalAppIds: ReadonlySet<string> = new Set(),
): TeamResourceTupleDiff {
  const writes: TeamResourceTupleDiff["writes"] = [];
  const deletes: TeamResourceTupleDiff["deletes"] = [];
  for (const appId of builtinAppIds) {
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
    if (enabledAppIds.has(appId) && !nonGlobalAppIds.has(appId)) {
      writes.push(publicUseTuple, orgAdminTuple);
    } else {
      deletes.push(publicUseTuple, orgAdminTuple);
    }
  }
  return { writes, deletes };
}

export async function reconcileBuiltinAgenticAppCasAccess(): Promise<void> {
  const enabledAppIds = new Set(getEnabledAgenticApps().map((manifest) => manifest.id));
  const builtinAppIds: string[] = BUILTIN_AGENTIC_APP_PACKAGE_SEEDS.map(
    (seed) => seed.packageId,
  );
  const nonGlobalAppIds = new Set<string>();
  const { isMongoDBConfigured } = await import("@/lib/mongodb");
  if (isMongoDBConfigured) {
    const { listAppInstallations } = await import("@/lib/agentic-apps/store");
    const installations = await listAppInstallations();
    for (const installation of installations) {
      if (
        builtinAppIds.includes(installation.appId) &&
        effectiveAgenticAppVisibility(installation) !== "global"
      ) {
        nonGlobalAppIds.add(installation.appId);
      }
    }
  }
  const diff = buildBuiltinAgenticAppCasTupleDiff(
    enabledAppIds,
    builtinAppIds,
    nonGlobalAppIds,
  );
  const result = await reconcileTupleDiff(diff, {
    source: "agentic_apps_builtin_access",
  });
  if (result.enabled && (result.writes > 0 || result.deletes > 0)) {
    console.log(
      `[agentic-apps/cas] Reconciled built-in access: ${result.writes} grants, ${result.deletes} revocations`,
    );
  }
}
