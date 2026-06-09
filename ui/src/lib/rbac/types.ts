/**
 * 098 Enterprise RBAC — Permission matrix types
 *
 * Shared type definitions for RBAC authorization checks across
 * the CAIPE Admin UI and Web UI backend API routes.
 */

/** Protected components from the 098 permission matrix (FR-008, FR-014) */
export type RbacResource =
  | "ai_assist"
  | "admin_ui"
  | "chat_supervisor"
  | "credential_vault"
  | "feedback"
  | "slack"
  | "supervisor"
  | "rag"
  | "self_profile"
  | "sub_agent"
  | "system_config"
  | "tool"
  | "skill"
  | "a2a"
  | "mcp"
  | "team"
  | "user_directory"
  | "user_files"
  | "user_settings"
  | "mcp_server"
  | "dynamic_agent"
  | "user_directory"
  | "user_files"
  | "user_settings";

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
  | "kb.query"
  | "read"
  | "manage"
  | "submit"
  | "use"
  | "write";

/** Legacy transition label; CAIPE authorization now comes from OpenFGA relationships. */
export type RbacRole = "denied";

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
export type AuditPdp = "keycloak" | "agent_gateway" | "local" | "openfga";

/** Reason codes for authorization decisions */
export type AuditReasonCode =
  | "OK"
  | "OK_ROLE_FALLBACK"
  | "ALLOW_TEAM_UNION"
  | "DENY_NO_CAPABILITY"
  | "DENY_NO_TOKEN"
  | "DENY_SCOPE"
  | "DENY_TENANT"
  | "DENY_UNLINKED"
  | "DENY_PDP_UNAVAILABLE";

/** Structured audit event for authorization decisions (FR-005, data-model.md) */
export interface AuditEvent {
  audit_event_id?: string;
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
  trace_id?: string;
  span_id?: string;
  trace_url?: string;
}

/** User's effective permissions map — returned by the Web UI backend capabilities endpoint */
export type PermissionsMap = Partial<Record<RbacResource, string[]>>;

/** Keycloak Authorization Services configuration */
export interface KeycloakAuthzConfig {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}

/** Unified audit event types (FR-037) */
export type AuditEventType = "auth" | "tool_action" | "agent_delegation" | "openfga_rebac";

/** Unified audit event outcome — superset of AuditOutcome for tool/delegation */
export type UnifiedAuditOutcome = "allow" | "deny" | "success" | "error";

/** Source system that produced the audit event */
export type AuditEventSource =
  | "webui_backend"
  | "bff"
  | "supervisor"
  | "slack"
  | "dynamic_agents"
  | "openfga_authz_bridge";

/** Unified audit event stored in the audit_events MongoDB collection (FR-037) */
export interface UnifiedAuditEvent {
  audit_event_id?: string;
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
  trace_id?: string;
  span_id?: string;
  trace_url?: string;
}

/** Admin dashboard tab keys for RBAC-based visibility */
export type AdminTabKey =
  | "users"
  | "teams"
  | "roles"
  | "identity_group_sync"
  | "slack"
  | "webex"
  | "skills"
  | "feedback"
  | "nps"
  | "stats"
  | "metrics"
  | "health"
  | "credentials"
  | "audit_logs"
  | "action_audit"
  | "openfga"
  | "migrations"
  | "service_accounts";

/** Per-tab visibility gates returned by GET /api/rbac/admin-tab-gates */
export type AdminTabGatesMap = Record<AdminTabKey, boolean>;

/**
 * Knowledge sidebar tab keys for RBAC-based visibility.
 *
 * Returned by GET /api/rbac/kb-tab-gates. Org admins (`organization#admin`)
 * always see every tab; non-admins see a tab only if they have at least one
 * readable resource on that surface (or a readable KB for `graph` / `search`
 * / `data_sources`).
 */
export type KbTabKey =
  | "search"
  | "data_sources"
  | "graph"
  | "mcp_tools";

/**
 * Per-tab visibility gates returned by GET /api/rbac/kb-tab-gates.
 * Includes counts the sidebar uses for empty-state banners.
 */
export interface KbTabGatesMap {
  search: boolean;
  data_sources: boolean;
  graph: boolean;
  mcp_tools: boolean;
  /** True iff `kb_count > 0` OR the user is an org admin. */
  has_any_kb: boolean;
  /** Number of `knowledge_base:<id>` objects the user can `can_read`. -1 means "unknown / admin bypass". */
  kb_count: number;
  /**
   * Explicit "data source author" capability (spec 2026-06-03). True iff the
   * user holds `organization#can_ingest` — i.e. they belong to a team an org
   * admin opted in via the ingest-capability toggle, or they are an org admin.
   * Drives whether the create/ingest UI ("Add Data Source") is shown. This is
   * deliberately DECOUPLED from per-KB `ingestor` (which only means "push into
   * KB X").
   */
  can_ingest: boolean;
  /**
   * Explicit "search" capability (spec 2026-06-03-explicit-search-capability).
   * True iff the user holds `organization#can_search` — i.e. they belong to a
   * team an org admin opted in via the search-capability toggle, or they are an
   * org admin. Drives whether the Search tab is usable and whether the data
   * path (`/v1/query`, `/v1/mcp/invoke`) is permitted. Layered ABOVE the
   * narrower per-tool `mcp_tool#can_call` and per-datasource `data_source#can_read`.
   */
  can_search: boolean;
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
