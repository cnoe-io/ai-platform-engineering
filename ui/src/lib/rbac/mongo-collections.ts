import type { Collection, Document } from "mongodb";

import type { IdentityGroupSyncRule, IdentityProvider, TeamMembershipSource } from "@/types/identity-group-sync";
import type { UniversalRebacRelationship, UniversalRebacResourceRef } from "@/types/rbac-universal";

export const RBAC_COLLECTION_NAMES = {
  identityProviders: "identity_providers",
  identityGroupSyncRules: "identity_group_sync_rules",
  identityGroupSyncRuns: "identity_group_sync_runs",
  externalGroups: "external_groups",
  externalGroupTeamLinks: "external_group_team_links",
  teamMembershipSources: "team_membership_sources",
  rebacResources: "rebac_resources",
  rebacRelationships: "rebac_relationships",
  policyRules: "policy_rules",
  policyChangeSets: "policy_change_sets",
  slackChannelGrants: "slack_channel_grants",
  rebacEnforcementStatus: "rebac_enforcement_status",
  rebacDriftFindings: "rebac_drift_findings",
} as const;

export type RbacCollectionKey = keyof typeof RBAC_COLLECTION_NAMES;
export type RbacCollectionName = (typeof RBAC_COLLECTION_NAMES)[RbacCollectionKey];

export interface ExternalGroupTeamLinkDocument extends Document {
  provider_id: string;
  external_group_id: string;
  sync_rule_id: string;
  team_id: string;
  team_slug: string;
  relationship_role: "member" | "admin";
  status: "active" | "stale" | "conflicted" | "disabled" | "pending_review";
  first_seen_at?: string;
  last_seen_at?: string;
  last_applied_at?: string;
  conflict_reason?: string;
}

export interface RebacResourceDocument extends Document {
  resource_type: UniversalRebacResourceRef["type"];
  resource_id: string;
  display_name: string;
  status: "active" | "disabled" | "archived" | "deleted" | "unknown";
  enforcement_status: "not_gated" | "role_gated" | "rebac_shadowed" | "rebac_enforced" | "deprecated";
  metadata?: Record<string, unknown>;
}

export interface RebacRelationshipDocument extends Document, UniversalRebacRelationship {
  source_type: "manual" | "identity_sync" | "policy_rule" | "migration" | "bootstrap" | "system";
  source_id?: string;
  status: "staged" | "active" | "revoked" | "blocked" | "error";
  created_by?: string;
  created_at: string;
  revoked_by?: string;
  revoked_at?: string;
}

export function getRbacCollectionName(key: RbacCollectionKey): RbacCollectionName {
  return RBAC_COLLECTION_NAMES[key];
}

export function listRbacCollectionNames(): RbacCollectionName[] {
  return Array.from(new Set(Object.values(RBAC_COLLECTION_NAMES)));
}

export async function getRbacCollection<T extends Document = Document>(
  key: RbacCollectionKey
): Promise<Collection<T>> {
  const { getCollection } = await import("@/lib/mongodb");
  return getCollection<T>(getRbacCollectionName(key));
}

export function getIdentityProvidersCollection(): Promise<Collection<IdentityProvider & Document>> {
  return getRbacCollection<IdentityProvider & Document>("identityProviders");
}

export function getIdentityGroupSyncRulesCollection(): Promise<
  Collection<IdentityGroupSyncRule & Document>
> {
  return getRbacCollection<IdentityGroupSyncRule & Document>("identityGroupSyncRules");
}

export function getTeamMembershipSourcesCollection(): Promise<
  Collection<TeamMembershipSource & Document>
> {
  return getRbacCollection<TeamMembershipSource & Document>("teamMembershipSources");
}

export function getRebacRelationshipsCollection(): Promise<Collection<RebacRelationshipDocument>> {
  return getRbacCollection<RebacRelationshipDocument>("rebacRelationships");
}
