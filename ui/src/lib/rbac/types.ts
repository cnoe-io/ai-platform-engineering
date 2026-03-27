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
export type AuditPdp = "keycloak" | "agent_gateway" | "local";

/** Reason codes for authorization decisions */
export type AuditReasonCode =
  | "OK"
  | "OK_ROLE_FALLBACK"
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

/** Unified audit event types (FR-037) */
export type AuditEventType = "auth" | "tool_action" | "agent_delegation";

/** Unified audit event outcome — superset of AuditOutcome for tool/delegation */
export type UnifiedAuditOutcome = "allow" | "deny" | "success" | "error";

/** Source system that produced the audit event */
export type AuditEventSource = "bff" | "supervisor" | "slack";

/** Unified audit event stored in the audit_events MongoDB collection (FR-037) */
export interface UnifiedAuditEvent {
  ts: string;
  type: AuditEventType;
  tenant_id: string;
  subject_hash: string;
  user_email?: string;
  action: string;
  agent_name?: string;
  tool_name?: string;
  outcome: UnifiedAuditOutcome;
  reason_code?: string;
  duration_ms?: number;
  correlation_id: string;
  context_id?: string;
  component?: string;
  resource_ref?: string;
  pdp?: string;
  source: AuditEventSource;
}

/** Admin dashboard tab keys for CEL-based visibility (US2, FR-004) */
export type AdminTabKey =
  | "users"
  | "teams"
  | "roles"
  | "slack"
  | "skills"
  | "feedback"
  | "nps"
  | "stats"
  | "metrics"
  | "health"
  | "audit_logs"
  | "action_audit"
  | "policy"
  | "ag_policies";

/** Per-tab visibility gates returned by GET /api/rbac/admin-tab-gates */
export type AdminTabGatesMap = Record<AdminTabKey, boolean>;

/** A single CEL policy row stored in MongoDB admin_tab_policies */
export interface AdminTabPolicy {
  tab_key: AdminTabKey;
  expression: string;
  updated_by?: string;
  updated_at?: string;
}

/** AG MCP policy — CEL rule for a specific MCP backend + tool pattern (FR-039) */
export interface AgMcpPolicy {
  _id?: string;
  backend_id: string;
  tool_pattern: string;
  expression: string;
  description?: string;
  enabled: boolean;
  updated_by: string;
  updated_at: string;
}

/** AG MCP backend target stored in `ag_mcp_backends` collection (FR-039) */
export interface AgMcpBackend {
  _id?: string;
  id: string;
  upstream_url: string;
  description: string;
  enabled: boolean;
  updated_by: string;
  updated_at: string;
}

/** AG config sync state — tracks generation counters for hot-reload (FR-039) */
export interface AgSyncState {
  _id: 'current';
  policy_generation: number;
  bridge_generation: number;
  bridge_last_sync: string;
  bridge_error?: string;
}

/** Per-KB permission level for team-KB ownership (FR-038) */
export type KbPermission = 'read' | 'ingest' | 'admin';

/** Team-KB ownership record stored in `team_kb_ownership` MongoDB collection (FR-038) */
export interface TeamKbOwnership {
  team_id: string;
  tenant_id: string;
  kb_ids: string[];
  allowed_datasource_ids: string[];
  kb_permissions: Record<string, KbPermission>;
  keycloak_role: string;
  updated_at: Date;
  updated_by: string;
}
