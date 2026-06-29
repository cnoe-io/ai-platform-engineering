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
 * Label dimensions for discovery + the executive dashboard. Free-form,
 * multi-value (except domain). `domain` is denormalized from the structural
 * domain (mirrors the top-level `domain` field) so the dashboard can facet by it.
 */
export interface ProjectLabels {
  domain?: string;
  initiatives?: string[]; // BHAG / Initiative
  swimlanes?: string[]; // Swim Lane
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
 * User-supplied data sources for a project (collected at onboarding and
 * editable later). Forwarded to connected external apps so they can
 * ingest the repo/space/components.
 */
export interface ProjectSources {
  repos?: string[]; // GitHub repo URLs / owner/name
  confluence_url?: string; // Confluence space URL (legacy free-form)
  confluence_spaces?: ConfluenceSpaceSource[]; // typed Confluence spaces
  webex_rooms?: WebexRoomSource[]; // typed Webex rooms (slug+name+room_id)
  component_urls?: string[]; // arbitrary software/service URLs
}

export interface ProjectDocument {
  _id?: string;
  slug: string;
  name: string;
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
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  team_id: string;
  member_ids?: string[];
  domain?: string;
  initiatives?: string[];
  swimlanes?: string[];
  tags?: string[];
  manager?: string;
  // Data sources the user shares at onboarding (forwarded to connected external apps).
  github_repos?: string[];
  confluence_url?: string;
  webex_rooms?: WebexRoomSource[];
  component_urls?: string[];
}

export interface OnboardProjectRequest {
  project_id: string;
  steps?: string[];
}
