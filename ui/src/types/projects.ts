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
  source?: ProjectSource;
  backstage_entity_ref?: string;
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
}

export interface OnboardProjectRequest {
  project_id: string;
  steps?: string[];
}
