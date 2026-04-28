# CRUD Migration Plan: DA → Next.js Gateway

**Branch**: `prebuild/feat/slack-agui-migration`
**Goal**: Move all config ownership (CRUD + seeding) from Dynamic Agents (DA) to the Next.js gateway. DA becomes a pure runtime — it reads configs from MongoDB and runs LangGraph graphs. It does not write configs.

---

## Constitution Compliance Notes

Reviewed against `.specify/memory/constitution.md` v1.0.0:

- **I. Worse is Better** — Mechanical port of existing logic. No new abstractions. Seeding moves as-is, just rewritten in TypeScript.
- **II. YAGNI** — No speculative helpers files. All helpers in the file that uses them.
- **III. Rule of Three / Dead code** — Dead DA routes, seed_config.py, models_config.py, config.yaml, and access functions deleted. Version control is the safety net.
- **IV. Composition** — N/A.
- **V. Specs** — Migration work, tracked via AGENTS.md session notes (part of slack-agui-migration).
- **VI. CI Gates** — Phase 5 runs all DA tests, UI build, Slack bot tests, ruff.
- **VII. Security by Default** — POST handlers use explicit field allowlists, not body spreading. Prevents injection of `is_system`, `config_driven`, `owner_id` via request body.

---

## Architectural Change

### Before (messy split ownership)
```
DA writes configs:     seed_config.py → mongo.upsert_agent/server (startup)
DA writes configs:     routes/agents.py → mongo.create/update/delete_agent (API)
DA writes configs:     routes/mcp_servers.py → mongo.create/update/delete_server (API)
DA reads configs:      chat.py, conversations.py, agent_runtime.py → mongo.get_agent/get_servers_by_ids
DA serves models:      routes/llm_models.py (from in-memory cache)
Next.js reads configs: GET routes (local MongoDB reads)
Next.js proxies writes: POST/PUT/DELETE → fetch(DA) → DA writes to MongoDB
```

### After (clean separation)
```
Next.js owns configs:  instrumentation.ts → seed agents/servers/models on startup
Next.js owns configs:  routes → create/update/delete agents/servers (local MongoDB)
Next.js serves models: GET /api/dynamic-agents/models (from MongoDB)
DA reads configs:      chat.py, conversations.py, agent_runtime.py → mongo.get_agent/get_servers_by_ids
DA runs probe:         routes/mcp_servers.py → probe_server_tools (Python MCP client)
DA runs LLM:           routes/assistant.py → LLMFactory (no model validation, trusts gateway)
```

DA becomes a **pure runtime**: it reads agent/server configs from MongoDB, builds LangGraph graphs, connects MCP clients, and streams responses. It never writes to the `dynamic_agents`, `mcp_servers`, or `llm_models` collections.

---

## Phase 1: Move Agent CRUD to Next.js Gateway

### What changes

**File**: `ui/src/app/api/dynamic-agents/route.ts`

Currently: GET is local MongoDB, POST/PUT/DELETE proxy to DA via `fetch(DYNAMIC_AGENTS_URL/api/v1/agents/...)`.

After: All four methods use local MongoDB directly. No DA proxy for agent CRUD.

### 1a. Rewrite POST (create agent)

Port the following logic from DA `mongo.py:create_agent()` + `routes/agents.py:create_agent()`:

1. **Slugify** — generate `agent_id` from `name`: lowercase, replace non-alphanumeric with `-`, collapse consecutive `-`, strip leading/trailing `-`.
   ```ts
   function slugify(name: string): string {
     return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
   }
   ```

2. **Reserved slug check** — reject if slug is in `RESERVED_AGENT_SLUGS` or starts with `__`:
   ```ts
   const RESERVED_AGENT_SLUGS = new Set([
     "__start__", "__end__", "__interrupt__", "__checkpoint__", "__error__",
     "start", "end", "agent", "tools", "call-model",
     "general-purpose", "task",
   ]);
   ```
   Return 409 if reserved.

3. **Uniqueness check** — `findOne({ _id: slug })`. Return 409 if exists.

