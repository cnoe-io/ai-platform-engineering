import type {
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
} from "./rbac-universal";

export type WebexSpaceGrantResourceType = "agent" | "tool" | "knowledge_base" | "skill" | "task";

export interface WebexSpaceRef {
  workspace_id: string;
  space_id: string;
  space_title?: string;
  team_slug?: string;
}

export interface WebexSpaceResourceGrant {
  workspace_id: string;
  space_id: string;
  resource: UniversalRebacResourceRef & { type: WebexSpaceGrantResourceType };
  actions: UniversalRebacResourceAction[];
  source_type: "manual" | "policy_rule" | "migration" | "bootstrap" | "route";
  status: "active" | "staged" | "revoked" | "blocked";
  created_by?: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
}

export type WebexRouteListenMode = "message" | "mention" | "all";

export interface WebexRouteSideConfig {
  enabled?: boolean;
  listen?: WebexRouteListenMode;
  user_list?: string[];
  bot_list?: string[];
  overthink?: {
    enabled?: boolean;
  };
}

export interface WebexRouteEscalationConfig {
  emoji?: {
    enabled?: boolean;
    name?: string;
  };
  delete_admins?: string[];
  users?: string[];
  victorops?: {
    enabled?: boolean;
    team?: string;
  };
}

export interface WebexSpaceAgentRoute {
  workspace_id: string;
  space_id: string;
  agent_id: string;
  enabled: boolean;
  priority: number;
  users?: WebexRouteSideConfig;
  bots?: WebexRouteSideConfig;
  escalation?: WebexRouteEscalationConfig;
  source_type: "manual" | "yaml_import" | "bootstrap";
  status: "active" | "disabled" | "revoked";
  created_by?: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
}

export interface WebexSpaceAccessCheckRequest {
  workspace_id: string;
  space_id: string;
  user_subject?: string;
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
}

export interface WebexSpaceAccessCheckResult {
  allowed: boolean;
  space_allowed: boolean;
  user_allowed: boolean;
  reason:
    | "allowed"
    | "missing_space_grant"
    | "missing_user_grant"
    | "unsupported_resource";
}
