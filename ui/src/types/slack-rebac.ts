import type {
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
} from "./rbac-universal";

export type SlackChannelGrantResourceType = "agent" | "tool" | "knowledge_base" | "skill" | "task";

export interface SlackChannelRef {
  workspace_id: string;
  channel_id: string;
  channel_name?: string;
  team_slug?: string;
}

export interface SlackChannelResourceGrant {
  workspace_id: string;
  channel_id: string;
  resource: UniversalRebacResourceRef & { type: SlackChannelGrantResourceType };
  actions: UniversalRebacResourceAction[];
  source_type: "manual" | "policy_rule" | "migration" | "bootstrap";
  status: "active" | "staged" | "revoked" | "blocked";
  created_by?: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
}

export interface SlackChannelAccessCheckRequest {
  workspace_id: string;
  channel_id: string;
  user_subject?: string;
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
}

export interface SlackChannelAccessCheckResult {
  allowed: boolean;
  channel_allowed: boolean;
  user_allowed: boolean;
  reason: "allowed" | "missing_channel_grant" | "missing_user_grant" | "unsupported_action";
}
