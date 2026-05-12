# Data Model: Enterprise Identity Group Sync and Universal ReBAC

## Overview

This feature separates four kinds of state:

- **Identity input**: upstream provider groups, user identities, and group claims.
- **Administrative intent**: sync rules, manual team membership, policy ownership, and staged policy changes.
- **Authorization facts**: active ReBAC relationships used for allow/deny checks.
- **Audit and explainability**: sync runs, relationship source records, drift findings, access-check explanations, and enforcement status.

MongoDB stores identity sync intent, provenance, status, and UI-friendly records. OpenFGA stores active relationship facts. Keycloak stores user identity, token issuance state, and limited bootstrap/transitional roles.

## Entities

### IdentityProvider

Represents an upstream group source.

**Fields**

- `id`: stable provider identifier, such as `okta-primary`, `ad-corporate`, or `oidc-claims`.
- `type`: `okta`, `active_directory`, or `oidc_claims`.
- `display_name`: administrator-facing label.
- `status`: `not_configured`, `configured`, `healthy`, `degraded`, or `disabled`.
- `last_checked_at`: latest provider health check time.
- `capabilities`: supported operations such as group listing, group member listing, delta sync, and immutable group IDs.

**Relationships**

- Has many `ExternalGroup`.
- Has many `IdentityGroupSyncRule`.
- Has many `IdentityGroupSyncRun`.

**Validation**

- Provider identifiers are unique.
- Disabled providers cannot run scheduled sync.
- Secrets and credentials are never stored in this entity as source-controlled values.

### IdentityGroupSyncRule

Defines how upstream groups become CAIPE teams and membership relationships.

**Fields**

- `id`: stable rule identifier.
- `provider_id`: target provider.
- `name`: administrator-facing rule name.
- `priority`: integer ordering, lower values evaluated first.
- `enabled`: whether the rule can affect applied sync.
- `review_status`: `draft`, `dry_run_required`, `reviewed`, `enabled`, or `disabled`.
- `include_patterns`: ordered group matching patterns.
- `exclude_patterns`: patterns that prevent a group from matching.
- `team_name_template`: template for generated team display name.
- `team_slug_template`: template for generated team slug.
- `role_map`: mapping from captured upstream role labels to CAIPE relationships such as `member` and `admin`.
- `auto_create_team`: whether approved matches can create teams.
- `default_relationship_policy_ids`: optional approved policies that can create baseline relationships for newly created teams.
- `created_by`, `created_at`, `updated_by`, `updated_at`.

**Relationships**

- Belongs to `IdentityProvider`.
- Produces `ExternalGroupTeamLink`.
- Produces `TeamMembershipSource`.
- Referenced by `IdentityGroupSyncRun`.

**Validation**

- Rule IDs are unique.
- Priorities are deterministic within a provider.
- Include patterns must contain enough captured data to derive team slug and role.
- Rules that create teams or memberships require dry-run review before enablement.
- A rule cannot directly grant application resources unless it references an approved default relationship policy.

### ExternalGroup

Represents a group discovered from an upstream provider.

**Fields**

- `provider_id`: source provider.
- `external_group_id`: immutable upstream group identifier when available.
- `display_name`: current upstream display name.
- `normalized_name`: normalized value used for matching and search.
- `status`: `active`, `inactive`, `deleted`, `renamed`, `unreadable`, or `unknown`.
- `member_count`: latest known member count.
- `last_seen_at`: latest discovery time.
- `metadata`: non-secret provider attributes useful for audit and display.

**Relationships**

- Belongs to `IdentityProvider`.
- May link to one or more `Team` records through `ExternalGroupTeamLink`.
- May produce many `TeamMembershipSource` records.

**Validation**

- Prefer immutable group ID for identity. Display name is mutable and cannot be the only key if an immutable ID exists.
- Deleted or unreadable groups cannot create new memberships.

### ExternalGroupTeamLink

Records how an external group maps to a CAIPE team.

**Fields**

- `provider_id`.
- `external_group_id`.
- `sync_rule_id`.
- `team_id`.
- `team_slug`.
- `relationship_role`: `member` or `admin`.
- `status`: `active`, `stale`, `conflicted`, `disabled`, or `pending_review`.
- `first_seen_at`, `last_seen_at`, `last_applied_at`.
- `conflict_reason`: optional explanation.

**Relationships**

