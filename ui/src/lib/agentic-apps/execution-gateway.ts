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
 *
 * Resolution order:
 *   1. installation.runtimeOriginOverride     (operator-set, per-environment)
 *   2. manifest.runtime.origin                (declared by the package author)
 *   3. AGENTIC_APP_<UPPER_ID>_ORIGIN env var  (host config — the same generic
 *      env convention applied by `withHostConfig` in `registry.ts`).
 *
 * The env-var fallback keeps the gateway working without forcing operators to
 * also seed `runtimeOriginOverride` in Mongo for built-in apps that already
 * declare their origin via env.
 */
export function resolveEffectiveRuntimeOrigin(
  installation: AgenticAppInstallationRecord,
  manifest: AgenticAppManifest,
): string | undefined {
  const override = installation.runtimeOriginOverride?.trim();
  if (override) {
    return override;
  }
  const declared = manifest.runtime?.origin?.trim();
  if (declared) {
    return declared;
  }
  const envKey = `AGENTIC_APP_${manifest.id.toUpperCase().replace(/-/g, "_")}_ORIGIN`;
  const fromEnv = process.env[envKey]?.trim();
  return fromEnv || undefined;
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

export interface BuildProxyTargetOptions {
  /**
   * When true, prepend the public mount path (e.g. `/apps/<id>`) to the
   * upstream URL so apps that use Next.js `basePath` (or any framework that
   * expects to see its own prefix) receive the full path. Default `false`
   * strips the mount path; this matches apps that serve their content at
   * "/" and don't care about the prefix (the FinOps and Weather samples).
   */
  preserveMountPath?: boolean;
  /** Public mount path; required when `preserveMountPath` is true. */
  mountPath?: string;
}

export function buildProxyTargetUrl(
  origin: string,
  pathParts: string[],
  requestUrl: string,
  options: BuildProxyTargetOptions = {},
): string {
  const target = new URL(origin);
  const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
  const suffix = encodedPath ? `/${encodedPath}` : "/";
  if (options.preserveMountPath && options.mountPath) {
    const normalizedMount = options.mountPath.replace(/\/+$/, "");
    target.pathname = `${normalizedMount}${encodedPath ? suffix : ""}` || "/";
  } else {
    target.pathname = suffix;
  }
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
