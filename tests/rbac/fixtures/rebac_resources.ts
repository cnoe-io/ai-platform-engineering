import type {
  UniversalRebacResourceAction,
  UniversalRebacResourceType,
} from "../../../ui/src/types/rbac-universal";

export interface RebacResourceFixture {
  readonly type: UniversalRebacResourceType;
  readonly id: string;
  readonly displayName: string;
  readonly representativeActions: readonly UniversalRebacResourceAction[];
}

export const REBAC_RESOURCE_FIXTURES: readonly RebacResourceFixture[] = [
  {
    type: "organization",
    id: "caipe",
    displayName: "CAIPE",
    representativeActions: ["read", "manage", "audit"],
  },
  {
    type: "user",
    id: "alice_admin",
    displayName: "Alice Admin",
    representativeActions: ["read", "manage", "audit"],
  },
  {
    type: "external_group",
    id: "okta-platform-admins",
    displayName: "Okta Platform Admins",
    representativeActions: ["discover", "read", "map"],
  },
  {
    type: "team",
    id: "platform",
    displayName: "Platform",
    representativeActions: ["read", "manage"],
  },
  {
    type: "slack_workspace",
    id: "TCAIPEDEMO",
    displayName: "CAIPE Demo Workspace",
    representativeActions: ["discover", "read", "manage"],
  },
  {
    type: "slack_channel",
    id: "TCAIPEDEMO:CPLATFORMOPS",
    displayName: "#platform-ops",
    representativeActions: ["read", "use", "manage"],
  },
  {
    type: "agent",
    id: "platform-engineer",
    displayName: "Platform Engineer",
    representativeActions: ["discover", "use", "manage"],
  },
  {
    type: "mcp_server",
    id: "argocd",
    displayName: "Argo CD MCP Server",
    representativeActions: ["discover", "invoke", "manage"],
  },
  {
    type: "tool",
    id: "argocd",
    displayName: "Argo CD",
    representativeActions: ["discover", "call", "manage"],
  },
  {
    type: "knowledge_base",
    id: "platform-runbooks",
    displayName: "Platform Runbooks",
    representativeActions: ["read", "ingest", "administer"],
  },
  {
    type: "document",
    id: "platform-runbooks:deploy-checklist",
    displayName: "Deploy Checklist",
    representativeActions: ["discover", "read", "share"],
  },
  {
    type: "skill",
    id: "incident-triage",
    displayName: "Incident Triage",
    representativeActions: ["discover", "use", "manage"],
  },
  {
    type: "task",
    id: "task-123",
    displayName: "Investigate Deployment",
    representativeActions: ["read", "write", "approve"],
  },
  {
    type: "conversation",
    id: "conversation-123",
    displayName: "Deployment Conversation",
    representativeActions: ["read", "share", "delete"],
  },
  {
    type: "admin_surface",
    id: "identity-group-sync",
    displayName: "Identity Group Sync Admin",
    representativeActions: ["read", "write", "manage"],
  },
  {
    type: "policy",
    id: "rebac-policy-platform",
    displayName: "Platform ReBAC Policy",
    representativeActions: ["read", "approve", "manage"],
  },
  {
    type: "audit_log",
    id: "rbac-audit",
    displayName: "RBAC Audit Log",
    representativeActions: ["discover", "read", "audit"],
  },
  {
    type: "secret_ref",
    id: "okta-api-token",
    displayName: "Okta API Token Reference",
    representativeActions: ["discover", "read-metadata", "use"],
  },
  {
    type: "system_config",
    id: "rbac",
    displayName: "RBAC System Configuration",
    representativeActions: ["read", "write", "manage"],
  },
];
