# Setup & Usage Guide: Skills Middleware Integration

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-23

## Overview

The skills middleware provides a **single, shared skill catalog** for both the CAIPE UI and the supervisor (platform engineer agent). Skills come from three sources:

1. **Built-in / Default** — SKILL.md files on disk (`SKILLS_DIR`)
2. **Custom (agent_skills)** — User-created skills stored in MongoDB
3. **Skill Hubs** — External GitHub repositories registered by admins

The merged catalog is exposed via a REST API and injected into the supervisor's system prompt through the upstream `deepagents` `SkillsMiddleware`.

---

## Prerequisites

| Dependency | Minimum Version | Purpose |
|---|---|---|
| Python | 3.11+ | Supervisor backend |
| Node.js | 20+ | Next.js UI |
| MongoDB | 6.0+ | Storage for skills, hubs, API keys |
| `deepagents` | ≥0.3.8 | `SkillsMiddleware` + `StateBackend` |
| `uv` | latest | Python package manager |

---

## 1. Backend Setup (Python — Supervisor)

### 1.1 Install dependencies

```bash
uv venv --python python3.13 --clear .venv
uv sync
```

### 1.2 Environment variables

Set these in your shell, `.env`, or Helm values. Only `MONGODB_URI` is required for a minimal setup; everything else has sensible defaults.

| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | — | MongoDB connection string (e.g. `mongodb://localhost:27017`) |
| `MONGODB_DATABASE` | `caipe` | Database name |
| `SKILLS_DIR` | auto-detected | Path to built-in SKILL.md directory |
| `SKILLS_CACHE_TTL` | `3600` | Seconds to cache the merged catalog (1 hour) |
| `HUB_CACHE_TTL` | `3600` | Seconds to cache GitHub hub skills separately |
| `GITHUB_TOKEN` | — | Default GitHub PAT for fetching hub skills |
| `GITHUB_API_URL` | `https://api.github.com` | GitHub API base (for GHE) |
| `OIDC_ISSUER` | — | OIDC issuer URL; enables JWT validation on `/skills` |
| `OIDC_DISCOVERY_URL` | `{OIDC_ISSUER}/.well-known/openid-configuration` | OIDC discovery endpoint |
| `OIDC_CLIENT_ID` | — | Expected JWT audience |
| `OIDC_TEAMS_CLAIM` | `groups` | JWT claim holding team/group IDs for visibility |
| `MAX_SKILL_SUMMARIES_IN_PROMPT` | `0` (no cap) | Max skill summaries injected into the supervisor system prompt |
| `CAIPE_CATALOG_API_KEY_HEADER` | `X-Caipe-Catalog-Key` | HTTP header name for catalog API key auth |
| `CAIPE_CATALOG_API_KEY_PEPPER` | `change-me-in-production` | HMAC pepper for hashing stored API keys |
| `SKILL_SCANNER_GATE` | `warn` | Scanner policy: `warn` (advisory) or `strict` (block flagged skills) |
| `SKILL_SCANNER_POLICY` | `balanced` | Policy passed to `cisco-ai-skill-scanner` CLI |
| `SKILL_SCANNER_FAIL_ON` | `high` | Minimum severity to fail under strict gate |

### 1.3 Start the supervisor

```bash
# Development (standalone)
PYTHONPATH=. uv run python -m ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.fastapi.main

# The FastAPI app starts on port 8000 by default
# Skills middleware router is mounted at /skills and /skills/refresh
```

### 1.4 Verify the catalog API

```bash
# List all skills (no auth required in dev mode when OIDC_ISSUER is unset)
curl http://localhost:8000/skills | jq .

# With content included
curl "http://localhost:8000/skills?include_content=true" | jq .

# Search
curl "http://localhost:8000/skills?q=kubernetes" | jq .

# Filter by source
curl "http://localhost:8000/skills?source=agent_skills" | jq .

# Refresh (invalidates cache + triggers graph rebuild)
curl -X POST http://localhost:8000/skills/refresh | jq .
```

---

## 2. UI Setup (Next.js)

### 2.1 Install dependencies

```bash
cd ui
nvm use  # if available
npm ci
```

### 2.2 Configure environment

Copy `env.example` to `.env.local` and set at minimum:

```bash
cp env.example .env.local
```

Key skills-related variables in `.env.local`:

