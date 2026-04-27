// Team types for team management and sharing

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
  owner_id: string; // User email who created the team
  created_at: Date;
  updated_at: Date;
  members: TeamMember[];
  keycloak_roles?: string[];
  /**
   * Spec 104 team-scoped RBAC: agents the team can chat with and tools the
   * team can invoke. Persisted on the team document and materialized into
   * Keycloak realm roles (`agent_user:<id>`, `tool_user:<id>`) on every
   * member when the resources change.
   */
  resources?: {
    agents?: string[];        // dynamic_agents._id values → agent_user:<id>
    agent_admins?: string[];  // dynamic_agents._id values → agent_admin:<id>
    tools?: string[];         // tool prefixes (e.g. `jira_*`) → tool_user:<prefix>
    tool_wildcard?: boolean;  // true → grant tool_user:* (all tools)
  };
  /**
   * Spec 098 US9 — Slack channels assigned to this team. Each row mirrors a
   * `channel_team_mappings` document and (optionally) a paired
   * `channel_agent_mappings` document so the UI can manage both bindings
   * in one place. Only the `slack_channels` count is denormalised onto the
   * team document for cheap card-rendering; the source of truth still lives
   * in the dedicated mapping collections (which the Slack bot reads).
   */
  slack_channels?: Array<{
    slack_channel_id: string;
    channel_name: string;
    slack_workspace_id?: string;
    bound_agent_id?: string | null;
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
   * Optional explicit slug. If omitted, the BFF derives it from `name`
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
