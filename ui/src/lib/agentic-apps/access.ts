// assisted-by Codex Codex-sonnet-4-6

import type { EffectiveAppsUserContext } from "@/lib/agentic-apps/store";
import { userPassesAgenticAppAccessGates } from "@/lib/agentic-apps/store";
import type {
  AgenticAppBlockedReason,
  AgenticAppHealthStatus,
  AgenticAppInstallationRecord,
  AgenticAppManifest,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

const SUPPORTED_RUNTIME_KINDS = new Set<AgenticAppManifest["runtime"]["kind"]>(["proxied-next-zone"]);

export type AgenticAppSessionLike = {
  role?: string;
  canViewAdmin?: boolean;
  groups?: string[];
};

export type EvaluateAppAccessInput = {
  user: { email: string; name: string; role: string };
  session: AgenticAppSessionLike;
  pkg: AgenticAppPackageRecord | null;
  installation: AgenticAppInstallationRecord | null;
  /**
   * Optional override; otherwise {@link AgenticAppInstallationRecord.runtimeHealth} is used,
   * defaulting to "unknown" when absent.
   */
  runtimeHealthStatus?: AgenticAppHealthStatus;
};

export type EvaluateAppAccessResult = {
  canLaunch: boolean;
  blockedReasons: AgenticAppBlockedReason[];
  /**
   * Navigable hub path: `installation.runtimeMountPath` when set, else package `manifest.runtime.mountPath`.
   */
  href?: string;
};

/**
 * Resolve launch href from installation-specific mount override, then manifest.
 */
export function resolveAgenticAppHref(
  installation: AgenticAppInstallationRecord | null,
  pkg: AgenticAppPackageRecord | null,
): string | undefined {
  const override = installation?.runtimeMountPath?.trim();
  if (override) {
    return override.startsWith("/") ? override : `/${override}`;
  }
  const mp = pkg?.manifest?.runtime?.mountPath?.trim();
  if (mp) {
    return mp;
  }
  return undefined;
}

/**
 * Build role/group context for marketplace access checks. Session groups are optional
 * (large group lists are not stored server-side on the session).
 */
export function buildEffectiveAppsUserContext(
  user: { email: string; role: string },
  session: AgenticAppSessionLike,
): EffectiveAppsUserContext {
  const role = session.role ?? user.role;
  return {
    email: user.email,
    roles: role ? [role] : [],
    groups: Array.isArray(session.groups) ? session.groups : [],
  };
}

function manifestHasLaunchableRuntime(manifest: AgenticAppManifest): boolean {
  return (
    Boolean(manifest.runtime) &&
    typeof manifest.runtime.kind === "string" &&
    typeof manifest.runtime.mountPath === "string" &&
    manifest.runtime.mountPath.length > 0
  );
}

/**
 * Decide whether the user may launch an installed app. Denies by default when
 * installation is missing/disabled, RBAC fails, runtime is unsupported, or health blocks launch.
 *
 * Note: `manifest.access.tokenScopes` (on the AgenticAppManifest) names app-declared API/OAuth
 * capability requirements for product/docs; launch-time checks here use roles/groups via
 * {@link userPassesAgenticAppAccessGates}, not OAuth scope claim matching.
 */
export function evaluateAppAccess(input: EvaluateAppAccessInput): EvaluateAppAccessResult {
  const blockedReasons: AgenticAppBlockedReason[] = [];

  const { installation, pkg } = input;
  const hrefFor = (): string | undefined => resolveAgenticAppHref(installation, pkg);

  if (!installation || !installation.installed) {
    blockedReasons.push("not_installed");
    return { canLaunch: false, blockedReasons, href: hrefFor() };
  }
  if (!installation.enabled) {
    blockedReasons.push("disabled");
    return { canLaunch: false, blockedReasons, href: hrefFor() };
  }
  if (!pkg) {
    blockedReasons.push("not_installed");
    return { canLaunch: false, blockedReasons, href: hrefFor() };
  }

  const manifest = pkg.manifest;
  if (!manifestHasLaunchableRuntime(manifest)) {
    blockedReasons.push("unsupported_runtime");
    return { canLaunch: false, blockedReasons, href: hrefFor() };
  }
  if (!SUPPORTED_RUNTIME_KINDS.has(manifest.runtime.kind)) {
    blockedReasons.push("unsupported_runtime");
    return { canLaunch: false, blockedReasons, href: hrefFor() };
  }

  const ctx = buildEffectiveAppsUserContext(input.user, input.session);
  if (!userPassesAgenticAppAccessGates(manifest, ctx)) {
    blockedReasons.push("unauthorized");
    return { canLaunch: false, blockedReasons, href: hrefFor() };
  }

  const health: AgenticAppHealthStatus =
    input.runtimeHealthStatus ?? input.installation?.runtimeHealth ?? "unknown";
  if (health === "degraded" || health === "unreachable") {
    blockedReasons.push("unhealthy");
    return { canLaunch: false, blockedReasons, href: hrefFor() };
  }

  return { canLaunch: true, blockedReasons: [], href: hrefFor() };
}
