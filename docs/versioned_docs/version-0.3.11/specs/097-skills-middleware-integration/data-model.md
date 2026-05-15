# Data Model: Integrated Skills — Single Source, Chat Commands, Skill Hubs

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-27 (Skill Scanner attribution, FR-023)

## Purpose

Define the entities and storage shape for the shared skill catalog, skill hubs, and chat command behavior so that the UI and the platform assistant consume the same data.

---

## Entities

### 1. Skill (catalog entry)

A single capability offered to the assistant and listed in the UI. May come from the default catalog (MongoDB or filesystem), from `agent_skills` (projected), or from a registered hub.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Stable identifier; unique within the merged catalog after precedence rules (e.g. `default-skill-id`, `hub-name/skill-id`). |
| `name` | string | Yes | Display name (from frontmatter `name`; agentskills.io or OpenClaw-style). |
| `description` | string | Yes | Short description for listing and assistant context (max length TBD; agentskills.io ≤1024; OpenClaw 1–2 sentences). |
| `source` | enum | Yes | `"default"` \| `"agent_skills"` \| `"hub"` — origin for precedence and debugging. |
| `source_id` | string | No | Opaque source identifier (e.g. hub id, agent_skills document id). |
| `content` | string | No | Full skill content (e.g. SKILL.md body) when needed for execution. |
| `metadata` | object | No | Optional (category, icon, tags, compatibility, etc.). |
| `visibility` | enum | Yes | `global` \| `team` \| `personal` (FR-020). Default for platform/hub skills: typically `global` unless overridden at ingest or admin policy. |
| `team_ids` | string[] | No | Required when `visibility=team`; empty otherwise. |
| `owner_user_id` | string | No | Required when `visibility=personal` (subject from IdP); null for global/team. |
| `created_at` | datetime | No | When the skill was first seen in the catalog. |
| `updated_at` | datetime | No | Last time the skill was refreshed from source. |
| `ancillary_files` | dict[str, str] | No | Ancillary files (scripts, references, assets) keyed by relative path (FR-028). Hub skills: populated from full directory tree fetch. Agent-skills (`source: agent_skills`): populated via file upload or GitHub import (fetch-and-snapshot). 5 MB soft limit for agent-skills documents; no limit for hubs. |

**Validation**: `id` and `name` non-empty; `description` non-empty; `source` one of the enum values; `visibility` valid; if `team`, `team_ids` non-empty; if `personal`, `owner_user_id` set. When loading from hubs, accept both **Anthropic/agentskills.io** and **OpenClaw-style** SKILL.md (YAML frontmatter + markdown body); normalize to this entity shape (FR-011).

**Precedence**: When the same `id` appears from multiple sources, apply: default &gt; agent_skills &gt; hub; among hubs, earlier registration wins (or explicit priority if added later). **Visibility** is resolved per source rule (e.g. hub default global unless manifest maps paths to team).

**Entitlement filter** (not stored on document; applied at read time): Caller sees skill iff `visibility=global` OR (`visibility=team` AND intersection(team_ids, caller_teams)) OR (`visibility=personal` AND owner_user_id=caller_sub).

---

### 2. Skill catalog (logical)

The **merged** list of all skills from default store + agent_skills projection + all enabled hubs. Not a single collection; produced by the skills middleware (and optionally cached). Default store may be:

- A MongoDB collection (e.g. `skills`) for admin-curated skills, and/or
- Filesystem/ConfigMap (existing `SKILLS_DIR` / chart `data/skills`) for built-in SKILL.md templates.

The middleware merges these with hub-sourced skills and applies precedence to produce one list.

---

### 3. Skill hub (external source)

A registered external source of skills (e.g. a GitHub repository).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique hub identifier (e.g. UUID or `github:owner/repo`). |
| `type` | string | Yes | Hub type: `"github"` (first supported). |
| `location` | string | Yes | Repository identifier (e.g. `owner/repo`) or URL. |
| `enabled` | boolean | Yes | If false, hub is not fetched; skills are excluded from catalog. |
| `last_success_at` | datetime | No | Last successful fetch/refresh. |
| `last_failure_at` | datetime | No | Last failed fetch (if any). |
| `last_failure_message` | string | No | Short error message for admin. |
| `credentials_ref` | string | No | Reference to credentials (e.g. env var name or secret key); no raw secrets stored. |
| `created_at` | datetime | No | When the hub was registered. |
| `updated_at` | datetime | No | Last config update. |
| `created_by` | string | No | User or system that registered the hub (for audit). |

**Validation**: `id` unique; `type` allowlisted (`github`); `location` non-empty; only authorized users can create/update/delete (FR-009).

**Storage**: MongoDB collection `skill_hubs` (or equivalent); access controlled by backend and admin API.

---

### 4. StateBackend skill representation (upstream `SkillsMiddleware`)

The custom catalog layer writes normalized skills into the `StateBackend` as SKILL.md files so the upstream `deepagents.middleware.skills.SkillsMiddleware` can discover and parse them (FR-015). Not a stored MongoDB entity; this is an in-memory/ephemeral representation used within the supervisor's agent session.

