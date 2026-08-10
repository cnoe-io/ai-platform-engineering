// assisted-by Cursor Composer

/** Backstage catalog entity for an Outshift project (maps to kind: System). */
export interface BackstageProjectCatalog {
  apiVersion: "backstage.io/v1alpha1";
  kind: "System";
  metadata: {
    name: string;
    title: string;
    description: string;
    annotations: Record<string, string>;
    tags: string[];
  };
  spec: {
    owner: string;
    domain: string;
    type: string;
    mailer?: string;
    manager?: string;
    outshift?: {
      rbac?: {
        tools?: Array<{
          name: string;
          sync?: boolean;
          roles: Record<string, string | string[]>;
        }>;
      };
    };
  };
}

export interface BackstageComponentCatalog {
  apiVersion: "backstage.io/v1alpha1";
  kind: "Component";
  metadata: {
    name: string;
    title: string;
    description: string;
    tags: string[];
  };
  spec: {
    type: string;
    lifecycle: string;
    owner: string;
    system: string;
  };
}

export type OnboardingStepStatus = "pending" | "running" | "completed" | "failed";

export interface OnboardingStepState {
  status: OnboardingStepStatus;
  completed_at?: Date;
  error?: string;
  mock_ref?: string;
}

export type ProjectLifecycleStatus = "draft" | "onboarding" | "active" | "archived";

export type ProjectSource = "manual" | "backstage";

/**
 * Project kind. A regular `project` ingests its own sources. A `bhag` (Big
 * Hairy Audacious Goal) is a strategic entity with its own wiki whose stable
 * pages are leadership-authored and whose dynamic pages are agent-synthesized
 * from the projects tagged to it (via `labels.initiatives`) plus any direct
 * sources attached to the BHAG.
 * An `area` is a mid-tier grouping between a BHAG and its projects; it tags
 * a BHAG via `labels.initiatives` and is synthesized from its child projects
 * (which tag it via `labels.areas`) plus any direct sources attached to it.
 * Legacy documents without a `type` are treated as `project`.
 */
export type ProjectType = "project" | "bhag" | "area";

export type DataStewardKind = "user" | "team";

/**
 * Display metadata for the one OpenFGA principal that stewards a Tome entity.
 * Authorization is enforced from the corresponding OpenFGA `document` tuple;
 * this value keeps the selected user/team legible and supports reconciliation.
 */
export interface DataStewardAssignment {
  type: DataStewardKind;
  /** Keycloak subject for users; canonical team slug for teams. */
  id: string;
  name: string;
  /** Present only for user stewards. */
  email?: string;
}

export type DataStewardInput =
  | { type: "user"; email: string }
  | { type: "team"; team_id: string };

export type StoredDataSteward = DataStewardAssignment | string;

export function dataStewardLabel(steward: StoredDataSteward | undefined): string {
  if (!steward) return "";
  if (typeof steward === "string") return steward;
  return steward.name || steward.email || steward.id;
}

export function dataStewardUserEmail(steward: StoredDataSteward | undefined): string {
  if (!steward) return "";
  if (typeof steward === "string") return steward;
  return steward.type === "user" ? steward.email ?? "" : "";
}

/** Project types whose primary action is synthesis: the agent rolls up child
 * project wikis and enriches them with any directly attached sources. */
export const SYNTHESIZED_PROJECT_TYPES = ["bhag", "area"] as const;

/** True if `type` is a synthesized roll-up project kind. */
export function isSynthesizedType(type: ProjectType | undefined): boolean {
  return type === "bhag" || type === "area";
}

/**
 * Label dimensions for discovery + the executive dashboard. Free-form,
 * multi-value (except domain). `domain` is denormalized from the structural
 * domain (mirrors the top-level `domain` field) so the dashboard can facet by it.
 */
export interface ProjectLabels {
  domain?: string;
  initiatives?: string[]; // BHAG / Initiative
  areas?: string[]; // Area
}

/**
 * One Confluence space attached to a project. Shape mirrors what the tome
 * agent's snapshot expects so the wire mapping is trivial.
 */
export interface ConfluenceSpaceSource {
  slug: string;
  name: string;
  space_key: string;
  base_url?: string;
  page_scopes?: ConfluencePageScope[];
  /** @deprecated Singular compatibility field; prefer page_scopes. */
  page_scope?: ConfluencePageScope;
}

/**
 * Optional page-tree scope within an attached Confluence space. The space
 * remains the authorization boundary; this narrows what the Tome agent reads.
 */
