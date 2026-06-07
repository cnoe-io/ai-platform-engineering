// assisted-by claude code claude-sonnet-4-6

export type SubjectType = "user" | "service_account";

export type ResourceType =
  | "agent"
  | "skill"
  | "mcp_tool"
  | "knowledge_base"
  | "data_source"
  | "task"
  | "slack_channel"
  | "webex_space"
  | "organization"
  | "team"
  | "conversation";

export type Action =
  | "discover"
  | "read"
  | "read-metadata"
  | "use"
  | "write"
  | "create"
  | "manage"
  | "share"
  | "delete"
  | "ingest"
  | "call"
  | "invoke"
  | "audit";

export type DecisionValue = "ALLOW" | "DENY";

export type ReasonCode =
  | "OK"               // ALLOW
  | "NO_CAPABILITY"    // DENY — no relationship
  | "NOT_AUTHENTICATED"// caller token missing or invalid
  | "AUTHZ_UNAVAILABLE"// PDP error, retriable
  | "INVALID_REQUEST"; // bad id or malformed input

export interface Subject {
  type: SubjectType;
  id: string;
}

export interface Resource {
  type: ResourceType;
  id: string;
}

export interface AuthorizeRequest {
  subject: Subject;
  resource: Resource;
  action: Action;
  /** Advisory only. May only NARROW a grant, never expand it. */
  context?: Record<string, unknown>;
}

export interface AuthorizeResult {
  decision: DecisionValue;
  reason: ReasonCode;
  retriable: boolean;
  ttl_seconds?: number;
}

/**
 * Per-request metadata threaded into the audit trail. Never affects the
 * decision itself — only how it is recorded.
 */
export interface DecisionContext {
  tenantId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
}
