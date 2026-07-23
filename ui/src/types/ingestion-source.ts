/**
 * RAG ingestion source configuration (spec 2026-07-21-rag-source-config-db).
 *
 * `IngestionSourceConfig` is the pre-ingestion source of truth for
 * self-service RAG ingestion — distinct from the RAG server's
 * `DataSourceInfo`, which remains the post-ingestion record. See
 * docs/docs/specs/2026-07-21-rag-source-config-db/data-model.md for the
 * full field-mapping rationale.
 */

export type IngestionSourceType =
  | "slack_channel"
  | "confluence_space"
  | "jira_project"
  | "web_url"
  | "webex_space";

export type IngestionSourceStatus = "pending" | "active" | "disabled" | "ingesting";

export type IngestionSourceVisibility = "team" | "global";

export interface IngestionSourceConfigBase {
  source_id: string;
  source_type: IngestionSourceType;
  name: string;
  description?: string;
  status: IngestionSourceStatus;
  default_chunk_size: number;
  default_chunk_overlap: number;
  reload_interval: number;

  config_driven: boolean;
  config_import_adopted: boolean;
  visibility: IngestionSourceVisibility;

  creator_subject?: string;
  owner_subject?: string;
  owner_id?: string;
  owner_team_slug?: string;
  shared_with_teams: string[];

  created_at: string;
  updated_at: string;
}

export interface SlackChannelSource extends IngestionSourceConfigBase {
  source_type: "slack_channel";
  channel_id: string;
  lookback_days?: number;
  include_bots?: boolean;
}

export interface ConfluenceSpaceSource extends IngestionSourceConfigBase {
  source_type: "confluence_space";
  confluence_url: string;
  space_key: string;
}

export interface JiraProjectSource extends IngestionSourceConfigBase {
  source_type: "jira_project";
  project_key: string;
  /**
   * Caller-supplied and immutable at creation — deliberately NOT derived
   * from the mutable `name` field. The current Jira ingestor slugifies
   * `name` into its own `datasource_id`, which silently orphans RBAC tuples
   * on rename; this store's `source_id` formula uses `source_slug` instead
   * so renaming `name` never changes identity. See data-model.md's
   * "Jira id decision".
   */
  source_slug: string;
  jql: string;
  include_comments?: boolean;
}

export interface WebUrlSource extends IngestionSourceConfigBase {
  source_type: "web_url";
  url: string;
}

export interface WebexSpaceSource extends IngestionSourceConfigBase {
  source_type: "webex_space";
  space_id: string;
}

export type IngestionSourceConfig =
  | SlackChannelSource
  | ConfluenceSpaceSource
  | JiraProjectSource
  | WebUrlSource
  | WebexSpaceSource;
