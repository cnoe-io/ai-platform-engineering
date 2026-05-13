/**
 * Shared types for the universal ReBAC model introduced by the
 * identity-group ReBAC specification.
 */

export type UniversalRebacStandardAction =
  | "discover"
  | "read"
  | "use"
  | "write"
  | "create"
  | "delete"
  | "manage"
  | "administer"
  | "audit"
  | "approve"
  | "share";

export type UniversalRebacResourceAction =
  | UniversalRebacStandardAction
  | "call"
  | "invoke"
  | "map"
  | "ingest"
  | "read-metadata";

export type UniversalRebacResourceType =
  | "organization"
  | "user"
  | "external_group"
  | "team"
  | "slack_workspace"
  | "slack_channel"
  | "agent"
  | "mcp_server"
  | "tool"
  | "knowledge_base"
  | "document"
  | "skill"
  | "task"
  | "conversation"
  | "admin_surface"
  | "policy"
  | "audit_log"
  | "secret_ref"
  | "system_config";

export type UniversalRebacSubjectType =
  | "user"
  | "team"
  | "slack_channel"
  | "external_group"
  | "service_account"
  | "anonymous";

export interface UniversalRebacSubjectRef {
  type: UniversalRebacSubjectType;
  id: string;
  relation?: "member" | "admin" | "owner";
}

export interface UniversalRebacResourceRef {
  type: UniversalRebacResourceType;
  id: string;
}

export interface UniversalRebacRelationship {
  subject: UniversalRebacSubjectRef;
  action: UniversalRebacResourceAction;
  resource: UniversalRebacResourceRef;
}

export interface UniversalRebacResourceTypeDefinition {
  type: UniversalRebacResourceType;
  actions: readonly UniversalRebacResourceAction[];
  description: string;
}
