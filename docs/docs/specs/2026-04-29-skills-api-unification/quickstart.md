# Quickstart: Validate Unified Skills API (post-implementation)

**Spec**: [spec.md](./spec.md)

## Breaking URL changes (release / PR notes)

| Removed (legacy) | Replacement |
|------------------|-------------|
| `GET/POST/PUT/DELETE /api/agent-skills` | `/api/skills/configs` |
| `POST /api/agent-skills/seed` | `POST /api/skills/seed` |
| `POST /api/agent-skills/generate` | `POST /api/skills/generate` |
| `POST /api/agent-skills/import-github` | `POST /api/skills/import-github` |

`GET /api/skills` (merged catalog) is unchanged. Collection name **`agent_skills`** in MongoDB is unchanged — only HTTP paths moved.

## Prerequisites

- `ui/` dependencies installed (`npm ci`).
- MongoDB URI configured if testing persisted skills (same as current agent-skills). **No collection rename or migration script** is required for API unification — see [mongodb-migration.md](./mongodb-migration.md).
- Supervisor URL set if testing refresh/scan (`NEXT_PUBLIC_A2A_BASE_URL` / env used by existing routes).

## 1. Lint and unit tests

```bash
cd ui
npm run lint
npm test
```

## 2. Manual API checks (authenticated session or test token as your env provides)

1. **Catalog**: `GET /api/skills` — returns merged catalog JSON; not the raw configs list.
2. **Configs CRUD**: `GET/POST/PUT/DELETE /api/skills/configs` — mirrors previous agent-skills behavior.
3. **Import**: `POST /api/skills/templates/import` with a single `template_id` — second POST yields **skip**, not duplicate row.
4. **Legacy**: `GET /api/agent-skills` — **404** (or absent route) after removal.

## 3. Client grep

```bash
rg "/api/agent-skills" ui/src
```

Expect **no** matches after migration (SC-001).

## 4. Gateway smoke

- Open Skills API Gateway UI — primary flow describes **live catalog** first.
- Optional: run install script path only from documented **advanced** section.

## 5. Skills AI Assist (optional)

Skills Builder calls **`POST /api/skills/generate`**, which proxies to dynamic agents via `ui/src/lib/server/assistant-suggest-da.ts` (same helper as other flows). Configure the UI server env so that proxy can reach the service:

| Variable | Purpose |
|----------|---------|
| `DYNAMIC_AGENTS_URL` | Base URL of the dynamic-agents service (default in code is often `http://localhost:8100`; must match your running instance). |
| `DYNAMIC_AGENTS_INTERNAL_TOKEN` | Optional bearer token for service-to-service calls (see `ui/env.example`). |

**Verify**: Open Skills Builder → run **AI Assist** / generate; the network tab should show `POST /api/skills/generate` returning 200 (or a clear error if dynamic agents is down). **`NEXT_PUBLIC_*` alone does not set server env** — set `DYNAMIC_AGENTS_URL` in `ui/.env.local` for `next dev` / deployment.

Direct dynamic-agents entry (if used elsewhere): `ui/src/app/api/dynamic-agents/assistant/suggest/route.ts` → `{DYNAMIC_AGENTS_URL}/api/v1/assistant/suggest`.

## 6. Fresh-environment behavior

- With empty `agent_skills` (or no seed for example id), first-run path creates **at most one** auto-seeded example (SC-003).