**Directory structure in StateBackend**:

```text
/skills/
├── default/                      # Skills from default catalog (filesystem + MongoDB skills)
│   ├── <skill-name>/
│   │   └── SKILL.md              # YAML frontmatter + markdown body
│   └── ...
├── agent-skills/                 # Skills projected from agent_skills
│   ├── <skill-name>/
│   │   ├── SKILL.md
│   │   ├── scripts/              # Ancillary files (FR-028)
│   │   │   └── *.sh / *.py / ...
│   │   ├── references/
│   │   └── assets/
│   └── ...
└── hub-<hub-id>/                 # Skills from each enabled hub
    ├── <skill-name>/
    │   ├── SKILL.md
    │   ├── scripts/              # Ancillary files fetched from repo tree
    │   ├── references/
    │   └── assets/
    └── ...
```

**SKILL.md format** (written by `write_skills_to_backend()`):

```yaml
---
name: <skill-name>
description: <skill description>
license: <optional>
compatibility: <optional>
metadata:
  source: default | agent_skills | hub
  source_id: <optional>
---

<full skill content / instructions>
```

**Upstream `SkillMetadata`** (parsed by `SkillsMiddleware` from the SKILL.md frontmatter):

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Skill identifier (max 64 chars, lowercase alphanumeric + hyphens). |
| `description` | string | What the skill does (max 1024 chars). |
| `path` | string | Backend path to the SKILL.md file. |
| `license` | string or null | License name or reference. |
| `compatibility` | string or null | Environment requirements. |
| `metadata` | dict[str, str] | Arbitrary key-value pairs (used for `source`, `source_id`). |
| `allowed_tools` | list[str] | Tool names the skill recommends (experimental). |

**Precedence**: The catalog layer applies precedence (default > agent_skills > hub) *before* writing to the `StateBackend`. The upstream middleware uses "last wins by name" within its source list, but since the catalog layer has already resolved conflicts, each source path in the backend contains only non-conflicting skills.

---

### 5. Catalog API key (stored)

