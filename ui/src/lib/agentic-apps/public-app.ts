import type { ConfiguredAgenticApp, PublicAgenticApp } from "@/types/agentic-app";

/** Build the browser-safe catalog record. Runtime origins never cross the BFF. */
export function buildPublicAgenticApp(
  app: ConfiguredAgenticApp,
  canLaunch: boolean,
  sharingEnabled = false,
): PublicAgenticApp {
  return {
    appId: app.installation.appId,
    displayName: app.manifest.displayName,
    description: app.manifest.description,
    href: `/apps/${encodeURIComponent(app.installation.appId)}`,
    canLaunch,
    blockedReasons: canLaunch ? [] : ["unauthorized"],
    categories: app.manifest.catalog?.categories ?? [],
    capabilities: app.manifest.catalog?.capabilities ?? [],
    runtimeKind: app.manifest.runtime.kind,
    requestedScopes: app.manifest.access.tokenScopes,
    createdBy: "Deployment config",
    visibility: "global",
    sharedWithTeams: [],
    // The security endpoint resolves the authoritative permission when the
    // dialog opens. Defaulting closed avoids exposing write controls early.
    canManage: false,
    sharingEnabled,
  };
}