```env
# MongoDB (required for skills storage)
MONGODB_URI=mongodb://admin:changeme@localhost:27017
MONGODB_DATABASE=caipe
NEXT_PUBLIC_MONGODB_ENABLED=true

# Supervisor A2A URL
NEXT_PUBLIC_A2A_BASE_URL=http://localhost:8000

# Skills middleware backend (required for skill scanning on save)
BACKEND_SKILLS_URL=http://localhost:8000
```

### 2.3 Start the UI

```bash
npm run dev
# UI available at http://localhost:3000
```

### 2.4 MongoDB migration

When upgrading from a previous version that used `agent_configs`, the UI automatically runs a **one-time migration** on startup: documents in the legacy `agent_configs` collection are copied to `agent_skills`, and the old collection is renamed to `agent_configs_migrated`. No manual intervention is needed.

---

## 3. Docker Compose (Full Stack)

```bash
docker compose -f docker-compose.dev.yaml up
```

The compose file starts MongoDB, the supervisor (with skills middleware), and the UI. Skills-related environment variables are pre-configured in the compose file.

---

## 4. Using Skills

### 4.1 View skills in the UI

Navigate to **`/skills`** in the browser. The Skills Gallery shows all available skills grouped by source:

| Label | Source | Description |
|---|---|---|
| **Built-in** | `default` | Platform-packaged skills from `SKILLS_DIR` |
| **Custom** | `agent_skills` | User-created skills stored in MongoDB |
| **Skill Hub** | `hub` | Skills from registered GitHub repositories |

### 4.2 `/skills` chat command

In any chat conversation, type `/skills` and press Enter. The system displays the current skill catalog inline without sending the message to the assistant. This replaces the legacy "Run in Chat" flow.

### 4.3 Create a custom skill

1. Go to **Skills** → click **New Skill** (or **+**).
2. Fill in the skill name, description, and SKILL.md content.
3. Click **Save**.
4. If `BACKEND_SKILLS_URL` is configured, the skill is scanned before save. The response includes `scan_status`: `passed`, `flagged`, or `unscanned`.
5. Under `SKILL_SCANNER_GATE=strict`, flagged skills are excluded from the catalog until remediated.

### 4.4 Register a GitHub skill hub (admin)

1. Go to **Admin** → **Skills** tab → **Skill Hubs** section.
2. Click **Add Hub**.
3. Enter the repository in `owner/repo` format (e.g. `cnoe-io/agent-skills-collection`).
4. Optionally specify a **Credentials Env Var** (name of an env var holding a GitHub PAT for private repos).
5. Click **Crawl** to preview discovered `SKILL.md` paths before committing.
6. Click **Register** to save the hub.
7. Click **Refresh Skills** to immediately load new skills into the catalog.

The hub fetcher discovers `SKILL.md` files via the GitHub tree API and fetches content via the contents API. Both **Anthropic/agentskills.io** and **OpenClaw-style** SKILL.md formats are supported.

### 4.5 Refresh the catalog

Skills are cached in memory (default TTL: 1 hour). To force a refresh:

- **UI**: Admin → Skills tab → **Refresh Skills** button
- **API**: `POST /skills/refresh` (or `POST /api/skills/refresh` via UI proxy)
- **Automatic**: Cache expires after `SKILLS_CACHE_TTL` seconds

A refresh invalidates the in-memory cache **and** triggers a supervisor graph rebuild, so the assistant picks up changes without a pod restart.

---

## 5. Catalog API Reference

### `GET /skills`

Returns the merged skill catalog. Auth: JWT (OIDC/JWKS) or catalog API key when `OIDC_ISSUER` is set; no auth required in dev mode.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Free-text search on name and description |
| `source` | string | — | Filter by source: `default`, `agent_skills`, `hub` |
| `visibility` | string | — | Filter within entitlement: `global`, `team`, `personal` |
| `include_content` | bool | `false` | Include full SKILL.md body |
| `page` | int | `1` | Page number (1-based) |
| `page_size` | int | `50` | Items per page (max 200) |

**Response (200):**

```json
{
  "skills": [
    {
      "id": "create-argocd-application",
      "name": "Create ArgoCD Application",
      "description": "Creates a new ArgoCD application...",
      "source": "default",
      "source_id": null,
      "visibility": "global",
      "team_ids": [],
      "owner_user_id": null,
      "content": null,
      "metadata": {}
    }
  ],
  "meta": {
    "total": 12,
    "page": 1,
    "page_size": 50,
    "sources_loaded": ["default", "agent_skills"],
    "unavailable_sources": []
  }
}
```

### `POST /skills/refresh`