- Belongs to `ExternalGroup`.
- Belongs to `Team`.
- Belongs to `IdentityGroupSyncRule`.

**Validation**

- One active link for a provider/group/rule/role target.
- Conflicting generated team slugs must not auto-merge without review.

### Team

Local collaboration and authorization grouping.

**Fields**

- `id`.
- `slug`: stable resource identifier.
- `name`: display name.
- `description`.
- `source`: `manual`, `identity_sync`, `bootstrap`, or `migration`.
- `status`: `active`, `archived`, `pending_review`, or `disabled`.
- `owner_id`.
- `created_by`, `created_at`, `updated_by`, `updated_at`.

**Relationships**

- Has many `TeamMembershipSource`.
- Has many ReBAC relationships to resources.
- May have many `ExternalGroupTeamLink`.
- May administer scoped resources.

**Validation**

- Slugs are unique and deterministic.
- Team archive disables new grants but does not silently delete audit history.
- Team creation from group sync requires approved mapping and no unresolved slug collision.

### TeamMembershipSource

Explains why a user has a team relationship.

**Fields**

- `team_id`, `team_slug`.
- `user_subject`: Keycloak subject when known.
- `user_email`: email or username used for resolution.
- `relationship`: `member` or `admin`.
- `source_type`: `manual`, `okta`, `active_directory`, `oidc_claim`, `bootstrap`, `migration`, or `policy_rule`.
- `provider_id`: optional upstream provider.
- `external_group_id`: optional upstream group identifier.
- `sync_rule_id`: optional mapping rule.
- `managed`: whether automated sync can remove this source.
- `status`: `active`, `stale`, `pending_identity_link`, `disabled_user`, `removed`, or `error`.
- `first_seen_at`, `last_seen_at`, `last_applied_at`.
- `created_by`, `created_at`, `removed_by`, `removed_at`.

**Relationships**

- Belongs to `Team`.
- May belong to `ExternalGroupTeamLink`.
- Materializes a ReBAC relationship from `user:<subject>` to `team:<slug>`.

**Validation**

- Multiple active sources can grant the same relationship.
- Removing one managed source does not revoke access while another active source remains.
- Sources without a resolved subject cannot create active ReBAC tuples.

### ReBACResource

Canonical representation of a protected resource.

**Fields**

- `resource_type`: organization, user, external group, team, Slack workspace, Slack channel, agent, MCP server, tool, knowledge base, document, skill, task, conversation, admin surface, policy, audit view, secret reference, or system configuration.
- `resource_id`.
- `display_name`.
- `status`: `active`, `disabled`, `archived`, `deleted`, or `unknown`.
- `owner_subjects`: subjects that own or administer the resource.
- `enforcement_status`: `not_gated`, `role_gated`, `rebac_shadowed`, `rebac_enforced`, or `deprecated`.
- `metadata`: non-secret display/search attributes.

**Relationships**

- Target of `ReBACRelationship`.
- Appears in graph and access checker results.

**Validation**

- Resource identifiers are unique by type and ID.
- Deleted resources cannot receive new grants.
- Public or anonymous access must be explicitly represented.

### ReBACRelationship

An active or staged authorization fact.

**Fields**

- `subject`: user, team members, team admins, external group, service account, or anonymous subject.
- `action`: discover, read, use, write, create, delete, manage, administer, audit, approve, share, ingest, invoke, or call.
- `resource`: typed resource reference.
- `source_type`: manual, identity_sync, policy_rule, migration, bootstrap, or system.
- `source_id`: optional sync rule, policy, or run reference.
- `status`: `staged`, `active`, `revoked`, `blocked`, or `error`.
- `created_by`, `created_at`, `revoked_by`, `revoked_at`.

**Relationships**

- Materialized in OpenFGA when active.
- Linked to `PolicyChangeSet`, `IdentityGroupSyncRun`, or manual admin action for provenance.

**Validation**

- Action must be supported by the resource type.
- Subject type must be valid for the relationship.
- Privilege escalation checks must pass before save.

### PolicyRule

Reusable administrative rule that generates or validates relationships.

**Fields**

- `id`, `name`, `description`.
- `scope`: global, team-scoped, provider-scoped, channel-scoped, or resource-scoped.
- `rule_type`: default team baseline, Slack channel grant, admin delegation, resource template, migration, or validation-only.
- `status`: draft, dry-run, active, disabled, or archived.
- `generated_relationships`: expected relationship templates.
- `approval_required`: whether changes need approval.
- `created_by`, `created_at`, `updated_by`, `updated_at`.

