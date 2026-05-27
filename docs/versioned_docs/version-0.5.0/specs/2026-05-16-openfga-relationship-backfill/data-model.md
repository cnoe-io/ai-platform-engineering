# Data Model: OpenFGA Relationship Backfill

## Source Entities

### Team

Represents an existing CAIPE team whose persisted memberships and resource assignments are backfilled into authorization relationships.

Key fields:

- `slug`: Stable team identifier used as the OpenFGA team object id.
- `status`: Team lifecycle state. Active or missing status is eligible; archived, disabled, or invalid states are skipped.
- `members`: User email and role assignments from manual team management.
- `resources.agents`: Dynamic agents the team can use.
- `resources.agent_admins`: Dynamic agents the team can manage.
- `resources.tools`: Tool prefixes the team can call.
- `resources.knowledge_bases`: Knowledge bases the team can read or use.
- `resources.skills`: Skills the team can use.
- `resources.tasks`: Tasks the team can use.

Validation rules:

- Team slug must be present and OpenFGA-safe.
- Resource ids must be non-empty and OpenFGA-safe.
- Member email-only rows must be mapped to stable user subjects before a user membership tuple is written.

### Platform Config

Represents platform-wide runtime settings used to resolve the default dynamic agent.

Key fields:

- `_id`: Expected platform settings document id.
- `default_agent_id`: Persisted admin-selected dynamic agent id.

Resolution rules:

1. Use persisted `default_agent_id` when present.
2. Otherwise use deployment `DEFAULT_AGENT_ID` when present.
3. Otherwise supervisor fallback means no default dynamic-agent tuple is written.

### Dynamic Agent

Represents a runnable dynamic agent target for team and default-agent grants.

Key fields:

- `id` or `_id`: Agent identifier used as `agent:<id>`.
- `status` or availability signal: Used to avoid granting a deleted or unavailable default agent.

Validation rules:

- Default dynamic agent id must resolve to an available dynamic agent before the universal default-agent grant is written.
- Team-scoped agent ids are validated syntactically; missing targets are reported as skipped or warning counts depending on available lookup data.

## Derived Relationship Entities

### OpenFGA Tuple

Represents a production authorization relationship written to the OpenFGA tuple store.

Fields:

- `user`: Subject, such as `user:<subject>`, `team:<slug>#member`, or `user:*`.
- `relation`: Authorization relation, such as `member`, `admin`, `can_use`, `can_manage`, `can_call`, or `can_read`.
- `object`: Resource object, such as `team:<slug>`, `agent:<id>`, `tool:<prefix>`, `knowledge_base:<id>`, `skill:<id>`, or `task:<id>`.
- `source`: Internal derivation source used for reporting and provenance.

Derived tuple types:

- `user:<subject> member team:<slug>`
- `user:<subject> admin team:<slug>`
- `team:<slug>#member can_use agent:<id>`
- `team:<slug>#member can_manage agent:<id>`
- `team:<slug>#member can_call tool:<prefix>`
- `team:<slug>#member can_read knowledge_base:<id>`
- `team:<slug>#member can_use skill:<id>`
- `team:<slug>#member can_use task:<id>`
- `user:* can_use agent:<default-agent-id>`

### ReBAC Relationship Provenance

Represents the MongoDB audit/provenance record corresponding to a migrated resource relationship.

Fields:

- `subject.type`: `team`, `user`, or wildcard/global user subject depending on relationship type.
- `subject.id`: Stable subject identifier.
- `subject.relation`: Optional relation such as `member`.
- `action`: Logical action such as `use`, `manage`, `call`, or `read`.
- `resource.type`: Resource type such as `agent`, `tool`, `knowledge_base`, `skill`, or `task`.
- `resource.id`: Resource identifier.
- `source_type`: `migration`.
- `source_id`: Stable migration id.
- `status`: `active`, `error`, or other existing allowed status.
- `created_at`, `updated_at`: Migration timestamps.

Validation rules:

- Upsert key is deterministic from subject, action, and resource.
- Existing non-migration relationships are not downgraded or removed.

### Team Membership Source

Represents a MongoDB provenance record for migrated team membership.

Fields:

- `team_id`
- `team_slug`
- `user_subject`
- `user_email`
- `relationship`: `member` or `admin`
- `source_type`: `migration`
- `source_id`
- `status`: `active`
- `first_seen_at`, `last_seen_at`, `updated_at`

Validation rules:

- Membership sources require a stable `user_subject` for OpenFGA tuple creation.
- Email-only records that cannot be mapped to stable subjects are reported and skipped for tuple writing.

## Migration Control Entities

### Migration Record

Represents first-time backfill status in MongoDB.

Suggested fields:

- `_id`: Stable migration id such as `openfga_relationship_backfill_v1`.
- `status`: `dry_run`, `running`, `completed`, or `failed`.
- `started_at`, `completed_at`, `updated_at`
- `apply`: Boolean indicating whether the run wrote data.
- `forced`: Boolean indicating whether repeat protection was overridden.
- `counts`: Planned, written, skipped, duplicate, unmapped, and failed counts.
- `default_agent`: Resolved id, source, status, and whether wildcard grant was written or skipped.
- `errors`: Bounded list of actionable failure summaries.

State transitions:

- `none -> dry_run`: Preview completed without writes.
- `none -> running -> completed`: Apply completed and wrote required state.
- `none -> running -> failed`: Apply failed and must not be treated as completed.
- `completed -> skipped`: Subsequent non-forced apply exits without writes.
- `completed -> running -> completed`: Forced reconciliation re-checks state.

## Reporting Model

The migration output must include:

- Source teams scanned.
- Membership tuples planned/written/skipped.
- Resource tuples planned/written/skipped.
- Default-agent wildcard tuple planned/written/skipped.
- Provenance records upserted.
- Migration record status.
- Unmapped users and invalid identifiers.
- OpenFGA write or model validation failures.
