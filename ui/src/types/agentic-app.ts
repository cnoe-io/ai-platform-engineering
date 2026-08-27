// assisted-by Codex Codex-sonnet-4-6

export type AgenticAppRuntimeKind =
  | "proxied-next-zone"
  | "iframe-sandboxed"
  | "web-component"
  | "in-process";

export type AgenticAppPackageSource = "builtin" | "admin-import" | "helm" | "api";
export type AgenticAppValidationStatus = "valid" | "warning" | "blocked";
export type AgenticAppHealthStatus = "unknown" | "healthy" | "degraded" | "unreachable";
export type AgenticAppPdpEffect = "allow" | "deny";
export type AgenticAppVisibility = "private" | "team" | "global";
export type AgenticAppTeamRole = "viewer" | "editor" | "approver" | "admin";
export type AgenticAppCasAction = "read" | "use" | "write" | "approve" | "manage";

export interface AgenticAppTeamAccessGrant {
  teamSlug: string;
  role: AgenticAppTeamRole;
}
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
  icon?: string;
  supportUrl?: string;
  compatibility?: string;
}

export interface AgenticAppPackageProvenance {
  digest?: string;
  version?: string;
  publisher?: string;
  sourceUrl?: string;
}

/** Stored package row shape (Mongo implementation in a later task). */
export interface AgenticAppPackageRecord {
  packageId: string;
  source: AgenticAppPackageSource;
  manifest: AgenticAppManifest;
  /** Deployment-managed records are reconciled from seed config and read-only via admin APIs. */
  config_driven?: boolean;
  importedAt?: string;
  importedBy?: string;
  catalog?: AgenticAppPackageCatalogMeta;
  validationStatus?: AgenticAppValidationStatus;
  validationMessages?: string[];
  provenance?: AgenticAppPackageProvenance;
}

export interface AgenticAppAccessOverrides {
  requiredRoles?: string[];
  requiredGroups?: string[];
  tenants?: string[];
  policyRef?: string;
}

export interface AgenticAppHealthPolicy {
  blockLaunchWhen?: AgenticAppHealthStatus[];
}

export interface AgenticAppRouteOwnership {
  normalizedMountPath: string;
}

export interface AgenticAppPdpPolicyAction {
  action: string;
  description?: string;
  defaultEffect?: AgenticAppPdpEffect;
  reasonCode?: string;
  /** Least-privilege scopes minted when this action is allowed. */
  requiredScopes?: string[];
  /** Optional HTTP route selector used by the execution gateway. */
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Absolute upstream API path. `:parameter` segments match one path segment. */
  path?: string;
  /** CAS capability that must be confirmed before scopes are minted. */
  casAction?: AgenticAppCasAction;
}

/** Per-environment install / enable flags (Mongo implementation in a later task). */
export interface AgenticAppInstallationRecord {
  appId: string;
  installed: boolean;
  enabled: boolean;
  visible?: boolean;
  packageId: string;
  /** Deployment-managed records are reconciled from seed config and read-only via admin APIs. */
  config_driven?: boolean;
  createdAt?: string;
  createdBy?: string;
  /** Stable Keycloak subject used for provenance; never grants access by itself. */
  creatorSubject?: string;
  /** Stable subject that owns private access and may manage sharing. */
  ownerSubject?: string;
  /** Discovery and launch scope projected into CAS/OpenFGA. Legacy rows default to global. */
  visibility?: AgenticAppVisibility;
  /** Canonical team slugs granted use when visibility is team. */
  sharedWithTeams?: string[];
  /** Exclusive per-team role projected into OpenFGA. Legacy rows derive viewers from sharedWithTeams. */
  teamAccess?: AgenticAppTeamAccessGrant[];
  updatedAt?: string;
  updatedBy?: string;
  /** Last known runtime health from platform checks; drives launch policy with evaluateAppAccess. */
  runtimeHealth?: AgenticAppHealthStatus;
  healthPolicy?: AgenticAppHealthPolicy;
  accessOverrides?: AgenticAppAccessOverrides;
  routeOwnership?: AgenticAppRouteOwnership;
  /** Optional per-installation mount path override (takes precedence over package manifest mountPath for href). */
  runtimeMountPath?: string;
  /** Optional per-installation upstream origin override for proxied execution (overrides manifest.runtime.origin). */
  runtimeOriginOverride?: string;
}

export interface AgenticAppAssistantConfig {
  enabled?: boolean;
  /**
   * Stable dynamic-agent ID that owns this app's contextual chat surface.
   * When configured, the shell must select this exact CAS-visible agent and
   * must not fall back to a user or platform default.
   */
  agentId?: string;
  schemaVersions?: string[];
  maxContextBytes?: number;
  capability?: string;
  suggestions?: boolean;
  /**
   * Optional per-app label for the floating assistant bubble (e.g. "Ask FinOps", "Ask Weather").
   * Defaults to "Ask CAIPE" when omitted. Max 32 chars.
   */
  label?: string;
  /**
   * Optional display name for the assistant inside the chat panel header (e.g. "FinOps Assistant").
   * Defaults to "CAIPE Assistant" when omitted. Max 64 chars.
   */
  agentName?: string;
}

