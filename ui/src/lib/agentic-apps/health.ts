// assisted-by Codex Codex-sonnet-4-6

import { appendAgenticAppEvent, appendHealthSnapshot } from "@/lib/agentic-apps/store";
import type {
  AgenticAppHealthSnapshotRecord,
  AgenticAppHealthStatus,
  AgenticAppInstallationRecord,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

export type CheckAgenticAppHealthInput = {
  pkg: AgenticAppPackageRecord;
  installation: AgenticAppInstallationRecord;
  fetcher?: typeof fetch;
  now?: Date;
};

export async function checkAgenticAppHealth(
  input: CheckAgenticAppHealthInput,
): Promise<AgenticAppHealthSnapshotRecord> {
  const now = input.now ?? new Date();
  const url = buildHealthUrl(input.pkg, input.installation);
  const fetcher = input.fetcher ?? fetch;
  let status: AgenticAppHealthStatus = "unknown";
  let reasonCode: string | undefined;

  if (!url) {
    status = "unreachable";
    reasonCode = "missing_origin";
  } else {
    try {
      const response = await fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(input.pkg.manifest.health.timeoutMs ?? 2000),
      });
      if (response.ok) {
        status = "healthy";
      } else if (response.status >= 500) {
        status = "unreachable";
        reasonCode = `http_${response.status}`;
      } else {
        status = "degraded";
        reasonCode = `http_${response.status}`;
      }
    } catch {
      status = "unreachable";
      reasonCode = "fetch_failed";
    }
  }

  const snapshot: AgenticAppHealthSnapshotRecord = {
    appId: input.installation.appId,
    status,
    checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    ...(reasonCode ? { reasonCode } : {}),
    safeMetadata: {
      endpoint: input.pkg.manifest.health.endpoint,
      runtimeKind: input.pkg.manifest.runtime.kind,
    },
  };

  await appendHealthSnapshot(snapshot);
  await appendAgenticAppEvent({
    type: `agentic_app.health.${status}`,
    actorEmail: "agentic-app-health",
    appId: input.installation.appId,
    payload: {
      status,
      reasonCode,
      endpoint: input.pkg.manifest.health.endpoint,
    },
  });
  return snapshot;
}

export function getUserSafeHealthBlockedReason(input: {
  status?: AgenticAppHealthStatus;
  blockLaunchWhen?: AgenticAppHealthStatus[];
}): string | null {
  if (!input.status || !input.blockLaunchWhen?.includes(input.status)) {
    return null;
  }
  if (input.status === "unreachable") {
    return "runtime_unavailable";
  }
  if (input.status === "degraded") {
    return "runtime_degraded";
  }
  return "runtime_health_unknown";
}

function buildHealthUrl(
  pkg: AgenticAppPackageRecord,
  installation: AgenticAppInstallationRecord,
): string | null {
  const origin = installation.runtimeOriginOverride ?? pkg.manifest.runtime.origin;
  if (!origin || pkg.manifest.runtime.kind === "in-process") {
    return null;
  }
  return new URL(pkg.manifest.health.endpoint, origin).toString();
}
