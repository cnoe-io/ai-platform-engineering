// assisted-by Codex Codex-sonnet-4-6

import type { EvaluateAppAccessResult } from "@/lib/agentic-apps/access";
import { isUsableAccessRecord } from "@/lib/agentic-apps/store";
import type {
  AgenticAppBlockedReason,
  AgenticAppHealthStatus,
  AgenticAppInstallationRecord,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

function primaryBlockedReason(reasons: AgenticAppBlockedReason[]): AgenticAppBlockedReason | undefined {
  return reasons[0];
}

/**
 * End-user safe JSON for GET /api/agentic-apps/[appId]. Omits infrastructure (health probe URLs,
 * upstream origins) and full access control matrices; exposes capability metadata only when launch is allowed.
 */
export function buildPublicAgenticAppDetailPayload(input: {
  pkg: AgenticAppPackageRecord;
  installation: AgenticAppInstallationRecord;
  accessResult: EvaluateAppAccessResult;
  runtimeStatus: AgenticAppHealthStatus;
}): Record<string, unknown> {
  const manifest = input.pkg.manifest;
  const blockedReason = primaryBlockedReason(input.accessResult.blockedReasons);

  const packageBase: Record<string, unknown> = {
    id: manifest.id,
    displayName: manifest.displayName,
    description: manifest.description,
    apiVersion: manifest.apiVersion,
    source: input.pkg.source,
    runtime: {
      kind: manifest.runtime.kind,
      mountPath: manifest.runtime.mountPath,
    },
    surfaces: manifest.surfaces,
  };

  let packagePayload: Record<string, unknown> = packageBase;

  if (input.accessResult.canLaunch && isUsableAccessRecord(manifest.access)) {
    packagePayload = {
      ...packageBase,
      /**
       * Names from the app manifest describing OAuth/API capabilities the app expects to use.
       * Not a statement of the current user's granted scopes.
       */
      requestedTokenScopes: [...manifest.access.tokenScopes],
    };
    if (manifest.agents && manifest.agents.length > 0) {
      packagePayload.agents = manifest.agents.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        required: a.required,
      }));
    }
  }

  return {
    appId: input.installation.appId,
    packageId: input.installation.packageId,
    runtimeStatus: input.runtimeStatus,
    href: input.accessResult.href,
    canLaunch: input.accessResult.canLaunch,
    blockedReasons: input.accessResult.blockedReasons,
    ...(blockedReason !== undefined ? { blockedReason } : {}),
    installation: {
      installed: input.installation.installed,
      enabled: input.installation.enabled,
      ...(input.installation.updatedAt !== undefined ? { updatedAt: input.installation.updatedAt } : {}),
    },
    package: packagePayload,
  };
}
