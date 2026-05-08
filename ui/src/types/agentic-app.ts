// assisted-by Codex Codex-sonnet-4-6

export type AgenticAppRuntimeKind =
  | "proxied-next-zone"
  | "iframe-sandboxed"
  | "web-component"
  | "in-process";

export type AgenticAppPackageSource = "builtin" | "admin-import" | "helm" | "api";
export type AgenticAppValidationStatus = "valid" | "warning" | "blocked";
export type AgenticAppHealthStatus = "unknown" | "healthy" | "degraded" | "unreachable";
export type AgenticAppBlockedReason =
  | "not_installed"
  | "disabled"
  | "unauthorized"
  | "unhealthy"
  | "route_conflict"
  | "unsupported_runtime";

/** Marketplace search metadata persisted alongside manifest JSON (indexed in Mongo). */
export interface AgenticAppPackageCatalogMeta {
  categories?: string[];
  capabilities?: string[];
}

/** Stored package row shape (Mongo implementation in a later task). */
export interface AgenticAppPackageRecord {
  packageId: string;
  source: AgenticAppPackageSource;
  manifest: AgenticAppManifest;
  importedAt?: string;
  importedBy?: string;
  catalog?: AgenticAppPackageCatalogMeta;
}

/** Per-environment install / enable flags (Mongo implementation in a later task). */
export interface AgenticAppInstallationRecord {
  appId: string;
  installed: boolean;
  enabled: boolean;
  packageId: string;
  updatedAt?: string;
  /** Last known runtime health from platform checks; drives launch policy with evaluateAppAccess. */
  runtimeHealth?: AgenticAppHealthStatus;
  /** Optional per-installation mount path override (takes precedence over package manifest mountPath for href). */
  runtimeMountPath?: string;
  /** Optional per-installation upstream origin override for proxied execution (overrides manifest.runtime.origin). */
  runtimeOriginOverride?: string;
}

export interface AgenticAppManifest {
  id: string;
  displayName: string;
  description: string;
  apiVersion: "1.0";
  runtime: {
    kind: AgenticAppRuntimeKind;
    origin?: string;
    mountPath: string;
    assetPrefix?: string;
  };
  surfaces: {
    showInHub: boolean;
    showInTopNav?: boolean;
    navOrder?: number;
    homeEligible?: boolean;
    overlays?: string[];
  };
  access: {
    requiredRoles?: string[];
    requiredGroups?: string[];
    /**
     * Declared API/OAuth capability identifiers for this app (manifest metadata for product/docs).
     * Not the authenticated user's granted scopes at runtime.
     */
    tokenScopes: string[];
    canUseCustomAgents?: boolean;
  };
  agents?: Array<{
    id: string;
    displayName: string;
    required: boolean;
    dynamicAgentId?: string;
    capabilities?: string[];
  }>;
  data?: {
    apiBasePath?: string;
    eventChannels?: string[];
    mongoCollections?: string[];
  };
  health: {
    endpoint: string;
    timeoutMs?: number;
  };
}