4. **Subagent visibility validation** — call `validateSubagentVisibility()` (see 1f). Return 400 if invalid.

5. **Insert document with explicit field allowlist** (Security VII — do NOT spread `...body`):
   ```ts
   const now = new Date();
   const doc = {
     _id: agentId,
     name: body.name,
     description: body.description ?? '',
     system_prompt: body.system_prompt,
     allowed_tools: body.allowed_tools ?? {},
     builtin_tools: body.builtin_tools ?? undefined,
     model_id: body.model_id,
     model_provider: body.model_provider,
     visibility: body.visibility ?? 'private',
     shared_with_teams: body.shared_with_teams ?? [],
     subagents: body.subagents ?? [],
     ui: body.ui ?? undefined,
     enabled: body.enabled ?? true,
     // Server-controlled fields — never from request body
     owner_id: user.email,
     is_system: false,
     config_driven: false,
     created_at: now,
     updated_at: now,
   };
   await collection.insertOne(doc);
   ```

6. Return `successResponse(doc, 201)`.

### 1b. Rewrite PUT (update agent)

Port from DA `routes/agents.py:update_agent()`:

1. Require `id` query param (already done).
2. `findOne({ _id: id })` — 404 if not found.
3. **Config-driven guard** — if `agent.config_driven === true`, return 403: `"Config-driven agents cannot be modified. Update config.yaml instead."`
4. **Subagent visibility validation** — merge `update.visibility ?? agent.visibility` and `update.subagents ?? agent.subagents`, validate with `validateSubagentVisibility()`.
5. **Update with explicit field allowlist** — only pick known mutable fields from body, set `updated_at: new Date()`, use `findOneAndUpdate({ _id: id }, { $set: updateData }, { returnDocument: 'after' })`. Mutable fields: `name`, `description`, `system_prompt`, `allowed_tools`, `builtin_tools`, `model_id`, `model_provider`, `visibility`, `shared_with_teams`, `subagents`, `ui`, `enabled`. Never allow: `_id`, `owner_id`, `is_system`, `config_driven`, `created_at`.
6. Return updated doc.

### 1c. Rewrite DELETE (delete agent)

Port from DA `routes/agents.py:delete_agent()`:

1. Require `id` query param (already done).
2. `findOne({ _id: id })` — 404 if not found.
3. **System agent guard** — if `agent.is_system === true`, return 400: `"System agents cannot be deleted"`
4. **Config-driven guard** — if `agent.config_driven === true`, return 403: `"Config-driven agents cannot be deleted. Remove from config.yaml instead."`
5. `deleteOne({ _id: id })`.
6. Return `successResponse({ deleted: id })`.

### 1d. GET stays as-is

No changes needed — already local MongoDB.

### 1e. Remove DA proxy infrastructure from this file

- Remove `DYNAMIC_AGENTS_URL` constant (no longer used by this file).
- Remove `Authorization: Bearer` header construction.
- Remove `fetch()` calls to DA backend.

### 1f. Port `validateSubagentVisibility()` to TypeScript

Port from DA `routes/agents.py:validate_subagent_visibility()`. Place as a helper function in the same route file:

```ts
async function validateSubagentVisibility(
  parentVisibility: VisibilityType,
  subagents: SubAgentRef[],
  collection: Collection<DynamicAgentConfig>,
): Promise<{ valid: boolean; error?: string }> {
  if (!subagents || subagents.length === 0) return { valid: true };

  for (const ref of subagents) {
    const sub = await collection.findOne({ _id: ref.agent_id });
    if (!sub) return { valid: false, error: `Subagent "${ref.agent_id}" not found` };

    // Global parent → only global subagents
    if (parentVisibility === 'global' && sub.visibility !== 'global') {
      return { valid: false, error: `Global agents can only use global subagents. "${sub.name}" is ${sub.visibility}.` };
    }
    // Team parent → team or global subagents only
    if (parentVisibility === 'team' && sub.visibility === 'private') {
      return { valid: false, error: `Team agents can only use team or global subagents. "${sub.name}" is private.` };
    }
    // Private parent → any visibility (no restriction)
  }

  return { valid: true };
}
```