Invalidates the skills cache and triggers a supervisor graph rebuild. Auth: same as `GET /skills`.

**Response (200):**

```json
{
  "status": "refreshed",
  "graph_generation": 3,
  "skills_loaded_count": 15
}
```

### `GET /api/skills` (Next.js proxy)

UI-facing proxy. Forwards to `BACKEND_SKILLS_URL/skills` if configured; otherwise aggregates locally from filesystem + MongoDB. Returns the same response shape as the Python endpoint.

---

## 6. Skill Hub API Reference

All endpoints require admin role.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/skill-hubs` | List all registered hubs |
| `POST` | `/api/skill-hubs` | Register a new hub |
| `PATCH` | `/api/skill-hubs/[id]` | Update hub (enable/disable, change location) |
| `DELETE` | `/api/skill-hubs/[id]` | Remove a hub |
| `POST` | `/api/skill-hubs/crawl` | Preview SKILL.md paths from a repo (no persistence) |

### Register a hub

```bash
curl -X POST http://localhost:3000/api/skill-hubs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "github",
    "location": "cnoe-io/agent-skills-collection",
    "enabled": true,
    "credentials_ref": "GITHUB_TOKEN"
  }'
```

### Crawl preview

```bash
curl -X POST http://localhost:3000/api/skill-hubs/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "type": "github",
    "location": "cnoe-io/agent-skills-collection"
  }'
```

---

## 7. Try Skills Gateway (External Integrations)

The skills catalog can be consumed by external tools like **Claude** and **Cursor** using either:

1. **OIDC Bearer token** — Use your Okta/OIDC access token
2. **Catalog API key** — Create one in the Admin panel or via API

### Using with Bearer token

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     "https://your-caipe.example.com/skills?q=kubernetes&include_content=true"
```

### Using with API key

```bash
curl -H "X-Caipe-Catalog-Key: sk_live_your_key_here" \
     "https://your-caipe.example.com/skills?q=deploy"
```

### Claude integration

1. Navigate to **Skills** → **Try Skills Gateway** in the UI.
2. Copy the `curl` example with your token/key.
3. In Claude's tool configuration, point to the catalog endpoint.
4. Skills are available as context for Claude's responses.

### Cursor integration

1. In the **Try Skills Gateway** panel, copy the SKILL.md export.
2. Place SKILL.md files in your project's `.cursor/skills/` directory (or equivalent).
3. Cursor reads the skills and applies them to code generation.

---

## 8. Visibility and Entitlement (FR-020)

Each skill has a **visibility** level:

| Visibility | Who can see it |
|---|---|
| `global` | All authenticated users |
| `team` | Users whose JWT `groups`/`teams` claim matches `team_ids` |
| `personal` | Only the owner (`owner_user_id` matches JWT `sub`) |

A user sees the **union** of: global skills + their team skills + their personal skills. Visibility is enforced at the API layer for all surfaces (UI gallery, `/skills` chat command, gateway API, supervisor prompt injection).

---

## 9. Skill Scanner Integration (FR-023)

Skills from hubs and user-created skills are optionally scanned by [Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner) (provided by **Cisco AI Defense**).

### Configuration

| Variable | Default | Description |
|---|---|---|
| `SKILL_SCANNER_GATE` | `warn` | `warn`: advisory only; `strict`: exclude flagged skills from catalog |
| `SKILL_SCANNER_POLICY` | `balanced` | Policy profile passed to scanner CLI |
| `SKILL_SCANNER_FAIL_ON` | `high` | Minimum severity to flag under strict gate |

### CI pipeline scanning

For packaged/built-in skills, run the scanner in CI:

```bash
SKILLS_DIR=/path/to/skills SKILL_SCANNER_GATE=strict scripts/scan-packaged-skills.sh
```

### On-save scanning (agent_skills)

When `BACKEND_SKILLS_URL` is configured, saving a skill in the UI triggers a synchronous scan. The document is always persisted but tagged with `scan_status`:

- `passed` — No blocking findings
- `flagged` — Findings met severity threshold
- `unscanned` — Scanner unavailable or no content

Under `SKILL_SCANNER_GATE=strict`, flagged skills are excluded from the merged catalog.

---

## 10. Precedence Rules

When the same skill ID appears from multiple sources:

| Priority | Source | Label |
|---|---|---|
| 1 (highest) | `default` (filesystem) | Built-in |
| 2 | `agent_skills` (MongoDB) | Custom |
| 3 (lowest) | `hub` (GitHub) | Skill Hub |

