import {
  getAgenticAppById,
  isRetiredAgenticAppId,
} from "@/lib/agentic-apps/registry";
import { listAppInstallations, listAppPackages } from "@/lib/agentic-apps/store";
import { isMongoDBConfigured } from "@/lib/mongodb";
import type {
  AgenticAppInstallationRecord,
  AgenticAppManifest,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

export type AgenticAppExecutionBindingResult =
  | {
      installation: AgenticAppInstallationRecord;
      pkg: AgenticAppPackageRecord;
      error?: undefined;
      status?: undefined;
    }
  | {
      installation?: undefined;
      pkg?: undefined;
      error: string;
      status: number;
    };

/** Resolve the installed package used by both the proxy and token broker. */
export async function resolveAgenticAppExecutionBinding(
  appId: string,
): Promise<AgenticAppExecutionBindingResult> {
  if (isRetiredAgenticAppId(appId)) {
    return { error: "app_not_found", status: 404 };
  }

  if (isMongoDBConfigured) {
    let installations: Awaited<ReturnType<typeof listAppInstallations>>;
    let packages: Awaited<ReturnType<typeof listAppPackages>>;
    try {
      [installations, packages] = await Promise.all([
        listAppInstallations(),
        listAppPackages(),
      ]);
    } catch {
      return { error: "gateway_store_unavailable", status: 503 };
    }

    const installation = installations.find((item) => item.appId === appId) ?? null;
    const pkg = installation
      ? packages.find((item) => item.packageId === installation.packageId) ?? null
      : null;
    if (installation && pkg) return { installation, pkg };
  }

  const manifest = getAgenticAppById(appId);
  if (!manifest) {
    return {
      error: isMongoDBConfigured ? "app_not_found" : "mongodb_required",
      status: isMongoDBConfigured ? 404 : 503,
    };
  }
  return buildEnvConfiguredExecutionBinding(manifest);
}

function buildEnvConfiguredExecutionBinding(
  manifest: AgenticAppManifest,
): AgenticAppExecutionBindingResult {
  const now = new Date().toISOString();
  return {
    pkg: {
      packageId: manifest.id,
      source: "builtin",
      manifest,
      importedAt: now,
      importedBy: "env-registry",
      ...(manifest.catalog ? { catalog: manifest.catalog } : {}),
    },
    installation: {
      appId: manifest.id,
      packageId: manifest.id,
      installed: true,
      enabled: true,
      visible: true,
      runtimeMountPath: manifest.runtime.mountPath,
      runtimeHealth: "unknown",
      healthPolicy: {
        blockLaunchWhen: manifest.health.blockLaunchWhen ?? ["degraded", "unreachable"],
      },
      routeOwnership: { normalizedMountPath: manifest.runtime.mountPath },
      updatedAt: now,
      updatedBy: "env-registry",
    },
  };
}