### 1g. No changes to `available-subagents/route.ts`

This route is already fully local MongoDB with its own cycle detection. No changes needed.

---

## Phase 2: Move MCP Server CRUD to Next.js Gateway

### What changes

**File**: `ui/src/app/api/mcp-servers/route.ts`

Currently: GET is local MongoDB, POST/PUT/DELETE proxy to DA.

After: All four methods use local MongoDB directly. No DA proxy for MCP server CRUD.

### 2a. Rewrite POST (create MCP server)

Port from DA `routes/mcp_servers.py:create_mcp_server()`:

1. Parse body. Body must include `id` (user-provided slug).
2. **Uniqueness check** — `findOne({ _id: body.id })`. Return 409 if exists.
3. **Transport validation** — `stdio` requires `command`, `sse`/`http` requires `endpoint`. Return 400 if missing.
4. **Insert with explicit field allowlist** (Security VII):
   ```ts
   const now = new Date();
   const doc = {
     _id: body.id,
     name: body.name,
     description: body.description ?? '',
     transport: body.transport,
     endpoint: body.endpoint ?? undefined,
     command: body.command ?? undefined,
     args: body.args ?? undefined,
     env: body.env ?? undefined,
     enabled: body.enabled ?? true,
     // Server-controlled — never from request body
     config_driven: false,
     created_at: now,
     updated_at: now,
   };
   await collection.insertOne(doc);
   ```
5. Return `successResponse(doc, 201)`.

### 2b. Rewrite PUT (update MCP server)

Port from DA `routes/mcp_servers.py:update_mcp_server()`:

1. Require `id` query param.
2. `findOne({ _id: id })` — 404 if not found.
3. **Config-driven guard** — if `server.config_driven === true`, return 403.
4. **Update with explicit field allowlist** — mutable fields: `name`, `description`, `transport`, `endpoint`, `command`, `args`, `env`, `enabled`. Never allow: `_id`, `config_driven`, `created_at`. Filter out `undefined`/`null`, set `updated_at: new Date()`.
5. `findOneAndUpdate(...)`, return updated doc.

### 2c. Rewrite DELETE (delete MCP server)

Port from DA `routes/mcp_servers.py:delete_mcp_server()`:

1. Require `id` query param.
2. `findOne({ _id: id })` — 404 if not found.
3. **Config-driven guard** — if `server.config_driven === true`, return 403.
4. `deleteOne({ _id: id })`.
5. Return `successResponse({ deleted: id })`.

### 2d. GET stays as-is

Already local MongoDB.

### 2e. Probe stays proxied to DA

**File**: `ui/src/app/api/mcp-servers/probe/route.ts`

Change: Switch from `Authorization: Bearer` to `X-User-Context` header.

- Import `authenticateRequest` from `@/app/api/v1/chat/_helpers`.
- Replace the Bearer token logic with:
  ```ts
  const auth = await authenticateRequest(request);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.userContextHeader) {
    headers["X-User-Context"] = auth.userContextHeader;
  }
  ```
- Keep the existing `fetch(DYNAMIC_AGENTS_URL/api/v1/mcp-servers/${id}/probe)` call.

### 2f. Remove DA proxy infrastructure from `mcp-servers/route.ts`

- Remove `DYNAMIC_AGENTS_URL` constant.
- Remove Bearer token header construction.
- Remove `fetch()` calls to DA.

---

## Phase 3: Move Config Seeding + Models to Next.js Gateway

### Rationale

Config seeding currently lives in DA (`seed_config.py`), but CRUD is moving to the gateway. Having two services write to the same collections is messy separation of concerns. The gateway should own ALL writes to `dynamic_agents`, `mcp_servers`, and the new `llm_models` collection. DA becomes a pure reader.

### 3a. Create `ui/src/instrumentation.ts`

