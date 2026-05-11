// assisted-by Codex Codex-sonnet-4-6

import type { AgenticAppManifest } from "@/types/agentic-app";

export const neutralExternalAppManifest: AgenticAppManifest = {
  id: "neutral-app",
  displayName: "Neutral External App",
  description: "A neutral external app fixture for generic install and launch tests.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    origin: "http://localhost:3999",
    mountPath: "/apps/neutral-app",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: false,
    navOrder: 100,
    homeEligible: false,
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["neutral:read"],
  },
  health: {
    endpoint: "/healthz",
    timeoutMs: 1500,
  },
};

export const adminOnlyExternalAppManifest: AgenticAppManifest = {
  ...neutralExternalAppManifest,
  id: "admin-only-app",
  displayName: "Admin Only External App",
  description: "A neutral external app fixture that requires admin access.",
  runtime: {
    ...neutralExternalAppManifest.runtime,
    mountPath: "/apps/admin-only-app",
  },
  access: {
    requiredRoles: ["admin"],
    tokenScopes: ["admin-only:read"],
  },
};

export const disabledRuntimeExternalAppManifest: AgenticAppManifest = {
  ...neutralExternalAppManifest,
  id: "disabled-runtime-app",
  displayName: "Disabled Runtime App",
  description: "A neutral external app fixture used for disabled and unhealthy states.",
  runtime: {
    ...neutralExternalAppManifest.runtime,
    mountPath: "/apps/disabled-runtime-app",
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["disabled-runtime:read"],
  },
};

describe("agentic app manifest fixtures", () => {
  it("provides unique fixture app ids", () => {
    const ids = [
      neutralExternalAppManifest.id,
      adminOnlyExternalAppManifest.id,
      disabledRuntimeExternalAppManifest.id,
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
