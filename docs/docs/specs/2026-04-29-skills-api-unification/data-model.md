# Data Model: Unified Skills API & Template Import

**Spec**: [spec.md](./spec.md)

## 1. Persisted skill config (`agent_skills`)

MongoDB documents follow the existing **`AgentSkill`** TypeScript shape (`ui/src/types/agent-skill.ts`).

**Collection migration**: This feature does **not** rename or bulk-migrate the collection. See [mongodb-migration.md](./mongodb-migration.md).

### Core fields

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Unique; user skills often UUID; system template imports: `skill-{slug}-{6hex}` |
| `name` | string | Display name |
| `description` | string? | |
| `category` | string | |
| `tasks` | AgentSkillTask[] | Workflow steps |
| `owner_id` | string | Email or `'system'` for system rows |
| `is_system` | boolean | `true` for packaged/imported system skills |
| `created_at`, `updated_at` | Date | |
| `metadata` | object? | See below |
| `skill_content` | string? | SKILL.md body for builder |
| `visibility` | private \| team \| global | User skills; system imports typically global |
| `shared_with_teams` | string[]? | When visibility is team |
| `scan_status` | passed \| flagged \| unscanned | |
| `ancillary_files` | Record\<string, string\>? | Path → content |

### Metadata extensions (template import)

| Field | Type | Notes |
|-------|------|--------|
| `metadata.template_source_id` | string | Stable id from packaged template (folder id / chart key); **dedupe key** with `is_system` |
| `metadata.import_kind` | string | e.g. `helm_template_v1` |

Existing `AgentSkillMetadata` fields (`tags`, `schema_version`, etc.) remain optional.

### Validation rules (from spec + existing API)

- Template import rows: **`is_system: true`**, **`owner_id: 'system'`**, **`metadata.template_source_id`** required for dedupe.
- Dedupe query: find existing with same `template_source_id` and `is_system` → skip insert (FR-006).
- User-created skills: must not be overwritten by template import keyed only on id prefix (edge case in spec).

## 2. Catalog skill entry (not a separate collection)

Returned by **merged catalog** (`GET /api/skills` and supervisor merge): name, description, source discriminator (`filesystem` \| `agent_skills` \| hubs / product-specific), optional body, ids as today. No schema change required for **source** strings per spec out-of-scope.

## 3. Packaged template (filesystem)

Chart directory: `charts/.../data/skills/<template-id>/SKILL.md` + `metadata.json`. Loaded by existing template loader for import UI and optional seed.

## 4. State transitions

- **Import**: Packaged template → (POST import) → Mongo `agent_skills` row if not deduped.
- **CRUD**: Standard create/update/delete via configs API; supervisor refresh triggered on write (existing).

## 5. Scan job (planned; FR-011, FR-012)

Async **hub** or **catalog** scan runs (distinct from synchronous per-save scan in 097). Intended storage (align with 097 `skill_scan_findings` and supervisor):

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Job id (opaque). |
| `status` | queued \| running \| succeeded \| failed \| cancelled | |
| `kind` | hub \| catalog | What was scanned. |
| `hub_id` | string? | When `kind` is hub. |
| `started_at`, `finished_at` | Date? | |
| `error` | string? | Failure message. |
| `summary` | object? | Counts by severity, optional link to findings query. |

## 6. Quarantine policy (planned; FR-013–FR-016)

Policy for whether **flagged** skills appear in merged catalog / supervisor (strict gate vs visibility). Cross-reference: 097 **FR-027** (`scan_status`, `SKILL_SCANNER_GATE=strict`, catalog exclusion). Planned document shape (Mongo or config):

| Field | Type | Notes |
|-------|------|--------|
| `exclude_flagged_from_catalog` | boolean | When true, `scan_status: flagged` rows omitted from merged catalog (default strict). |
| `allow_list_skill_ids` | string[]? | Optional override so specific skills remain visible while flagged. |
| `updated_at` | Date | |
| `updated_by` | string? | Actor id or email. |

**Findings**: Persisted in **`skill_scan_findings`** per [097 data-model](../097-skills-middleware-integration/data-model.md) § Skill scan finding.