Next.js `register()` runs once on server startup, before the server handles requests. Same semantics as FastAPI `lifespan`.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/seed-config');
  }
}
```

### 3b. Create `ui/src/lib/seed-config.ts`

Port logic from DA `services/seed_config.py`. This module:

1. Reads `SEED_CONFIG_PATH` env var (or skips if not set — local dev without seeding).
2. Parses the YAML file using `js-yaml` (add as dependency).
3. `${ENV}` expansion is NOT needed — Helm already resolves values before creating the ConfigMap. The raw YAML from the mounted file contains literal values.
   - **Exception**: `docker-compose.dev.yaml` mounts the source `config.yaml` which DOES use `${VAR:-default}` syntax. Port the env var expansion regex to TypeScript for dev compatibility.
4. Upserts agents, MCP servers, and models into MongoDB (same collections: `dynamic_agents`, `mcp_servers`, new `llm_models`).
5. Cleans up stale config-driven entities (same logic as `cleanup_stale_config_driven()`).

Key functions to port:
- `applySeedConfig(configPath?)` — orchestrator
- `seedAgents(agents[])` — upsert with `config_driven: true`, `owner_id: "system"`
- `seedMCPServers(servers[])` — upsert with `config_driven: true`
- `seedModels(models[])` — upsert into `llm_models` collection
- `cleanupStaleConfigDriven(currentServerIds, currentAgentIds, currentModelIds)` — delete stale entries

### 3c. Add `js-yaml` dependency

```bash
cd ui && npm install js-yaml && npm install -D @types/js-yaml
```

This is a well-established, zero-dependency YAML parser (23M weekly downloads, used by ESLint, Prettier, etc.).

### 3d. Move models endpoint to local MongoDB

**File**: `ui/src/app/api/dynamic-agents/models/route.ts`

Currently: Proxies to DA `/api/v1/llm-models`.

After: Reads from `llm_models` collection in MongoDB directly. Same pattern as the existing GET routes.

```ts
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const collection = await getCollection('llm_models');
    const models = await collection.find({}).sort({ name: 1 }).toArray();
    return successResponse(
      models.map((m: any) => ({
        model_id: m.model_id,
        name: m.name,
        provider: m.provider,
        description: m.description ?? '',
      }))
    );
  });
});
```

Remove `DYNAMIC_AGENTS_URL`, Bearer token logic, and `fetch()` proxy.

### 3e. Switch `assistant/suggest` proxy to X-User-Context

**File**: `ui/src/app/api/dynamic-agents/assistant/suggest/route.ts`

Currently uses Bearer token to proxy to DA. Switch to X-User-Context header (same pattern as chat routes and probe).

### 3f. Helm chart changes

**Move seed ConfigMap from DA chart to UI chart:**

1. Create `charts/ai-platform-engineering/charts/caipe-ui/templates/seed-configmap.yaml` — same template as DA's, but under the UI chart.
2. Update `charts/ai-platform-engineering/charts/caipe-ui/templates/deployment.yaml`:
   - Add `SEED_CONFIG_PATH` env var when `seedConfig.enabled`
   - Add volume mount for seed config
   - Add volume definition for seed ConfigMap
3. Add `seedConfig` block to `charts/ai-platform-engineering/charts/caipe-ui/values.yaml` (same structure as DA's).
4. **Remove ALL seed config from DA chart:**
   - Delete `charts/ai-platform-engineering/charts/dynamic-agents/templates/seed-configmap.yaml`
   - Remove `SEED_CONFIG_PATH` env var from DA deployment template
   - Remove `seed-config` volume mount from DA deployment template
   - Remove `seed-config` volume definition from DA deployment template
   - Remove `seedConfig` block from DA chart values

### 3g. Docker-compose changes

**`docker-compose.dev.yaml`:**

- **Remove from `dynamic-agents` service:**
  - `SEED_CONFIG_PATH` env var
  - Any volume mount for `config.yaml` (DA no longer reads it)
- **Add to UI service:**
  ```yaml
  volumes:
    - ./ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/config.yaml:/app/config/seed-config.yaml:ro
  environment:
    SEED_CONFIG_PATH: /app/config/seed-config.yaml
  ```

**`docker-compose.yaml` (production-like):** Check if it sets `SEED_CONFIG_PATH` for DA — if so, remove it. (Currently it does NOT, so likely no change needed.)

**Note**: The `config.yaml` file stays in its current location in the source tree for now. Moving it to a shared location is a follow-up.

---

## Phase 4: Clean Up DA Side

### 4a. Delete `routes/agents.py`

The entire file is dead code. All agent CRUD now lives in the gateway.

### 4b. Strip CRUD from `routes/mcp_servers.py`, keep probe

Remove these endpoints:
- `POST /mcp-servers` (create_mcp_server)
- `GET /mcp-servers` (list_mcp_servers)
- `GET /mcp-servers/{server_id}` (get_mcp_server)
- `PATCH /mcp-servers/{server_id}` (update_mcp_server)
- `DELETE /mcp-servers/{server_id}` (delete_mcp_server)
- `_validate_transport_config()` helper (validation now in gateway)

Keep:
- `POST /mcp-servers/{server_id}/probe` — needs Python MCP client (`probe_server_tools`)
- Router, imports for probe

Switch probe auth from `require_admin` to `get_user_from_gateway` + `user.is_admin` check.

### 4c. Delete `routes/llm_models.py`

Models endpoint now served by gateway from MongoDB.

### 4d. Delete `services/seed_config.py`

Config seeding now lives in Next.js `instrumentation.ts`.

### 4e. Delete `services/models_config.py`

In-memory models cache is no longer used.

### 4f. Delete `services/config.yaml`

The seed config file is no longer consumed by DA. It stays in the source tree at its current path (`ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/config.yaml`) because:
- Docker-compose dev mounts it into the UI container
- It's the source of truth for the default dev model/agent/server list

DA does not mount, read, or reference this file. The mount is removed from DA in Phase 3g.

### 4g. Remove model validation from `routes/assistant.py`

Delete lines 64-71 (the `get_available_models()` check). DA trusts the gateway. If `LLMFactory` gets a bad model_id, it fails with 500 which is correct.

Remove the `from dynamic_agents.services.models_config import get_available_models` import.

### 4h. Clean up `auth/access.py`

Remove `can_view_agent` and `can_use_agent`. Keep `can_access_conversation` (still used by `conversations.py`).

### 4i. Update `main.py`

1. Remove agents router registration: `app.include_router(agents.router, prefix="/api/v1")`
2. Remove agents import
3. Remove llm_models router registration: `app.include_router(llm_models.router, prefix="/api/v1")`
4. Remove llm_models import
5. Remove `apply_seed_config(mongo, settings.seed_config_path)` from `lifespan()`
6. Remove `from dynamic_agents.services.seed_config import apply_seed_config` import
7. Keep mcp_servers router (still has probe endpoint)

### 4j. Clean up `config.py` (Settings)

Remove `seed_config_path` setting — DA no longer reads seed config.

### 4k. Clean up `mongo.py` — remove dead methods

After all route deletions, these `mongo.py` methods have **zero remaining callers** in DA:

| Method | Previous callers | Status |
|--------|-----------------|--------|
| `create_agent` | `routes/agents.py` (deleted) | **Delete** |
| `update_agent` | `routes/agents.py` (deleted) | **Delete** |
| `create_server` | `routes/mcp_servers.py` (deleted) | **Delete** |
| `update_server` | `routes/mcp_servers.py` (deleted) | **Delete** |
| `upsert_agent` | `seed_config.py` (deleted) | **Delete** |
| `upsert_server` | `seed_config.py` (deleted) | **Delete** |
| `list_agents` | `routes/agents.py` (deleted) | **Delete** |
| `list_all_agents` | `seed_config.py` (deleted) | **Delete** |
| `list_servers` | `routes/mcp_servers.py` (deleted), `seed_config.py` (deleted) | **Delete** |
| `_slugify` | `create_agent` (deleted) | **Delete** |
| `RESERVED_AGENT_SLUGS` | `create_agent` (deleted) | **Delete** |

Methods that **stay** (still have callers in chat.py, conversations.py, agent_runtime.py, mcp_servers.py probe):

| Method | Remaining callers |
|--------|------------------|
| `get_agent` | chat.py (5), conversations.py (7), agent_runtime.py (1) |
| `get_servers_by_ids` | chat.py (3), conversations.py (6) |
| `get_server` | mcp_servers.py probe (1) |
| `delete_agent` | **None** — was called by seed_config.py cleanup. **Delete.** |
| `delete_server` | **None** — was called by seed_config.py cleanup. **Delete.** |
| `connect` / `disconnect` / `_ensure_indexes` | main.py lifespan |

### 4l. Update `routes/__init__.py`

Remove `agents` and `llm_models` from imports and `__all__`.

---

## Phase 5: Verification

### 5a. UI build
```bash
cd ui && npm run build
```
Must pass with no type errors.

### 5b. DA tests — run ALL tests
```bash
cd ai_platform_engineering/dynamic_agents && uv run pytest tests/ -v
```
Must pass. Any tests exercising deleted routes/functions must be removed or updated.

### 5c. Slack bot tests
```bash
cd ai_platform_engineering/integrations/slack_bot && uv run --group unittest pytest tests/ -v --ignore=tests/test_ai.py -x
```
Must pass (166 tests). Slack bot doesn't call agent CRUD.

### 5d. Ruff (Slack bot)
```bash
cd ai_platform_engineering/integrations/slack_bot && uv run --with ruff ruff check
```

### 5e. Ruff (DA)
```bash
cd ai_platform_engineering/dynamic_agents && uv run ruff check
```
Check for unused imports after all deletions.

---

## Commit Plan

| # | Scope | Message |
|---|-------|---------|
| 1 | `feat(ui)` | `feat(ui): move agent CRUD from DA proxy to local MongoDB` |
| 2 | `feat(ui)` | `feat(ui): move MCP server CRUD from DA proxy to local MongoDB` |
| 3 | `feat(ui)` | `feat(ui): add config seeding via instrumentation.ts` |
| 4 | `feat(ui)` | `feat(ui): move models endpoint and suggest proxy to local MongoDB + X-User-Context` |
| 5 | `refactor(dynamic-agents)` | `refactor(dynamic-agents): remove config seeding, agent routes, models endpoint — DA is now pure runtime` |
| 6 | `chore` | `chore: move seed ConfigMap from DA to UI in Helm + docker-compose` |

Each commit must pass its respective quality gates.

---

## Risk Assessment

1. **Schema drift** — TS types already match MongoDB document shape. Risk: low.

2. **Subagent visibility validation is now TypeScript-only** — Gateway is the only writer. Risk: none.

3. **Reserved slugs list divergence** — Duplicated in TS. After migration DA no longer does slug checks. Risk: low.

4. **Probe auth change** — Same pattern as chat routes (X-User-Context). Risk: low.

5. **Config seeding timing** — `register()` runs before the server handles requests (per Next.js docs). Same guarantee as FastAPI `lifespan`. Risk: low.

6. **`js-yaml` dependency** — 23M weekly npm downloads, zero deps, used by ESLint/Prettier. Risk: none.

7. **`${ENV}` expansion in dev** — Docker-compose mounts raw `config.yaml` which uses `${VAR:-default}` syntax. Must port the regex expander to TypeScript. Risk: low (simple regex, well-tested in Python).

8. **Field injection via request body** — Mitigated by explicit field allowlists. `is_system`, `config_driven`, `owner_id` always server-controlled. Risk: none.

9. **Config seeding unaffected by CRUD migration order** — Seeding uses upsert (idempotent). Even if gateway and DA both seed during migration, they produce identical results. Risk: none.

10. **DA mongo.py cleanup** — Methods with zero callers deleted. Methods with surviving callers kept. Verified via exhaustive call-site analysis. Risk: low.