Among hubs, earlier registration wins.

---

## 11. Architecture

```
  Filesystem (SKILLS_DIR)
         │
         ▼
  ┌──────────────────┐      ┌──────────────────┐
  │  default loader   │─────▶│                  │
  ├──────────────────┤      │   catalog.py     │───▶ GET /skills (FastAPI)
  │  agent_skills     │─────▶│  get_merged_     │───▶ GET /api/skills (Next.js)
  │  loader (MongoDB) │      │  skills()        │
  ├──────────────────┤      │  precedence +    │
  │  hub_github       │─────▶│  TTL cache       │───▶ build_skills_files()
  │  fetcher          │      └──────────────────┘         │
  └──────────────────┘                                     ▼
                                                   StateBackend (files dict)
                                                           │
                                                           ▼
                                                   SkillsMiddleware
                                                   (system prompt injection)
```

### Key modules

| Module | Purpose |
|---|---|
| `skills_middleware/catalog.py` | Merges skills from all sources with TTL cache |
| `skills_middleware/loaders/default.py` | Loads built-in SKILL.md from disk |
| `skills_middleware/loaders/agent_skill.py` | Loads custom skills from MongoDB `agent_skills` |
| `skills_middleware/loaders/hub_github.py` | Fetches skills from GitHub repos |
| `skills_middleware/precedence.py` | Deterministic merge with source priority |
| `skills_middleware/entitlement.py` | Visibility filtering (global/team/personal) |
| `skills_middleware/router.py` | FastAPI endpoints (`/skills`, `/skills/refresh`) |
| `skills_middleware/backend_sync.py` | Writes merged skills to `StateBackend` for middleware |
| `skills_middleware/api_keys_store.py` | Catalog API key management |
| `skills_middleware/hub_skill_scan.py` | Skill Scanner integration for hubs |

---

## 12. Helm Deployment

The supervisor Helm chart (`charts/ai-platform-engineering/charts/supervisor-agent/`) supports all skills middleware environment variables through the generic `env` map in `values.yaml`:

```yaml
# values.yaml
env:
  SKILLS_CACHE_TTL: "3600"
  HUB_CACHE_TTL: "3600"
  OIDC_ISSUER: "https://your-idp.example.com"
  OIDC_CLIENT_ID: "your-client-id"
  OIDC_TEAMS_CLAIM: "groups"
  MAX_SKILL_SUMMARIES_IN_PROMPT: "100"
  SKILL_SCANNER_GATE: "warn"

# Sensitive values via secrets
llmSecrets:
  GITHUB_TOKEN: "ghp_..."
  CAIPE_CATALOG_API_KEY_PEPPER: "your-pepper"
```

The deployment template iterates over `env` and injects each key-value pair as an environment variable into the supervisor container.

---

## 13. Troubleshooting

### Skills not appearing after save

- Verify `MONGODB_URI` and `MONGODB_DATABASE` are set on both UI and supervisor.
- Check that the UI's `BACKEND_SKILLS_URL` points to the running supervisor.
- Click **Refresh Skills** in Admin → Skills, or call `POST /skills/refresh`.

### Hub skills not loading

- Check the hub status in Admin → Skills → Skill Hubs (look for error indicators).
- Verify `GITHUB_TOKEN` is set if the repo is private.
- Check supervisor logs for `Hub <id> fetch failed` messages.
- GitHub API rate limits may apply; the hub cache TTL (`HUB_CACHE_TTL`) avoids excessive calls.

### Skill scanner returning "unscanned"

- Ensure `BACKEND_SKILLS_URL` is set in the UI's `.env.local`.
- The scanner requires the `cisco-ai-skill-scanner` CLI to be available in the supervisor's `PATH`.
- Without the scanner CLI, `scan_status` defaults to `unscanned` (skills are still saved and available).

### Cache not expiring

- Default cache TTL is 1 hour (`SKILLS_CACHE_TTL=3600`). Use `POST /skills/refresh` for immediate invalidation.
- Hub cache has its own TTL (`HUB_CACHE_TTL`) to avoid expensive GitHub API calls.

### Migration from agent_configs

- The one-time migration runs automatically when the UI connects to MongoDB.
- If `agent_configs` exists and has documents, they are copied to `agent_skills`.
- The old collection is renamed to `agent_configs_migrated` (never runs again).
- Check UI startup logs for `✅ Migrated agent_configs → agent_skills` confirmation.
