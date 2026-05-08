// assisted-by Codex Codex-sonnet-4-6

import type {
  AgenticAppBlockedReason,
  AgenticAppInstallationRecord,
  AgenticAppManifest,
  AgenticAppRuntimeKind,
} from "@/types/agentic-app";

/** Only this runtime mode is implemented by the `/apps/:appId` reverse proxy gateway. */
export const GATEWAY_EXECUTABLE_RUNTIME_KIND: AgenticAppRuntimeKind = "proxied-next-zone";

/**
 * True when this manifest declares a proxy-executable runtime (`proxied-next-zone`)
 * with a non-empty mount path. Called from the gateway route so runtime policy is
 * visible at the execution boundary (not only inside {@link evaluateAppAccess}).
 */
export function isExecutableProxyRuntimeManifest(manifest: AgenticAppManifest): boolean {
  const rt = manifest.runtime;
  if (
    !rt ||
    typeof rt.kind !== "string" ||
    typeof rt.mountPath !== "string" ||
    rt.mountPath.trim().length === 0
  ) {
    return false;
  }
  return rt.kind === GATEWAY_EXECUTABLE_RUNTIME_KIND;
}

/**
 * Installation may override the manifest-declared origin for same-origin proxy routing.
 */
export function resolveEffectiveRuntimeOrigin(
  installation: AgenticAppInstallationRecord,
  manifest: AgenticAppManifest,
): string | undefined {
  const override = installation.runtimeOriginOverride?.trim();
  if (override) {
    return override;
  }
  const o = manifest.runtime?.origin?.trim();
  return o || undefined;
}

/** Only http(s) absolute origins may be reached by the execution gateway proxy. */
export function isExecutableProxiedHttpOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  try {
    const u = new URL(origin);
    if (u.username !== "" || u.password !== "") {
      return false;
    }
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildProxyTargetUrl(origin: string, pathParts: string[], requestUrl: string): string {
  const target = new URL(origin);
  const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
  target.pathname = encodedPath ? `/${encodedPath}` : "/";
  target.search = new URL(requestUrl).search;
  return target.toString();
}

export function httpErrorForBlockedReason(reason: AgenticAppBlockedReason): { status: number; error: string } {
  switch (reason) {
    case "not_installed":
      return { status: 404, error: "app_not_found" };
    case "disabled":
      return { status: 403, error: "app_disabled" };
    case "unauthorized":
      return { status: 403, error: "app_unauthorized" };
    case "unhealthy":
      return { status: 403, error: "app_unhealthy" };
    case "unsupported_runtime":
      return { status: 501, error: "unsupported_runtime" };
    case "route_conflict":
      return { status: 403, error: "app_unauthorized" };
    default:
      return { status: 403, error: "app_unauthorized" };
  }
}
