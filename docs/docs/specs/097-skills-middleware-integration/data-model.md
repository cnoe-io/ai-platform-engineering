# Data Model: Integrated Skills — Single Source, Chat Commands, Skill Hubs

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-18

## Purpose

Define the entities and storage shape for the shared skill catalog, skill hubs, and chat command behavior so that the UI and the platform assistant consume the same data.

---

## Entities

### 1. Skill (catalog entry)

A single capability offered to the assistant and listed in the UI. May come from the default catalog (MongoDB or filesystem), from `agent_configs` (projected), or from a registered hub.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Stable identifier; unique within the merged catalog after precedence rules (e.g. `default-skill-id`, `hub-name/skill-id`). |
| `name` | string | Yes | Display name (from frontmatter `name`; agentskills.io or OpenClaw-style). |
| `description` | string | Yes | Short description for listing and assistant context (max length TBD; agentskills.io ≤1024; OpenClaw 1–2 sentences). |
| `source` | enum | Yes | `"default"` \| `"agent_config"` \| `"hub"` — origin for precedence and debugging. |
| `source_id` | string | No | Opaque source identifier (e.g. hub id, agent_config id). |
| `content` | string | No | Full skill content (e.g. SKILL.md body) when needed for execution. |
| `metadata` | object | No | Optional (category, icon, tags, compatibility, etc.). |
| `created_at` | datetime | No | When the skill was first seen in the catalog. |
| `updated_at` | datetime | No | Last time the skill was refreshed from source. |

**Validation**: `id` and `name` non-empty; `description` non-empty; `source` one of the enum values. When loading from hubs, accept both **Anthropic/agentskills.io** and **OpenClaw-style** SKILL.md (YAML frontmatter + markdown body); normalize to this entity shape (FR-011).

**Precedence**: When the same `id` appears from multiple sources, apply: default &gt; agent_config &gt; hub; among hubs, earlier registration wins (or explicit priority if added later).

---

### 2. Skill catalog (logical)

The **merged** list of all skills from default store + agent_configs projection + all enabled hubs. Not a single collection; produced by the skills middleware (and optionally cached). Default store may be:

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
├── agent-config/                 # Skills projected from agent_configs
│   ├── <skill-name>/
│   │   └── SKILL.md
│   └── ...
└── hub-<hub-id>/                 # Skills from each enabled hub
    ├── <skill-name>/
    │   └── SKILL.md
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
  source: default | agent_config | hub
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

**Precedence**: The catalog layer applies precedence (default > agent_config > hub) *before* writing to the `StateBackend`. The upstream middleware uses "last wins by name" within its source list, but since the catalog layer has already resolved conflicts, each source path in the backend contains only non-conflicting skills.

---

### 5. Chat command (behavioral)

Not a stored entity. The **chat command** `/skills` is a reserved input: when the client detects it, it does not send a normal message. It calls the catalog API and renders the list in the chat UI. No separate persistence for “commands”; only the catalog API response is used.

---

## State Transitions

### Skill (per source)

- **Default / filesystem**: Skills appear when files exist in `SKILLS_DIR`; disappear when removed; no explicit “disabled” (removal = not in catalog).
- **Agent config**: When an agent_config is visible to the catalog and is projected as a skill, it appears; when deleted or filtered out, it disappears from catalog.
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
| `agent_configs` | Can be projected into the catalog as skills (source `agent_config`); catalog API may merge these with default + hubs. |
| `task_configs` | Remain separate; supervisor continues to use them for task/workflow routing. Skills catalog is the list of "skills" for display and assistant context; task configs define how workflows run. |
| `SKILLS_DIR` / skill-templates | Treated as default built-in skills; middleware or API merges them into the catalog (source `default`). |
| `deepagents.middleware.skills.SkillsMiddleware` | Upstream middleware from `deepagents>=0.3.8`; handles system prompt injection via progressive disclosure. Custom catalog layer writes merged skills into its `StateBackend`; the middleware reads them via `before_agent` and injects the "Skills System" section into the supervisor's system prompt (FR-015). |
| `deepagents.backends.state.StateBackend` | Ephemeral in-memory backend used by `SkillsMiddleware` (and already by `FilesystemMiddleware` for subagent file sharing). Skills are written as SKILL.md files under source-specific paths. |
---

## MongoDB Collections (new or extended)

- **`skills`** (optional): Admin-curated default skills (if not only filesystem). Schema aligned with Skill entity above.
- **`skill_hubs`**: Registry of external hubs; schema aligned with Skill hub entity above.

Indexes (recommended): `skill_hubs`: `id` (unique), `enabled`, `type`. `skills`: `id` (unique), `source`.
