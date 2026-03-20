# Implementation Guide: Integrated Skills with Single Source, Chat Commands, and Skill Hubs

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-19

## Architecture Overview

The feature delivers a two-layer skills architecture:

1. **Custom catalog layer** (`ai_platform_engineering/skills_middleware/`) — aggregates skills from filesystem, MongoDB agent_configs, and GitHub hubs; applies precedence; provides TTL-cached access.
2. **Upstream SkillsMiddleware** (`deepagents.middleware.skills.SkillsMiddleware`) — reads normalized `SKILL.md` files from `StateBackend` and injects them into the supervisor's system prompt via progressive disclosure.

```
  Filesystem (SKILLS_DIR)
         |
         v
  +------------------+      +------------------+
  | default loader   |----->|                  |
  +------------------+      |   catalog.py     |----> GET /skills (FastAPI)
  | agent_config     |----->| get_merged_skills|----> GET /api/skills (Next.js)
  | loader (MongoDB) |      |   precedence     |
  +------------------+      |   TTL cache      |
  | hub_github       |----->|                  |----> build_skills_files()
  | fetcher          |      +------------------+            |
  +------------------+                                       v
                                                     StateBackend (files dict)
                                                             |
                                                             v
                                                     SkillsMiddleware
                                                     (system prompt injection)
```

## Catalog API

### Backend (Python): `GET /skills`

Exposed via `ai_platform_engineering/skills_middleware/router.py`, mounted on the FastAPI app.

- **Auth**: JWT/JWKS validation when `OIDC_ISSUER` is set; bypassed in dev mode.
- **Query params**: `include_content=true` includes full SKILL.md body.
- **Response**: `{ skills: [...], meta: { total, sources_loaded, unavailable_sources } }`
- **503**: When catalog is unavailable.

### Backend: `POST /skills/refresh`

Invalidates the in-memory catalog cache, forcing a fresh load on next access (FR-012).

### Next.js: `GET /api/skills`

Proxies to `BACKEND_SKILLS_URL` if configured; otherwise aggregates locally from filesystem + MongoDB. Returns the same response shape.

## `/skills` Chat Command

Implemented in both `ChatPanel.tsx` and `DynamicAgentChatPanel.tsx`:

1. On submit, input is checked for exact match on `/skills` (trimmed, case-insensitive).
2. If matched: fetches `GET /api/skills`, renders skills list as an in-chat message.
3. Loading state shown during fetch; 503/error shows "Skills are temporarily unavailable."
4. Empty catalog shows "No skills available at the moment."
5. Normal messages are unaffected.

Chat placeholder updated to: `Ask ... anything, type /skills to see available skills, or @ to mention an agent...`

## Skill Hubs

### Data Model

MongoDB collection `skill_hubs`:

| Field | Type | Description |
|-------|------|-------------|
| id | string (unique) | Hub identifier |
| type | "github" | Hub type (only GitHub in v1) |
| location | string | `owner/repo` format |
| enabled | boolean | Whether hub is active |
| credentials_ref | string \| null | Env var name holding GitHub token |
| last_success_at | number \| null | Unix timestamp of last successful fetch |
| last_failure_at | number \| null | Unix timestamp of last failed fetch |
| last_failure_message | string \| null | Error message from last failure |
| created_at | string | ISO timestamp |
| updated_at | string | ISO timestamp |

### API Endpoints (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skill-hubs` | List all hubs |
| POST | `/api/skill-hubs` | Register new hub (201) |
| PATCH | `/api/skill-hubs/[id]` | Update hub (enabled, location, credentials_ref) |
| DELETE | `/api/skill-hubs/[id]` | Remove hub |

All endpoints require admin role; returns 403 for non-admins.

### Admin UI

Located in the **Skills** tab of the Admin Dashboard (`/admin?tab=skills`). The `SkillHubsSection` component allows admins to:

- View registered hubs with status (Active, Error, Disabled)
- Add new GitHub hubs (owner/repo + optional credentials env var)
- Enable/disable hubs
- Delete hubs
- Refresh skills cache

### Hub Fetcher

`hub_github.py` discovers SKILL.md files via the GitHub tree API (`repos/{owner}/{repo}/git/trees/HEAD?recursive=1`) and fetches content via the contents API. Supports both Anthropic/agentskills.io and OpenClaw-style SKILL.md frontmatter (FR-011).

## Precedence Rules

When the same skill name appears from multiple sources:

1. **default** (filesystem) — highest priority
2. **agent_config** (MongoDB) — medium
3. **hub** (GitHub) — lowest; among hubs, earlier registration wins

## Hot Reload (FR-012)

- Catalog uses a TTL-based in-memory cache (default 60s, configurable via `SKILLS_CACHE_TTL`).
- `POST /skills/refresh` invalidates the cache immediately.
- Admin UI "Refresh" button triggers cache refresh.
- Supervisor re-reads catalog on each graph build (per-request).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKILLS_DIR` | auto-detected | Path to skills directory |
| `BACKEND_SKILLS_URL` | none | URL of Python backend for Next.js to proxy to |
| `SKILLS_CACHE_TTL` | `60` | Seconds to cache the merged catalog |
| `OIDC_ISSUER` | none | OIDC issuer URL for JWT validation |
| `OIDC_DISCOVERY_URL` | `{OIDC_ISSUER}/.well-known/openid-configuration` | OIDC discovery endpoint |
| `OIDC_CLIENT_ID` | none | Expected JWT audience |
| `GITHUB_TOKEN` | none | Default GitHub token for hub fetching |
| `GITHUB_API_URL` | `https://api.github.com` | GitHub API base URL |

## Supervisor Integration

In `deep_agent_single.py`:

1. `get_merged_skills(include_content=True)` loads the full catalog.
2. `build_skills_files(skills)` creates the `files` dict + source paths.
3. `SkillsMiddleware(backend=lambda rt: StateBackend(rt), sources=[...])` is added to the middleware list.
4. `state_dict["files"]` is pre-populated with the skills files before serving.

The upstream `SkillsMiddleware.abefore_agent()` then discovers skills via `StateBackend.ls_info()` + `download_files()` and injects the "Skills System" section into the supervisor's system prompt.
