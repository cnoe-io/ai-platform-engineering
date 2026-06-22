# MongoDB Migration: Enterprise Identity Group Sync and Universal ReBAC

## Required or No-Op

Database changes are required. This feature introduces new MongoDB collections and indexes for identity group sync, relationship provenance, policy change sets, Slack channel multi-resource grants, enforcement status, and drift findings.

No destructive migration is planned. Collections can be created lazily by the application, but production rollout should create indexes before enabling scheduled sync.

## New Collections

### `identity_providers`

Stores non-secret provider metadata and health state.

**Indexes**

- Unique: `{ id: 1 }`
- Query: `{ type: 1, status: 1 }`

### `identity_group_sync_rules`

Stores ordered regex mapping clusters.

**Indexes**

- Unique: `{ id: 1 }`
- Query: `{ provider_id: 1, enabled: 1, priority: 1 }`
- Query: `{ provider_id: 1, review_status: 1 }`

### `external_groups`

Stores discovered upstream group metadata.

**Indexes**

- Unique: `{ provider_id: 1, external_group_id: 1 }`
- Query: `{ provider_id: 1, normalized_name: 1 }`
- Query: `{ provider_id: 1, status: 1, last_seen_at: -1 }`

### `external_group_team_links`

Links external groups to CAIPE teams.

**Indexes**

- Unique: `{ provider_id: 1, external_group_id: 1, sync_rule_id: 1, relationship_role: 1 }`
- Query: `{ team_id: 1, status: 1 }`
- Query: `{ sync_rule_id: 1, status: 1 }`

### `team_membership_sources`

Tracks why a user has a team relationship.

**Indexes**

- Query: `{ team_id: 1, user_subject: 1, relationship: 1, status: 1 }`
- Query: `{ source_type: 1, provider_id: 1, external_group_id: 1, status: 1 }`
- Query: `{ sync_rule_id: 1, status: 1, last_seen_at: -1 }`
- Query: `{ user_subject: 1, status: 1 }`

### `rebac_resources`

Stores canonical resource metadata for graph and authoring views.

**Indexes**

- Unique: `{ resource_type: 1, resource_id: 1 }`
- Query: `{ resource_type: 1, status: 1 }`
- Query: `{ enforcement_status: 1, resource_type: 1 }`

### `rebac_relationship_sources`

Stores relationship provenance and status for tuples written to OpenFGA.

**Indexes**

- Query: `{ "resource.type": 1, "resource.id": 1, status: 1 }`
- Query: `{ "subject.type": 1, "subject.id": 1, status: 1 }`
- Query: `{ source_type: 1, source_id: 1, status: 1 }`
- Query: `{ status: 1, created_at: -1 }`

### `policy_rules`

Stores reusable relationship-generation rules.

**Indexes**

- Unique: `{ id: 1 }`
- Query: `{ scope: 1, status: 1 }`
- Query: `{ rule_type: 1, status: 1 }`

### `policy_change_sets`

Stores staged relationship grants/revocations and validation state.

**Indexes**

- Unique: `{ id: 1 }`
- Query: `{ status: 1, created_at: -1 }`
- Query: `{ created_by: 1, status: 1 }`

### `slack_channel_grants`

Stores Slack channel to resource grants for authoring and provenance.

**Indexes**

- Unique: `{ slack_workspace_id: 1, slack_channel_id: 1, resource_type: 1, resource_id: 1, relationship: 1 }`
- Query: `{ slack_workspace_id: 1, slack_channel_id: 1, status: 1 }`
- Query: `{ resource_type: 1, resource_id: 1, status: 1 }`

### `identity_group_sync_runs`

Stores dry-run and applied sync run summaries.

**Indexes**

- Unique: `{ id: 1 }`
- Query: `{ provider_id: 1, mode: 1, status: 1, started_at: -1 }`
- Query: `{ status: 1, started_at: -1 }`

### `rbac_drift_findings`

Stores reconciliation and enforcement drift findings.

**Indexes**

- Query: `{ status: 1, severity: 1, detected_at: -1 }`
- Query: `{ finding_type: 1, status: 1 }`
- Query: `{ "resource.type": 1, "resource.id": 1, status: 1 }`

## Existing Collection Updates

### `teams`

Add optional fields:

- `source`
- `status`
- `owner_id`
- `external_group_links`
- `created_by`
- `updated_by`

**Indexes**

- Ensure unique team slug index exists.
- Add query index `{ status: 1, source: 1 }`.

### Existing Slack channel mapping data

If the current stack stores one agent per channel, backfill equivalent `slack_channel_grants` records:

- Channel to existing agent as `allowed_agent`.
- Preserve original mapping source as `migration`.
- Do not infer tool or knowledge base access.

## Data Movement

### Backfill Team Membership Sources

For existing team membership records:

1. Create `team_membership_sources` records with `source_type: "migration"`.
2. Mark `managed: false`.
3. Write active ReBAC team membership tuples if missing.
4. Record skipped users whose Keycloak subject cannot be resolved.

### Backfill Team Resource Relationships

For existing team resource assignments:

1. Create `rebac_relationship_sources` records with `source_type: "migration"`.
2. Write matching OpenFGA tuples for agents, tools, and knowledge bases.
3. Keep existing Keycloak resource roles until the relevant runtime surface is `rebac_enforced`.

### Backfill Slack Channel Grants

For existing channel-agent mappings:

1. Create `rebac_resources` for Slack workspaces/channels.
2. Create `slack_channel_grants` for the mapped agent.
3. Write OpenFGA channel-resource relationships.
4. Mark enforcement as `rebac_shadowed` until Slack runtime checks are enabled.

## Rollback

Rollback should be non-destructive:

1. Disable scheduled identity group sync.
2. Disable ReBAC-enforced runtime flags and return affected surfaces to `rebac_shadowed` or role-gated mode.
3. Stop writing new tuples from sync runs.
4. Preserve new MongoDB collections for audit unless a backup/restore plan is explicitly approved.
5. If required, delete only tuples whose source is the rolled-back change set or sync run.

## Environments

- **Development**: Collections and indexes can be created on application startup or by a local migration script.
- **Staging**: Create indexes, run migration backfills, verify graph/access checker, then enable scheduled sync in dry-run mode.
- **Production**: Take a MongoDB backup, create indexes, run idempotent backfills in batches, run drift detection, enable dry-run scheduled sync, then promote runtime surfaces to ReBAC enforcement incrementally.

## OpenFGA Migration Dependency

The OpenFGA authorization model must support the target resource types and relations before backfills write new tuple types. Model rollout should precede tuple writers in each environment.

## Keycloak Transition Dependency

Keycloak resource roles remain during migration. New implementation should avoid creating permanent per-resource roles for every resource and should move resource authorization to OpenFGA as surfaces become `rebac_enforced`.
