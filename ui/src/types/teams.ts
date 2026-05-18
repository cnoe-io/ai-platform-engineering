// Team types for team management and sharing

import type { TeamMembershipSource } from "./identity-group-sync";

export interface Team {
  _id: string;
  /**
   * Spec 104: short, URL-safe identifier used as the suffix of the per-team
   * Keycloak client scope (`team-<slug>`) and as the literal value of the
   * `active_team` JWT claim. Lowercase alphanumerics + hyphens, max 63 chars.
   * Auto-derived from `name` on team creation; immutable afterwards because
   * renaming the slug would orphan the existing Keycloak scope and silently
   * change every downstream RBAC decision tied to it.
   */
  slug: string;
  name: string;
  description?: string;
  source?: 'manual' | 'identity_sync' | 'bootstrap' | 'migration';
  status?: 'active' | 'archived' | 'pending_review' | 'disabled';
  owner_id: string; // User email who created the team
  created_by?: string;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
  members: TeamMember[];
  membership_sources?: TeamMembershipSource[];
  keycloak_roles?: string[];
  /**
   * Spec 104 team-scoped RBAC: agents the team can chat with and tools the
   * team can invoke. Persisted on the team document and materialized into
   * OpenFGA team-resource tuples. Keycloak no longer mirrors per-resource roles
   * such as `agent_user:<id>` or `tool_user:<id>`.
   */
  resources?: {
    agents?: string[];        // dynamic_agents._id values → team can_use agent:<id>
    agent_admins?: string[];  // dynamic_agents._id values → team can_manage agent:<id>
    tools?: string[];         // tool prefixes (e.g. `jira_*`) → team can_call tool:<prefix>
    knowledge_bases?: string[];
    skills?: string[];
    tasks?: string[];
    tool_wildcard?: boolean;  // true -> grant all tools through OpenFGA wildcard
  };
  /**
   * Spec 098 US9 — Slack channels assigned to this team. Each row mirrors a
   * `channel_team_mappings` document. Agent/resource access is managed by
   * Slack channel ReBAC grants rather than a single bound agent.
   */
  slack_channels?: Array<{
    slack_channel_id: string;
    channel_name: string;
    slack_workspace_id?: string;
  }>;
  metadata?: {
    department?: string;
    tags?: string[];
  };
}

export interface TeamMember {
  user_id: string; // User email
  role: 'owner' | 'admin' | 'member';
  added_at: Date;
  added_by: string; // User email
}

export interface CreateTeamRequest {
  name: string;
  /**
   * Optional explicit slug. If omitted, the Web UI backend derives it from `name`
   * (lowercase, non-alphanumerics → `-`, deduped, trimmed).
   */
  slug?: string;
  description?: string;
  members?: string[]; // Array of user emails
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string;
}

export interface AddTeamMemberRequest {
  user_id: string; // User email
  role?: 'admin' | 'member';
}
