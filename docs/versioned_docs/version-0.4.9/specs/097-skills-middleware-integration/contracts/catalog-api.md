# Contract: Shared Skill Catalog API

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-24 (search, visibility, pagination, API key)

## Overview

The catalog API exposes the merged skill list to the UI (skills gallery and `/skills` chat command) and can be consumed by the backend skills middleware for the supervisor. Same data source ensures consistency (FR-001, FR-004).

---

## Endpoint: List skills (for UI and chat command)

**Method**: `GET`  
**Path**: `/api/skills` (or equivalent; e.g. Next.js API route under `ui/src/app/api/skills/route.ts`)

### Request

- **Headers**:
  - **Browser / UI session**: Existing app auth (cookie/session) as today; Next.js route forwards Bearer to Python where required.
  - **Python catalog** (`GET /skills` or `/internal/skills`): **Either** (1) `Authorization: Bearer <JWT>` validated via JWKS / Okta OIDC (FR-014), **or** (2) catalog API key per [gateway-api.md](./gateway-api.md) (FR-018). Invalid/missing auth → **401** (generic message).
- **Query** (optional):
  - `q` — Free-text search over `name`, `description` (and optional tags); empty returns full entitled page.
  - `page` — 1-based page index (default `1`).
  - `page_size` — Max items per page (default e.g. `50`, hard cap e.g. `200`) for large catalogs (FR-019, FR-024).
  - `source` — Filter: `default` | `agent_skills` | `hub` (optional).
  - `visibility` — Filter **within** caller’s entitlement only: `global` | `team` | `personal` (optional); omit = all entitled visibilities.
  - `include_content=false` (default): Return list only (id, name, description, source, source_id, visibility, team_ids, metadata). Use for `/skills` and gallery list.
  - `include_content=true`: Include full `content` for each skill when needed (e.g. for runner or assistant); discouraged for unbounded list calls.

### Response

**Success (200)**

```json
{
  "skills": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "source": "default" | "agent_skills" | "hub",
      "source_id": "string | null",
      "visibility": "global" | "team" | "personal",
      "team_ids": ["string"],
      "owner_user_id": "string | null",
      "content": "string | null",
      "metadata": {}
    }
  ],
  "meta": {
    "total": 0,
    "page": 1,
    "page_size": 50,
    "sources_loaded": ["default", "hub:github/org/repo"],
    "unavailable_sources": []
  }
}
```

- `skills`: Array of skill objects; order stable (e.g. default first, then by source, then by name). **Only skills the caller is entitled to** (FR-020: union of global + caller’s teams + personal).
- `meta.total`: Total matching entitled skills (post-filter), for pagination UI.
- `meta.unavailable_sources`: Optional list of hub ids (or "default") that failed to load so UI can show "partial catalog" or admin can debug.
- **Empty search**: HTTP 200 with `skills: []` and a user-visible message in UI; optional `meta.message` e.g. `"no_matches"` (not 500).

**Catalog unavailable (503)**

When the central catalog cannot be produced (e.g. MongoDB down and no cache):

```json
{
  "error": "skills_unavailable",
  "message": "Skills are temporarily unavailable. Please try again later."
}
```

Client should show a non-technical message (SC-004).

### Authentication and authorization

- **Next.js `GET /api/skills`**: Any authenticated UI user (existing session); forwards to Python with user token where applicable.
- **Backend (Python)** `GET /skills`: JWT (Okta/OIDC via JWKS) **or** valid catalog API key (FR-014, FR-018); then apply **visibility** using resolved principal (OIDC `sub` + team claims from token/userinfo or API key owner record). Invalid or missing auth → **401** (generic). Hub registration remains admin-only (separate contract).

---

## Endpoint: Refresh catalog and supervisor snapshot

**Method**: `POST`  
**Path**: `/skills/refresh` (Python) / proxied `POST /api/skills/refresh` (UI)

Must **invalidate** merged-skills cache **and** trigger **supervisor graph rebuild** so MAS skills match the catalog (FR-012). Optional response fields: `graph_generation`, `skills_loaded_count`. See `contracts/supervisor-skills-status.md`.

---

## Backend (Python) contract for skills middleware

The supervisor integrates with skills through two layers:

### 1. Custom catalog layer (`ai_platform_engineering/skills_middleware/`)

- **Function**: `get_merged_skills(include_content: bool = False) -> List[Skill]` (or equivalent).
- **Return**: List of skill dicts or objects matching the same shape (id, name, description, source, source_id, content optional, metadata).
- **Failure**: On catalog unavailable, return empty list or raise; supervisor handles "no skills" in prompt or tool metadata.

### 2. Upstream `SkillsMiddleware` integration (FR-015)

- **Function**: `write_skills_to_backend(skills, backend)` — writes each normalized skill as a `SKILL.md` file (YAML frontmatter + markdown body) into the `StateBackend` under source-specific paths (e.g. `/skills/default/<skill-name>/SKILL.md`, `/skills/hub-<hub-id>/<skill-name>/SKILL.md`).
- **Middleware**: `SkillsMiddleware(backend=lambda rt: StateBackend(rt), sources=["/skills/default/", "/skills/hub-<id>/", ...])` is added to the supervisor's `create_deep_agent()` middleware list.
- **Behavior**: The upstream middleware's `abefore_agent()` loads `SkillMetadata` from the backend once per session (or per state reset); `awrap_model_call()` injects the "Skills System" section into the system prompt with progressive disclosure (name + description listed; full SKILL.md read on demand via backend `download_files()`).
- **Hot reload (FR-012)**: Invalidate catalog cache, rebuild `AIPlatformEngineerMAS` graph (`_rebuild_graph` / `_build_graph`) so `get_merged_skills` runs again and `create_deep_agent` receives updated `skills` / injected `files`. Optionally clear `skills_metadata` in agent state if middleware caches per thread.

This contract is internal (Python); the REST contract above is for the UI.

**Supervisor status**: See `contracts/supervisor-skills-status.md` (FR-016).