export interface ConfluencePageScope {
  page_id: string;
  page_title: string;
  space_key: string;
  include_descendants: boolean;
}

/**
 * One Webex room attached to a project. Shape mirrors contract.WebexRoomSnapshot.
 */
export interface WebexRoomSource {
  slug: string;
  name: string;
  room_id: string;
}

/**
 * One attached GitHub repository. `id` is the durable identity returned by
 * GitHub; names, URLs, and the default branch are canonical metadata refreshed
 * before every Tome ingest because all three can change over the repository's
 * lifetime.
 */
export interface GitHubRepositorySource {
  id?: number;
  node_id?: string;
  full_name: string;
  html_url: string;
  default_branch?: string;
}

/**
 * User-supplied data sources for a project (collected at onboarding and
 * editable later). Forwarded to connected external apps so they can
 * ingest the repo/space/components.
 */
export interface ProjectSources {
  /** @deprecated Compatibility mirror of `github_repos[].html_url`. */
  repos?: string[]; // GitHub repo URLs / owner/name
  /** GitHub repositories with stable identities and canonical metadata. */
  github_repos?: GitHubRepositorySource[];
  confluence_url?: string; // Confluence space or page URL (legacy free-form)
  /** Selected page roots within the attached Confluence space. */
  confluence_page_scopes?: ConfluencePageScope[];
  /** @deprecated Singular compatibility field; prefer confluence_page_scopes. */
  confluence_page_scope?: ConfluencePageScope;
  confluence_spaces?: ConfluenceSpaceSource[]; // typed Confluence spaces
  webex_rooms?: WebexRoomSource[]; // typed Webex rooms (slug+name+room_id)
  component_urls?: string[]; // arbitrary software/service URLs
}

export interface ProjectDocument {
  _id?: string;
  /** Project kind. Absent on legacy docs — treat absent as "project". */
  type?: ProjectType;
  slug: string;
  /** @deprecated Legacy field; use `title` for display and `slug` for identity. */
  name?: string;
  title: string;
  description: string;
  team_id: string;
  team_slug: string;
  team_name: string;
  owner_id: string;
  member_ids: string[];
  domain: string;
  labels?: ProjectLabels;
  tags: string[];
  status: ProjectLifecycleStatus;
  catalog: BackstageProjectCatalog;
  components: BackstageComponentCatalog[];
  onboarding: Record<string, OnboardingStepState>;
  integrations: Record<string, string>;
  sources?: ProjectSources;
  source?: ProjectSource;
  backstage_entity_ref?: string;
  /**
   * True while an ingest run is in flight. The wiki is read-only to humans
   * during this window (page-write endpoints 409; the editor disables save) so
   * UI edits can't race the agent's rewrite. Set by the ingest runner.
   */
  locked?: boolean;
  /**
   * Newest source-activity event time seen by the feed poller. Feeds the
   * freshness/staleness signal alongside `last_ingested_at`.
   */
  last_source_event_at?: Date;
  /**
   * Scoped Tome data steward. The corresponding OpenFGA writer tuple is the
   * authorization source of truth. Legacy records may still contain an email
   * string and are reconciled to a user writer tuple on first access.
   */
  data_steward?: StoredDataSteward;
  /** Governance signal: how reversible this project's decisions are. */
  decision_blast_radius?: "small" | "large";
  /** External validation paths this project is pursuing. */
  optionality?: string[];
  /** Per-project on/off for the source-activity feed. Undefined = on. */
  sources_feed_enabled?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectRequest {
  name: string;
  /** Defaults to "project". Pass "bhag" for a strategic-goal entity or "area" for a mid-tier grouping. */
  type?: ProjectType;
  description?: string;
  team_id: string;
  member_ids?: string[];
  domain?: string;
  initiatives?: string[];
  areas?: string[];
  tags?: string[];
  manager?: string;
  // Data sources the user shares at onboarding (forwarded to connected external apps).
  github_repos?: string[];
  confluence_url?: string;
  confluence_page_scopes?: ConfluencePageScope[];
  confluence_page_scope?: ConfluencePageScope;
  webex_rooms?: WebexRoomSource[];
  component_urls?: string[];
  /** User or team that can write Tome content and operate ingestion/review. */
  data_steward?: DataStewardInput;
  decision_blast_radius?: "small" | "large";
  optionality?: string[];
}

export interface OnboardProjectRequest {
  project_id: string;
  steps?: string[];
}
