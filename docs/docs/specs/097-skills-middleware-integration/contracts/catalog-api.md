# Contract: Shared Skill Catalog API

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-18

## Overview

The catalog API exposes the merged skill list to the UI (skills gallery and `/skills` chat command) and can be consumed by the backend skills middleware for the supervisor. Same data source ensures consistency (FR-001, FR-004).

---

## Endpoint: List skills (for UI and chat command)

**Method**: `GET`  
**Path**: `/api/skills` (or equivalent; e.g. Next.js API route under `ui/src/app/api/skills/route.ts`)

### Request

- **Headers**: Standard (auth cookie or session as per existing app).
- **Query** (optional):
  - `include_content=false` (default): Return list only (id, name, description, source, metadata). Use for `/skills` and gallery list.
  - `include_content=true`: Include full `content` for each skill when needed (e.g. for runner or assistant).

### Response

**Success (200)**

```json
{
  "skills": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "source": "default" | "agent_config" | "hub",
      "source_id": "string | null",
      "content": "string | null",
      "metadata": {}
    }
  ],
  "meta": {
    "total": 0,
    "sources_loaded": ["default", "hub:github/org/repo"],
    "unavailable_sources": []
  }
}
```

- `skills`: Array of skill objects; order stable (e.g. default first, then by source, then by name).
- `meta.unavailable_sources`: Optional list of hub ids (or "default") that failed to load so UI can show "partial catalog" or admin can debug.

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

- List: Any authenticated user (or public if app allows) can call `GET /api/skills`. No hub registration permission required.
- **Backend (Python) endpoint** that the UI proxies to (e.g. GET /skills or /internal/skills) MUST validate the request using the same pattern as the RAG server: JWT validation via **JWKS** and/or **user_info** (Bearer token validated with JWKS; optionally fetch userinfo for identity/groups). Invalid or missing token MUST return 401. This ensures the backend does not serve the catalog to unauthenticated or invalid callers (FR-014).

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
- **Hot reload (FR-012)**: To refresh skills, clear `skills_metadata` from agent state (or rebuild the agent graph) and re-run `write_skills_to_backend()` with fresh catalog data.

This contract is internal (Python); the REST contract above is for the UI.
