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

const DEFAULT_FINOPS_ORIGIN = "http://localhost:3010";
const DEFAULT_FINOPS_MOUNT_PATH = "/apps/finops";
const DEFAULT_WEATHER_ORIGIN = "http://localhost:3020";
const DEFAULT_WEATHER_MOUNT_PATH = "/apps/weather";

export function getEnabledAgenticApps(): AgenticAppManifest[] {
  if (!isAgenticAppsInstallEnabled()) {
    return [];
  }

  const enabledIds = parseEnabledAppIds(process.env.AGENTIC_APPS_ENABLED);
  const apps: AgenticAppManifest[] = [];
  // Agentic SDLC is also gated by SHIP_LOOP_ENABLED — operators that
  // toggle it off at the feature env level should not see the manifest
  // even if AGENTIC_APPS_ENABLED includes "agentic-sdlc" or "*".
  if (enabledIds.has(AGENTIC_SDLC_APP_ID) && isAgenticSdlcEnabled()) {
    apps.push(AGENTIC_SDLC_MANIFEST);
  }
  if (enabledIds.has(FINOPS_APP_ID)) {
    apps.push(withFinOpsHostConfig(FINOPS_MANIFEST));
  }
  if (enabledIds.has(WEATHER_APP_ID)) {
    apps.push(withWeatherHostConfig(WEATHER_MANIFEST));
  }

  return apps;
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

function withFinOpsHostConfig(app: AgenticAppManifest): AgenticAppManifest {
  return {
    ...app,
    runtime: {
      ...app.runtime,
      origin: trimTrailingSlash(process.env.AGENTIC_APP_FINOPS_ORIGIN ?? DEFAULT_FINOPS_ORIGIN),
      mountPath: normalizeMountPath(
        process.env.AGENTIC_APP_FINOPS_MOUNT_PATH ?? DEFAULT_FINOPS_MOUNT_PATH,
      ),
    },
  };
}

function withWeatherHostConfig(app: AgenticAppManifest): AgenticAppManifest {
  return {
    ...app,
    runtime: {
      ...app.runtime,
      origin: trimTrailingSlash(process.env.AGENTIC_APP_WEATHER_ORIGIN ?? DEFAULT_WEATHER_ORIGIN),
      mountPath: normalizeMountPath(
        process.env.AGENTIC_APP_WEATHER_MOUNT_PATH ?? DEFAULT_WEATHER_MOUNT_PATH,
        DEFAULT_WEATHER_MOUNT_PATH,
      ),
    },
  };
}

function parseEnabledAppIds(value: string | undefined): Set<string> {
  if (!value) return new Set();
  const ids = value
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  const allIds = [AGENTIC_SDLC_APP_ID, FINOPS_APP_ID, WEATHER_APP_ID];
  return new Set(ids.includes("*") || ids.includes("all") ? allIds : ids);
}

function normalizeMountPath(value: string, fallback = DEFAULT_FINOPS_MOUNT_PATH): string {
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