export interface AgenticAppWebhookChannel {
  provider: string;
  channel: string;
  upstreamPath: string;
  allowedMethods: Array<"POST" | "PUT">;
  verificationOwner: "app" | "caipe";
  preservedHeaders?: string[];
  maxBodyBytes: number;
  policyAction?: string;
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
    /**
     * When true, the execution gateway forwards the public mount path to the
     * upstream (e.g. `/apps/<id>/foo` -> `<origin>/apps/<id>/foo`) instead of
     * stripping it. Required for apps that use Next.js `basePath` or any
     * framework that expects to see its own prefix. Default false.
     */
    preserveMountPath?: boolean;
    /**
     * Visual chrome wrapper:
     *   - "fullscreen" (default): proxied app owns the entire viewport. Use
     *     for standalone apps that ship their own header/nav (matches the
     *     FinOps and Weather samples).
     *   - "iframe": CAIPE wraps the app in a sandboxed `<iframe>` rendered
     *     inside the standard CAIPE shell (top header + body). Use for apps
     *     that want CAIPE chrome above them. Launch URL becomes
     *     the canonical `/apps/<id>` shell, with the runtime proxied under
     *     `/api/agentic-apps/runtime/<id>`.
     */
    chrome?: "fullscreen" | "iframe";
  };
  /** Versioned contract between the CAIPE shell and a hosted microfrontend. */
  ui?: {
    contractVersion: "1.0";
    surface: "hosted" | "standalone";
    routes?: string[];
    preferences?: {
      schemaVersion: "1.0";
      fields: Array<{
        key: string;
        label: string;
        type: "boolean" | "number" | "string" | "enum";
        default: boolean | number | string;
        options?: Array<{ label: string; value: string }>;
        min?: number;
        max?: number;
      }>;
    };
  };
  /** PDP-agnostic CAS authorization target for this app surface. */
  authorization?: {
    resourceType: "agentic_app";
    launchAction: "use";
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
    policyActions?: AgenticAppPdpPolicyAction[];
  };
  assistant?: AgenticAppAssistantConfig;
  webhooks?: AgenticAppWebhookChannel[];
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
    blockLaunchWhen?: AgenticAppHealthStatus[];
  };
  catalog?: AgenticAppPackageCatalogMeta;
}

export interface AgenticAppPdpDecisionRecord {
  decisionId: string;
  correlationId: string;
  appId: string;
  action: string;
  effect: AgenticAppPdpEffect;
  reasonCode: string;
  issuedAt: string;
  expiresAt: string;
  subject?: Record<string, unknown>;
  tenant?: string;
  resource?: Record<string, unknown>;
  route?: string;
  method?: string;
  policySource?: string;
  safeMetadata?: Record<string, unknown>;
}

export interface AgenticAppTokenGrantRecord {
  jti: string;
  decisionId: string;
  correlationId: string;
  appId: string;
  audience: string;
  scopes: string[];
  issuedAt: string;
  expiresAt: string;
  subject?: Record<string, unknown>;
  revokedAt?: string;
  tokenHash?: string;
}

export interface AgenticAppWebhookDeliveryRecord {
  deliveryId: string;
  appId: string;
  provider: string;
  channel: string;
  status: "accepted" | "denied" | "forwarded" | "failed" | "dropped" | "rate_limited";
  bodySha256: string;
  receivedAt: string;
  providerDeliveryId?: string;
  decisionId?: string;
  correlationId?: string;
  httpStatus?: number;
  completedAt?: string;
  safeHeaders?: Record<string, string>;
}

export interface AgenticAppAssistantContextRecord {
  contextId: string;
  appId: string;
  sessionId: string;
  schemaVersion: string;
  route: string;
  payloadSizeBytes: number;
  validationStatus: "accepted" | "ignored" | "rejected";
  createdAt: string;
  expiresAt: string;
  userSubjectHash?: string;
  title?: string;
  summary?: string;
  selection?: string;
  resourceRefs?: Array<Record<string, string>>;
  suggestedPrompts?: string[];
  reasonCode?: string;
}

export interface AgenticAppHealthSnapshotRecord {
  appId: string;
  status: AgenticAppHealthStatus;
  checkedAt: string;
  expiresAt?: string;
  reasonCode?: string;
  safeMetadata?: Record<string, unknown>;
}

export interface AgenticAppAuditEventRecord {
  createdAt: string;
  type: string;
  actorEmail?: string;
  actorSubjectHash?: string;
  appId?: string;
  packageId?: string;
  decisionId?: string;
  correlationId?: string;
  outcome?: string;
  reasonCode?: string;
  payload?: Record<string, unknown>;
}