Machine credential for Try skills gateway (FR-018).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key_id` | string | Yes | Public id (e.g. prefix for `sk_live_xxx`); unique. |
| `key_hash` | string | Yes | Slow hash of secret (never store plaintext). |
| `owner_user_id` | string | Yes | Principal who created the key. |
| `scopes` | string[] | Yes | e.g. `["catalog:read"]`. |
| `created_at` | datetime | Yes | Creation time. |
| `revoked_at` | datetime | No | If set, key invalid. |
| `last_used_at` | datetime | No | Optional audit. |

**Storage**: MongoDB collection `catalog_api_keys` (name TBD); index `key_id` unique.

---

### 6. Skill scan finding (stored)

Output row from [skill-scanner](https://github.com/cisco-ai-defense/skill-scanner) (FR-023, FR-027).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | UUID. |
| `source_type` | string | Yes | `"hub"` \| `"agent_skills"` — distinguishes hub-ingest scans from agent-skills save scans (FR-027). |
| `source_id` | string | No | Hub id (when `source_type=hub`) or agent-skills document id (when `source_type=agent_skills`). |
| `hub_id` | string | No | **Deprecated alias** for `source_id` when `source_type=hub`; retained for backward compatibility. |
| `skill_id` | string | No | Catalog id if mapped. |
| `content_revision` | string | No | Hash or git sha of scanned tree. |
| `severity` | string | Yes | e.g. critical, high, medium, low, info. |
| `rule_id` | string | No | Scanner rule identifier. |
| `path` | string | No | Relative path within skill pack. |
| `message` | string | Yes | Sanitized summary. |
| `created_at` | datetime | Yes | Scan time. |

**Storage**: MongoDB collection `skill_scan_findings`; index by `source_type`, `source_id`, `severity`, `created_at`.

**Attribution (FR-023)**: Findings originate from **[Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner)** provided by **Cisco AI Defense**; admin surfaces that list findings MUST also surface the attribution copy in `contracts/skill-scanner-pipeline.md`.

---

### 7. Chat command (behavioral)

Not a stored entity. The **chat command** `/skills` is a reserved input: when the client detects it, it does not send a normal message. It calls the catalog API and renders the list in the chat UI. No separate persistence for “commands”; only the catalog API response is used.

---

### 8. Supervisor skills snapshot (runtime, FR-016)

In-process metadata on `AIPlatformEngineerMAS` after the last successful `_build_graph()` — not a MongoDB document. Used for operator visibility and comparison with catalog cache generation.

| Field | Type | Description |
|-------|------|-------------|
| `graph_generation` | int | Incremented each `_build_graph()`. |
| `skills_loaded_count` | int | `len(skills)` from last `get_merged_skills` in that build. |
| `skills_merged_at` | datetime (UTC) | When the last successful merge completed. |
| `catalog_cache_generation` | int (optional) | If tracked, bumped on `invalidate_skills_cache()` for UI diff. |

**Contract detail**: See `contracts/supervisor-skills-status.md`.

---

### 9. Skills sync status (derived, FR-026)

Not a MongoDB document. **Computed** for authenticated gateway/admin clients by comparing catalog cache metadata with the supervisor snapshot (§8).

| Field | Type | Description |
|-------|------|-------------|
| `sync_status` | enum | `in_sync` \| `supervisor_stale` \| `unknown` |
| `catalog_cache_generation` | int | From skills middleware cache invalidation counter (may match §8 field of same name). |
| `supervisor_graph_generation` | int | Same as `graph_generation` from §8. |
| `catalog_refreshed_at` | datetime (UTC) | Optional; last time merged catalog cache was rebuilt at HTTP layer. |
| `supervisor_skills_merged_at` | datetime (UTC) | Same as `skills_merged_at` from §8. |
| `skills_loaded_count` | int | From §8; optional secondary check vs entitled catalog count. |

**Rules (normative for UI copy)**:

- **`in_sync`**: `catalog_cache_generation` equals the generation the supervisor last built against (implementation may store `last_built_catalog_generation` on MAS) **or** both counters are present and equal per contract.
- **`supervisor_stale`**: Catalog cache has been invalidated or rebuilt to a generation **newer** than the supervisor’s last successful graph build (user should run refresh / wait for rebuild).
- **`unknown`**: Either side missing, or multi-replica deployment without shared generation (document fallback).

---

## State Transitions

### Skill (per source)

- **Default / filesystem**: Skills appear when files exist in `SKILLS_DIR`; disappear when removed; no explicit “disabled” (removal = not in catalog).
- **Agent skills (`agent_skills`)**: When a document is visible to the catalog and is projected as a skill, it appears; when deleted or filtered out, it disappears from catalog.
- **Hub**: When a hub is enabled and successfully fetched, its skills appear; when hub is disabled or fetch fails, its skills are excluded (or removed from cache).

### Skill hub

- **Registered** → **Enabled**: Admin adds hub; `enabled: true`. Middleware includes it in refresh.
- **Enabled** → **Failed**: Fetch fails; `last_failure_*` set; catalog still returns other sources.
- **Failed** → **Enabled**: Next refresh retries; on success, `last_success_at` updated.
- **Removed**: Hub document deleted or `enabled: false`; its skills no longer in catalog after next refresh.

---

## Relationship to Existing Collections and Components

| Existing | Relationship |
|----------|--------------|
| `agent_skills` | Can be projected into the catalog as skills (source `agent_skills`); catalog API may merge these with default + hubs. **FR-025**: UI and routes SHOULD use **agent-skills** naming aligned with this model. **FR-027**: When an agent-skills document is saved with `skill_content`, the system sets a `scan_status` field (`passed` \| `flagged` \| `unscanned`). Under `SKILL_SCANNER_GATE=strict`, the `agent_skills` loader excludes `scan_status: "flagged"` documents from the merged catalog. |
| `task_configs` | Remain separate; supervisor continues to use them for task/workflow routing. Skills catalog is the list of "skills" for display and assistant context; task configs define how workflows run. |
| `SKILLS_DIR` / skill-templates | Treated as default built-in skills; middleware or API merges them into the catalog (source `default`). |
| `deepagents.middleware.skills.SkillsMiddleware` | Upstream middleware from `deepagents>=0.3.8`; handles system prompt injection via progressive disclosure. Custom catalog layer writes merged skills into its `StateBackend`; the middleware reads them via `before_agent` and injects the "Skills System" section into the supervisor's system prompt (FR-015). |
| `deepagents.backends.state.StateBackend` | Ephemeral in-memory backend used by `SkillsMiddleware` (and already by `FilesystemMiddleware` for subagent file sharing). Skills are written as SKILL.md files under source-specific paths. |
---

## MongoDB Collections (new or extended)

- **`skills`** (optional): Admin-curated default skills (if not only filesystem). Schema aligned with Skill entity above (include `visibility`, `team_ids`, `owner_user_id`).
- **`skill_hubs`**: Registry of external hubs; schema aligned with Skill hub entity above.
- **`catalog_api_keys`**: Hashed API keys for catalog read (gateway).
- **`skill_scan_findings`**: Rows from skill-scanner runs.

Indexes (recommended): `skill_hubs`: `id` (unique), `enabled`, `type`. `skills`: `id` (unique), `source`, `visibility`, `owner_user_id`. `catalog_api_keys`: `key_id` (unique). `skill_scan_findings`: `hub_id`, `severity`, `created_at`.

## Prompt / runtime cap (FR-024)

Configuration key (environment or chart): **`MAX_SKILL_SUMMARIES_IN_PROMPT`** (integer). After entitlement filter, only up to N skill metadata entries are passed into `SkillsMiddleware` source ordering / listing; remaining skills remain in backend storage for on-demand read. Exact selection policy: **documented** (e.g. stable sort by priority then name, or first-N until cap).

**Skill-scanner (FR-023)**: **`SKILL_SCANNER_GATE`** = `warn` \| `strict`; **`SKILL_SCANNER_POLICY`** passed to CLI; optional **`SKILL_SCANNER_FAIL_ON`** for explicit severity threshold. See `contracts/skill-scanner-pipeline.md` and `scripts/scan-packaged-skills.sh`.