**Relationships**

- May be referenced by `IdentityGroupSyncRule`.
- Generates `PolicyChangeSet`.
- Produces `ReBACRelationship` records.

**Validation**

- Rules that grant resources require explicit review.
- Rules cannot grant permissions outside the author's own delegation scope.

### PolicyChangeSet

Staged relationship changes awaiting save or approval.

**Fields**

- `id`.
- `status`: draft, validating, blocked, pending_approval, approved, applied, failed, or cancelled.
- `grants`: relationships to add.
- `revocations`: relationships to remove.
- `blocked_changes`: invalid or unauthorized changes.
- `impact_summary`.
- `created_by`, `created_at`, `approved_by`, `applied_by`, `applied_at`.

**Relationships**

- Contains many `ReBACRelationship` candidates.
- Produces audit events and OpenFGA tuple writes/deletes when applied.

**Validation**

- Must pass relationship validation before apply.
- Must not remove the last administrator for critical resources unless override is approved.

### SlackChannelGrant

Channel-scoped access to agents, tools, and knowledge bases.

**Fields**

- `slack_workspace_id`.
- `slack_channel_id`.
- `resource_type`: agent, tool, or knowledge base.
- `resource_id`.
- `relationship`: allowed agent, allowed tool, allowed knowledge base, read, use, ingest, or manage.
- `source_type`: manual, policy_rule, migration, or identity_sync.
- `status`: active, disabled, revoked, or error.

**Relationships**

- Belongs to `SlackChannel`.
- Links to resource-specific ReBAC relationships.

**Validation**

- A channel can have multiple grants.
- A user must still satisfy channel access and selected resource access at invocation time.

### IdentityGroupSyncRun

Dry-run or applied reconciliation execution.

**Fields**

- `id`.
- `mode`: dry_run, scheduled, manual_apply, or login_time_refresh.
- `provider_id`.
- `rule_ids`.
- `status`: running, completed, completed_with_warnings, failed, cancelled.
- `started_by`, `started_at`, `completed_at`.
- `matched_groups`, `ignored_groups`, `created_teams`, `linked_teams`, `membership_adds`, `membership_removes`, `skipped_users`, `conflicts`, `warnings`, `errors`.
- `relationship_grants`, `relationship_revocations`.

**Relationships**

- References rules, external groups, team links, membership sources, and relationship changes.

**Validation**

- Dry runs do not mutate state.
- Applied runs record enough detail to reconstruct changes.

### DriftFinding

Mismatch between expected and actual authorization state.

**Fields**

- `id`.
- `finding_type`: missing_team, missing_membership, stale_membership, role_mismatch, tuple_mismatch, disabled_user_active_access, deleted_resource_active_grant, or policy_conflict.
- `severity`: info, warning, high, critical.
- `status`: open, acknowledged, remediated, ignored.
- `subject`, `resource`, `source`.
- `detected_at`, `resolved_at`.
- `recommended_action`.

**Relationships**

- May reference sync rules, teams, external groups, Keycloak roles, and ReBAC relationships.

## State Transitions

### IdentityGroupSyncRule

```text
draft -> dry_run_required -> reviewed -> enabled -> disabled
draft -> disabled
enabled -> disabled
enabled -> dry_run_required   # after material rule edits
```

### TeamMembershipSource

```text
pending_identity_link -> active -> stale -> removed
active -> disabled_user -> active
active -> error -> active
```

### PolicyChangeSet

```text
draft -> validating -> pending_approval -> approved -> applied
draft -> validating -> blocked
pending_approval -> cancelled
approved -> failed
failed -> validating
```

### ReBACResource Enforcement

```text
not_gated -> role_gated -> rebac_shadowed -> rebac_enforced
rebac_enforced -> deprecated
```

## Index and Query Considerations

- Sync rule lookup by provider, status, and priority.
- External group lookup by provider and immutable external group ID.
- Team slug uniqueness.
- Membership source lookup by team, user subject, source type, and status.
- Sync run history by provider, mode, status, and started time.
- Relationship provenance lookup by subject, resource, source type, and status.
- Slack channel grant lookup by workspace, channel, resource type, and status.
- Drift finding lookup by status, severity, finding type, and detected time.
