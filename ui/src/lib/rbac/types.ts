/**
 * 098 Enterprise RBAC — Permission matrix types
 *
 * Shared type definitions for RBAC authorization checks across
 * the CAIPE Admin UI and BFF API routes.
 */

/** Protected components from the 098 permission matrix (FR-008, FR-014) */
export type RbacResource =
  | "admin_ui"
  | "slack"
  | "supervisor"
  | "rag"
  | "sub_agent"
  | "tool"
  | "skill"
  | "a2a"
  | "mcp";

/** Common capability scopes from the permission matrix */
export type RbacScope =
  | "view"
  | "create"
  | "update"
  | "delete"
  | "invoke"
  | "admin"
  | "configure"
  | "ingest"
  | "query"
  | "audit.view"
  | "tool.create"
  | "tool.update"
  | "tool.delete"
  | "tool.view"
  | "kb.admin"
  | "kb.ingest"
  | "kb.query";

/** Keycloak realm roles aligned with IdP group mapping (FR-010) */
export type RbacRole =
  | "admin"
  | "chat_user"
  | "team_member"
  | "kb_admin"
  | "denied";

/** Authorization check request — sent to Keycloak AuthZ Services (PDP-1) */
export interface RbacCheckRequest {
  resource: RbacResource;
  scope: string;
  accessToken: string;
}

/** Authorization check result — returned by PDP */
export interface RbacCheckResult {
  allowed: boolean;
  reason?: string;
}

/** Audit event outcome */
export type AuditOutcome = "allow" | "deny";

/** PDP that evaluated the decision */
export type AuditPdp = "keycloak" | "agent_gateway";

/** Reason codes for authorization decisions */
export type AuditReasonCode =
  | "OK"
  | "DENY_NO_CAPABILITY"
  | "DENY_NO_TOKEN"
  | "DENY_SCOPE"
  | "DENY_TENANT"
  | "DENY_UNLINKED"
  | "DENY_PDP_UNAVAILABLE"
  | "DENY_CEL";

/** Structured audit event for authorization decisions (FR-005, data-model.md) */
export interface AuditEvent {
  ts: string;
  tenant_id: string;
  subject_hash: string;
  actor_hash?: string;
  capability: string;
  component: RbacResource;
  resource_ref?: string;
  outcome: AuditOutcome;
  reason_code: AuditReasonCode;
  pdp: AuditPdp;
  correlation_id: string;
}

/** User's effective permissions map — returned by BFF capabilities endpoint */
export type PermissionsMap = Partial<Record<RbacResource, string[]>>;

/** Keycloak Authorization Services configuration */
export interface KeycloakAuthzConfig {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}
