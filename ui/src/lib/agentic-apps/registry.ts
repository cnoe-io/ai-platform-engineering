// assisted-by Codex Codex-sonnet-4-6

import type { AgenticAppManifest } from "@/types/agentic-app";
import {
  AGENTIC_SDLC_APP_ID,
  AGENTIC_SDLC_MANIFEST,
} from "./builtin-packages";
import {
  FINOPS_APP_ID,
  FINOPS_MANIFEST,
  WEATHER_APP_ID,
  WEATHER_MANIFEST,
} from "./sample-manifests";

/**
 * Built-in agentic app catalog. The platform itself ships only the apps that
 * are part of CAIPE's release surface (Agentic SDLC, plus FinOps and Weather
 * sample manifests for demos and reference). Every other app — internal,
 * customer-built, or third-party — is added via the marketplace package
 * collection in MongoDB or via host environment variables, never as source
 * code in this repo.
 *
 * For any built-in or operator-installed app, host-specific runtime fields
 * (origin, mount path, disabled flag) come from a single uniform set of env
 * vars keyed on the app id. Adding a new app **never** requires editing this
 * file: operators set `AGENTIC_APPS_ENABLED=<id>` and the matching
 * `AGENTIC_APP_<UPPER_ID>_*` vars and the registry picks it up.
 */

interface BuiltInAppEntry {
  manifest: AgenticAppManifest;
  /**
   * Optional product-level feature gate evaluated in addition to
   * `AGENTIC_APPS_ENABLED` and `AGENTIC_APP_<ID>_DISABLED`. Used for apps
   * that ship with the platform but should only render when a separate
   * product flag is on (e.g. Agentic SDLC ships with the binary but is
   * hidden until ship loop is enabled at the host).
   */
  isProductEnabled?: () => boolean;
}

const BUILT_IN_APPS: BuiltInAppEntry[] = [
  { manifest: AGENTIC_SDLC_MANIFEST, isProductEnabled: isAgenticSdlcEnabled },
  { manifest: FINOPS_MANIFEST },
  { manifest: WEATHER_MANIFEST },
];

const BUILT_IN_APP_IDS: readonly string[] = BUILT_IN_APPS.map((entry) => entry.manifest.id);

export function getEnabledAgenticApps(): AgenticAppManifest[] {
  if (!isAgenticAppsInstallEnabled()) {
    return [];
  }

  const enabledIds = parseEnabledAppIds(process.env.AGENTIC_APPS_ENABLED);

  return BUILT_IN_APPS.filter((entry) => {
    if (!enabledIds.has(entry.manifest.id)) return false;
    if (isAppDisabledByEnv(entry.manifest.id)) return false;
    if (entry.isProductEnabled && !entry.isProductEnabled()) return false;
    return true;
  }).map((entry) => withHostConfig(entry.manifest));
}

export function getAgenticAppById(appId: string): AgenticAppManifest | null {
  return getEnabledAgenticApps().find((app) => app.id === appId) ?? null;
}

export function isAgenticAppsInstallEnabled(): boolean {
  return process.env.AGENTIC_APPS_INSTALL_ENABLED === "true";
}

function isAgenticSdlcEnabled(): boolean {
  return (
    process.env.SHIP_LOOP_ENABLED === "true"
    || process.env.NEXT_PUBLIC_SHIP_LOOP_ENABLED === "true"
  );
}

/**
 * `AGENTIC_APP_<UPPER_ID>_DISABLED=true` force-disables an app even when it
 * appears in `AGENTIC_APPS_ENABLED`. Used by operators to flip an app off
 * per-environment without rewriting the comma-separated enabled list.
 */
function isAppDisabledByEnv(appId: string): boolean {
  const value = process.env[`AGENTIC_APP_${envSuffix(appId)}_DISABLED`];
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/**
 * Apply per-environment runtime overrides to a manifest:
 *   - `AGENTIC_APP_<UPPER_ID>_ORIGIN`     overrides `runtime.origin`
 *   - `AGENTIC_APP_<UPPER_ID>_MOUNT_PATH` overrides `runtime.mountPath`
 *
 * The override values are validated and normalized: trailing slashes are
 * trimmed from origins, and mount paths must stay under `/apps/`. Unsafe
 * mount paths fall back to the manifest-declared mountPath rather than
 * silently allowing a route escape.
 */
function withHostConfig(app: AgenticAppManifest): AgenticAppManifest {
  const suffix = envSuffix(app.id);
  const originEnv = process.env[`AGENTIC_APP_${suffix}_ORIGIN`];
  const mountEnv = process.env[`AGENTIC_APP_${suffix}_MOUNT_PATH`];

  const trimmedOrigin = originEnv?.trim();
  const trimmedMount = mountEnv?.trim();

  if (!trimmedOrigin && !trimmedMount) {
    return app;
  }

  return {
    ...app,
    runtime: {
      ...app.runtime,
      ...(trimmedOrigin ? { origin: trimTrailingSlash(trimmedOrigin) } : {}),
      ...(trimmedMount
        ? { mountPath: normalizeMountPath(trimmedMount, app.runtime.mountPath) }
        : {}),
    },
  };
}

function parseEnabledAppIds(value: string | undefined): Set<string> {
  if (!value) return new Set();
  const ids = value
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  return new Set(ids.includes("*") || ids.includes("all") ? BUILT_IN_APP_IDS : ids);
}

function envSuffix(appId: string): string {
  return appId.toUpperCase().replace(/-/g, "_");
}

function normalizeMountPath(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const normalized = trimmed.startsWith("/")
    ? trimTrailingSlash(trimmed)
    : `/${trimTrailingSlash(trimmed)}`;
  const resolvedPath = new URL(normalized, "http://caipe.local").pathname;
  return resolvedPath.startsWith("/apps/") ? resolvedPath : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
