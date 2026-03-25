# Research: Integrated Skills — Single Source, Chat Commands, Skill Hubs

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-18

## 1. Single Catalog vs Existing Collections (agent_skills, task_configs)

**Decision**: Introduce a dedicated **skill catalog** (e.g. `skills` or `skill_catalog` collection) as the single source of truth for “skills available to the assistant and UI.” Optionally map or sync from existing `agent_skills` and filesystem templates into this catalog so the UI and supervisor both read from one logical store.

**Rationale**: The spec requires one shared catalog. Today the UI uses (1) `/api/skill-templates` (filesystem) and (2) `/api/agent-skills` (MongoDB) for the gallery; the supervisor uses `task_configs` for workflow definitions. Unifying under one catalog avoids divergence: a single API (e.g. `GET /api/skills` or backend equivalent) returns the merged list. Existing `agent_skills` can be treated as one source that is ingested into the catalog (or the catalog can be populated from agent_skills + filesystem + hubs). No requirement to delete agent_skills; they can remain the storage for user-created “Agent Skills” and be projected into the catalog.

**Alternatives considered**:
- Use only `task_configs` as the catalog: Task configs are workflow-oriented and may not align 1:1 with agentskills.io skill format; supervisor already uses them for task routing. Keeping a distinct catalog keeps “skill” as a first-class concept and allows hubs to contribute without touching task_configs. Rejected.
- Use only `agent_skills`: Those documents are UI-centric (owner_id, visibility). The assistant needs a unified view that includes built-in and hub-sourced skills. A single catalog that aggregates agent_skills + built-ins + hubs is clearer. Chosen.

---

## 2. LangGraph “Skills Middleware” Pattern

**Decision**: Implement a **skills middleware** component in Python that (1) loads the merged skill catalog from MongoDB (and optional filesystem/ConfigMap for built-ins), (2) fetches and merges skills from registered hubs (e.g. GitHub), (3) exposes the resulting list (and optionally skill content) to the platform engineer / supervisor. The supervisor (or its graph builder) calls this middleware at graph build time or at request time to get the current skill list and inject it into the prompt or as tool metadata so the LLM can choose skills.

**Rationale**: The spec says “supervisor reading the skill from MongoDB and using LangGraph skills middleware.” There is no existing “skills middleware” in the repo; the supervisor today uses `task_config` from MongoDB for task definitions. The middleware is the new layer that aggregates catalog + hubs and provides a single API (in-process or HTTP) for “list skills” / “get skill by id.” The supervisor’s deep agent (e.g. `deep_agent_single.py`) already loads task config; it will be extended to load skills from this middleware (e.g. `get_available_skills()`) and include them in the system prompt or tool descriptions.

**Alternatives considered**:
- MCP server for skills: Could expose skills as MCP tools. Adds network hop and another server; the supervisor is in-process with the middleware. Rejected for v1; can add later if other consumers need MCP.
- No middleware, supervisor reads MongoDB directly: Would duplicate hub-fetch and merge logic in the supervisor. Middleware centralizes catalog + hub logic and keeps supervisor focused on orchestration. Chosen.

---

## 3. Skill Hub Format (e.g. GitHub)

**Decision**: Support **GitHub (public or private) repositories** as the first hub type. A hub is registered with a repository identifier (e.g. `owner/repo` or full URL). The middleware (or a backend job) clones or fetches the repo (or uses GitHub API to read files), discovers skills using a convention: e.g. each directory under `skills/` (or repo root) containing a `SKILL.md` is one skill. Skill ID = directory name or frontmatter `name`. Format: SKILL.md with YAML frontmatter; support both [agentskills.io](https://agentskills.io/specification) and OpenClaw-style (e.g. `name`, `description`, `metadata`). See §8 for ClawHub out-of-scope.

**Rationale**: Spec calls out “GitHub or public GitHub” for skill hubs. Repos are a natural fit for versioned, reviewable skill packs. Private repos require credentials (e.g. GitHub token) stored securely (env or secrets manager), not in source.

**Alternatives considered**:
- HTTP URL to a ZIP or JSON manifest: Flexible but less standard; GitHub is widely used and supports access control. Chosen: GitHub first; other hub types (URL, ZIP) can be added later.
- Single SKILL.md per repo: One skill per repo is heavy. Convention: multiple skills per repo under a known path (e.g. `skills/*/SKILL.md`). Chosen.

---

## 4. /skills Chat Command Handling

**Decision**: **Client-side detection** of the `/skills` command in the chat input. When the user sends a message that is exactly `/skills` (or the agreed slash-command), the client does not send it as a normal user message to the assistant. Instead, the client calls the shared catalog API (e.g. `GET /api/skills`) and renders the list of skills in the chat UI as a bot-like message (e.g. “Here are the skills available to the assistant: …”). No A2A round-trip for listing skills; the list is the same as the one the assistant uses (same API/catalog).

**Rationale**: Keeps chat UX simple and fast; avoids wasting an LLM turn for a static list. The spec says “when they enter the agreed command (e.g. `/skills`), the system shows the list” and “the list is consistent with the central catalog.” Using the same catalog API for both the chat command and the assistant guarantees consistency.

**Alternatives considered**:
- Server-side: Assistant receives “/skills” and calls a tool to get the list, then streams it. Works but uses one turn and more latency. Client-side list is cheaper and deterministic. Chosen: client-side.
- Separate “skills” panel outside chat: Spec explicitly asks for in-chat command. Chosen: in-chat.

---

## 5. Duplicate Skill ID Precedence

**Decision**: Apply a **deterministic precedence** when multiple sources (default catalog, hub A, hub B) define a skill with the same identifier. Order: (1) **Default / built-in** (filesystem or MongoDB catalog) wins over hubs. (2) Among hubs, **registration order** (e.g. earlier-registered hub wins) or **explicit priority** field if we add it. Document the rule in data-model and admin UI so admins can avoid or control conflicts.

**Rationale**: Spec requires “deterministic, documented resolution rule.” First-registered or default-first is easy to implement and reason about; we can add a numeric priority later if needed.

**Alternatives considered**:
- Last-write-wins: Non-deterministic across restarts. Rejected.
- Require unique IDs across all sources: Too strict; orgs may want to override a default skill with a hub. Precedence is chosen.

---

## 6. Removal of “Run Skills” in Chat

**Decision**: Remove any flow that “runs a skill” directly from the chat input (e.g. a button or action in the chat panel that launches the SkillsRunner or sends a special “run skill” payload). Skill execution is driven only by the assistant using the shared catalog: the user asks in natural language, and the assistant chooses and invokes skills. The **Skills page** can retain “run” from the gallery (user selects a skill and runs it in the SkillsRunner) as a separate UX from chat; the spec only forbids “run skills in the chat.” So: no “run skill” inside the chat window; Skills tab can still run a selected skill in the runner view.

**Rationale**: Spec: “no more run skills in the chat,” “skill use is driven by the assistant via the shared catalog.” So chat does not offer a dedicated “run skill” action; discovery is via `/skills` and execution is via conversation.

**Alternatives considered**:
- Remove all “run” from Skills page: Spec does not say to remove the Skills runner, only from chat. Retain Skills page run. Chosen.

---

## 7. Graceful Degradation and Hub Failures

**Decision**: If the central catalog is unavailable (e.g. MongoDB down), the `/api/skills` response and the middleware return a clear “skills temporarily unavailable” (or 503) and the chat shows a non-technical message; chat remains usable for non-skill interactions. If a hub fails to load (network, auth, malformed content), the middleware logs the error, skips that hub’s skills for that refresh, and returns the rest of the catalog; optionally report “hub X failed to load” in admin or in the API response for debugging.

**Rationale**: Spec FR-008 and edge cases: partial catalog availability and clear feedback. No silent full-catalog failure when one hub fails.

---

## 8. Skill Format: Anthropic/agentskills.io and OpenClaw-style; ClawHub Out of Scope

**Decision**: When loading skills from hubs (e.g. GitHub), the system MUST accept SKILL.md files in both **Anthropic/agentskills.io-style** and **OpenClaw-style** format (YAML frontmatter + markdown body). **ClawHub** (OpenClaw marketplace) as a hub source is **out of scope for v1** (risk/complexity); document as a future option.

**Rationale**: Spec FR-011 and clarifications: users want to support both Anthropic skills and OpenClaw-style SKILL.md so that repos can contain either format. Both use `name` and `description` in frontmatter; OpenClaw adds `metadata` (e.g. clawdbot schema). Parsers should accept both and normalize to the catalog Skill shape. ClawHub as a dedicated hub type (API or URL) is deferred due to risk and scope.

**Alternatives considered**:
- Agentskills.io only: Would exclude OpenClaw-format skills in GitHub hubs. Rejected per user clarification.
- ClawHub in scope: Adds dependency on external marketplace and auth; higher risk. Deferred to post-v1.

---

## 9. Supervisor Catalog Refresh: Hot Reload or UI Trigger

**Decision**: The CAIPE supervisor MUST reflect catalog updates (new skills, new hubs, changes to **agent-skills** documents / `source: agent_skills`) without restart. Implement either **hot reload** (e.g. on each catalog read or short TTL cache) or a **UI-triggered refresh** (e.g. "Refresh skills" button or automatic trigger after onboarding a hub). At least one of these mechanisms is required (FR-012).

**Rationale**: Spec and clarifications require runtime-updated skills in the supervisor; hot reload keeps the catalog fresh with no user action; a UI trigger gives explicit control after hub onboarding. Either satisfies the requirement.

**Alternatives considered**:
- Restart supervisor on catalog change: Rejected; spec explicitly requires no restart.
- Polling only from UI: Acceptable as the "UI trigger" option (e.g. UI calls a refresh endpoint that invalidates middleware cache so next supervisor read gets fresh data).

---

## 10. Upstream `deepagents.middleware.skills.SkillsMiddleware` for System Prompt Injection

**Decision**: Use the upstream `deepagents.middleware.skills.SkillsMiddleware` (from `deepagents>=0.3.8`, already a project dependency) for injecting skills into the supervisor's system prompt. The custom catalog layer (`ai_platform_engineering/skills_middleware/`) remains responsible for aggregation, precedence, hub fetching, dual-format parsing, and hot reload. The catalog layer writes the merged skill set into the `SkillsMiddleware`'s backend (e.g. `StateBackend`) so the upstream middleware handles prompt formatting and progressive disclosure.

**Rationale**: The project already uses `deepagents` extensively — `create_deep_agent()`, `PolicyMiddleware`, `DeterministicTaskMiddleware`, `CallToolWithFileArgMiddleware`, `SelfServiceWorkflowMiddleware`, and `SubAgentMiddleware` are all in use. `SkillsMiddleware` is the upstream's standard mechanism for skill system prompt injection and follows the [Agent Skills specification](https://agentskills.io/specification). Key upstream capabilities we leverage:

1. **Progressive disclosure**: Lists skill name/description in prompt; agent reads full SKILL.md on demand via backend `download_files()`.
2. **YAML frontmatter parsing**: `_parse_skill_metadata()` handles both agentskills.io fields (`name`, `description`, `license`, `compatibility`, `allowed-tools`, `metadata`) and OpenClaw-style SKILL.md (same YAML frontmatter structure with `metadata` dict).
3. **System prompt section**: The `SKILLS_SYSTEM_PROMPT` template and `modify_request()` / `wrap_model_call()` hooks inject a standardized "Skills System" section.
4. **Source layering**: Skills loaded from multiple sources; later sources override earlier (last wins by name).
5. **`before_agent` / `abefore_agent`**: Load skills once per session (or per state reset), caching in `skills_metadata` private state.
6. **Backend abstraction**: Works with `StateBackend`, `FilesystemBackend`, or any `BackendProtocol` implementation — no direct filesystem access needed.

**Integration approach**:

- The catalog layer's `get_merged_skills()` produces a list of normalized skill dicts.
- At agent build time (or on hot reload), the catalog layer writes SKILL.md files into the `StateBackend` under source paths (e.g. `/skills/default/`, `/skills/hub-github-org-repo/`).
- `SkillsMiddleware` is added to the supervisor's middleware list with `sources=["/skills/default/", "/skills/hub-<id>/", ...]` and `backend=lambda rt: StateBackend(rt)`.
- The middleware's `abefore_agent()` loads skill metadata from the backend; `awrap_model_call()` injects the Skills System section into the system prompt.
- For hot reload (FR-012): clear `skills_metadata` from state (or rebuild the agent) to force the middleware to re-read from the backend on the next invocation.

**What the custom catalog layer still does** (not delegated to upstream):

| Responsibility | Why not upstream |
|---|---|
| MongoDB/agent_skills loading | Upstream only reads from backend storage paths |
| GitHub hub fetching | Upstream has no hub concept |
| Dual SKILL.md format normalization (FR-011) | Upstream validates agentskills.io strictly; we need OpenClaw compat |
| Precedence rules (default > agent_skills > hub) | Upstream uses last-wins; we need explicit precedence |
| Hot reload / TTL cache (FR-012) | Upstream loads once per session; we manage cache invalidation |
| REST API for UI catalog (`GET /api/skills`) | Upstream is in-process only |

**Alternatives considered**:

- Custom system prompt injection (no SkillsMiddleware): Would duplicate upstream's progressive disclosure logic, system prompt template, and YAML parsing. Rejected — upstream already does this well and is maintained.
- Full upstream-only (no custom catalog layer): Upstream has no MongoDB, hub, or precedence support. Would require forking or extending upstream substantially. Rejected for v1.

---

## 11. Supervisor Graph Reload, Cache Refresh, Observability, Hub Crawl (2026-03-23)

**Decision (reload semantics)**: A **new** compiled deep agent is created on every `AIPlatformEngineerMAS._build_graph()` call: at **startup** and when **`platform_registry`** fires **`_on_agents_changed`** → **`_rebuild_graph()`**. Skills are re-merged via **`get_merged_skills()`** inside `_build_graph()`. **`POST /skills/refresh`** MUST **invalidate the catalog cache** and **trigger a MAS rebuild** (e.g. invoke `_rebuild_graph()` through a process-wide or app-held reference to the active `AIPlatformEngineerMAS`), so in-process `_skills_files` / `_skills_sources` match the refreshed catalog (FR-012, spec Supervisor runtime reference).

**Rationale**: Cache-only refresh leaves the supervisor serving stale prompt injection; FR-016 and SC-007 require operators to see alignment between “refreshed catalog” and “what the supervisor loaded.”

**Alternatives considered**:
- Per-request `get_merged_skills` without rebuild: Would fight `SkillsMiddleware` / graph holding static sources at build time; rebuild is the straightforward fix for v1.
- Restart pod on every hub change: Rejected by spec (no restart).

**Decision (observability)**: Expose **`graph_generation`**, **`skills_loaded_count`**, and **`skills_merged_at`** (or equivalent) via an authenticated status endpoint or enriched existing status JSON (FR-016). See `contracts/supervisor-skills-status.md`.

**Decision (hub crawl UI)**: Provide a **crawl/preview** API (e.g. `POST /api/skill-hubs/crawl` with `type`, `location`, optional credentials) that returns discovered **`SKILL.md` paths** (and optionally parsed names) **without** persisting the hub, so the admin UI can preview before **POST /api/skill-hubs** (FR-017). Reuse the same GitHub discovery logic as full hub fetch; enforce auth and rate limits.

**Alternatives considered**:
- Preview only in UI with client-side GitHub API: Would duplicate secrets handling and CORS; server-side crawl preferred.

---

## 12. Try Skills Gateway and Catalog API Keys (2026-03-24)

**Decision**: Expose a **Try skills gateway** in the UI (FR-018) documenting the same catalog HTTP contract as the app uses, with **two** auth paths to the Python catalog: (1) **Okta/OIDC JWT** (existing JWKS validation, FR-014), (2) **scoped catalog API keys** for automation — keys stored as **hashes** with `key_id`, owner, revocation; transmitted via a **single documented** header/scheme (see `contracts/gateway-api.md`).

**Rationale**: Enterprise users expect Okta; integrators and scripts need long-lived, revocable credentials that are not end-user passwords. Aligns with SC-008.

**Alternatives considered**:
- JWT only: Blocks simple `curl` automation without a token broker. Rejected as sole option.
- Pat tokens in query string: Leak via logs/referrers. Rejected.

---

## 13. Visibility: Global, Team, Personal (2026-03-24)

**Decision**: Every catalog entry carries `visibility` ∈ {`global`, `team`, `personal`} plus optional `team_ids` and `owner_user_id`. Effective set for a principal = **union** of: all `global` skills; `team` skills where `team_ids` ∩ caller’s teams ≠ ∅; `personal` skills where `owner_user_id` = caller. Enforced in **Python catalog layer** before UI, gateway, `/skills` client, and **before** writing entitled subset into `StateBackend` for the supervisor session (FR-015, FR-020).

**Rationale**: Spec Session 2026-03-24; avoids leaking cross-team or private skills through a shared merge blob.

**Alternatives considered**:
- Visibility only in UI: Supervisor would still see all merged skills. Rejected.
- RBAC only (no personal): Does not meet product ask. Rejected.

**Team membership source**: Use existing IdP claims (e.g. `groups`, custom claim) or userinfo document already fetched for RAG; document claim → `team_id` mapping in implementation.

---

## 14. Skill-Scanner Integration (2026-03-24)

**Decision**: Run **[cisco-ai-defense/skill-scanner](https://github.com/cisco-ai-defense/skill-scanner)** on **hub-fetched** skill trees before merge; optionally on default packaged skills in CI. Persist findings (`skill_scan_findings`); default gate **warn** on high, **block** on critical (configurable strict mode). UI and docs repeat upstream disclaimer: **no findings ≠ safe**.

**Rationale**: Constitution VI (“security-scanned before adoption”); FR-023, SC-009.

**Alternatives considered**:
- Custom regex only: Lower coverage; reuse industry-facing scanner. Rejected as sole control.
- Block all LLM analyzer in CI: Use static/YARA/pipeline/behavioral in CI; LLM optional in controlled env.

---

## 15. Large Catalogs and Prompt Bounds (2026-03-24)

**Decision**: **Unbounded** storage of skills is OK; **prompt** is not. Combine (1) upstream **progressive disclosure** (FR-015), (2) **cap** `MAX_SKILL_SUMMARIES_IN_PROMPT` (config, e.g. 50–200) or task-relevance subset if/when retrieval exists, (3) **paginated** catalog API (§catalog-api). Only top-N (or selected) skill metadata lines appear in the injected “Skills System” section; remainder discoverable via tool/read_skill paths the middleware already supports.

**Rationale**: FR-024; prevents linear token growth with thousands of skills.

**Alternatives considered**:
- Inject all descriptions: Fails FR-024. Rejected.
- Separate “active skill pack” per conversation: Possible future enhancement; v1 uses global cap + entitlement filter.

---

## 16. Catalog source tag `agent_skills` and loader alignment (FR-025, 2026-03-26; rename completed)

**Decision**: MongoDB **`agent_skills`**, the **`agent_skills` loader**, and catalog **`source: agent_skills`** are the **only** conceptual model for user/agent-authored skills (**FR-025** completed: former catalog source naming is fully aligned on **`agent_skills`**). UI routes, components, and copy match this model (same persistence, same API semantics). Use **dual-read** or a one-time migration for any legacy field shapes; do **not** change merge precedence (default > agent_skills > hub among sources) or visibility rules without a spec amendment.

**Rationale**: Reduces duplicate mental models and drift between “agent skills” pages and catalog `source` labels (**FR-021**).

**Alternatives considered**:
- New collection only for UI: Duplicates `agent_skills`. Rejected.
- Rename Mongo collection in v1: High migration risk; prefer aliasing at API/UI layer first.

---

## 17. Gateway–supervisor skills sync status (FR-026, SC-010, 2026-03-26)

**Decision**: Expose a **composed sync view** to authorized operators comparing (1) **catalog line**: `catalog_cache_generation` (and optionally last HTTP cache refresh time) from the skills middleware / `GET /skills` lineage, with (2) **supervisor line**: `graph_generation`, `skills_loaded_count`, `skills_merged_at` from the same process (see `contracts/supervisor-skills-status.md`). Derive **`sync_status`**: `in_sync` when generations match (and optional count sanity check), `supervisor_stale` when catalog generation > last graph build’s paired generation (or cache refreshed after `skills_merged_at`), `unknown` when either side is unavailable. Surface in **Try skills gateway** UI (FR-018) with short operator copy (“Refresh skills” / “Supervisor reloading”). Optionally reuse the same payload in admin observability (**FR-016**) without duplicating conflicting numbers.

**Rationale**: Prevents the UX lie that `GET /skills` always reflects what the assistant already injected after hub or config changes.

**Alternatives considered**:
- Poll-only UI heuristic (compare timestamps without server field): Fragile across replicas. Rejected.
- Separate microservice for sync: Over-engineering; supervisor and catalog share a process in default deployment.

---

## 18. Skill Scanner third-party attribution (FR-023, SC-009, 2026-03-27)

**Decision**: Treat **[Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner)** as **provided by Cisco AI Defense**. Product documentation, repo **NOTICE** / third-party credit files (where maintained), and **admin UI** that names or summarizes scanning MUST include that attribution and the repository URL **https://github.com/cisco-ai-defense/skill-scanner**, in addition to the existing **no findings ≠ safe** disclaimer ([upstream scope](https://github.com/cisco-ai-defense/skill-scanner)).

**Rationale**: License and good-faith credit to the upstream project team; aligns with spec Session 2026-03-27.

**Alternatives considered**:
- Link only, no vendor name: Fails explicit “provided by Cisco AI Defense” ask. Rejected.

---

## 19. skill-scanner install (T059, 2026-03-24)

**Decision**: Keep the **Skill Scanner** CLI **out of the default workspace lockfile** so supervisor installs stay lean. Use an explicit install when running scans:

```bash
uv pip install cisco-ai-skill-scanner
```

The `skill-scanner` executable on `PATH` is what `scripts/scan-packaged-skills.sh` and `ai_platform_engineering.skills_middleware.skill_scanner_runner` invoke.

---

## 20. Scanner on agent-skills save/publish (FR-027, 2026-03-28)

**Decision**: When a user creates or updates an agent-skills document with `skill_content`, invoke the **skill-scanner** CLI **synchronously** during the save request. The document is **always persisted** to MongoDB, but with a `scan_status` field:

- **`passed`**: scanner ran successfully, no findings met the severity threshold.
- **`flagged`**: scanner ran and findings met `SKILL_SCANNER_FAIL_ON` severity under `SKILL_SCANNER_GATE=strict`.
- **`unscanned`**: scanner binary unavailable, `skill_content` absent, or scanner call failed.

Under `SKILL_SCANNER_GATE=strict`, the **`agent_skills` catalog loader** excludes `scan_status: "flagged"` documents from the merged catalog so they do not enter the supervisor's skill set or the UI catalog. The save response includes `scan_status` (and optionally `scan_summary`) so the UI can inform the user immediately.

**Implementation path**: A new FastAPI endpoint `POST /skills/scan-content` accepts `{name, content}`, materializes a single-skill temp tree, runs `skill_scanner_runner.run_scan_all_on_directory`, applies gate/threshold logic, and returns the result. The Next.js `agent-skills` route calls this endpoint before persisting. Scan findings are written to `skill_scan_findings` with `source_type: "agent_skills"` and `source_id` = document id (reusing the same collection as hub scan findings).

**Rationale**: Extends the hub-ingest scanner gate (§14) to user-authored skills. Users get immediate feedback; admins retain visibility via `skill_scan_findings`. Persist-but-flag avoids data loss while maintaining security posture under strict gate.

**Alternatives considered**:
- **Async scan (background job)**: Saves immediately, scans later. Simpler save path but requires polling/notifications for result, more complex UI state, and a window where unscanned content enters the catalog. Rejected for v1 given single-skill scans complete in seconds.
- **Reject save on scan failure**: Config is not persisted at all. User loses work if they cannot pass scanning; no admin review path. Rejected — persist-but-flag is strictly better for UX and auditability.
- **Persist and warn only (no catalog exclusion)**: Config enters catalog regardless; scan result is informational. Does not meet the "strict gate" security requirement. Rejected as the default; effectively what `SKILL_SCANNER_GATE=warn` already provides.

---

## Summary Table

| Topic | Decision |
|-------|----------|
| Catalog vs agent_skills/task_configs | New shared catalog (e.g. `skills` collection); aggregate from agent_skills + built-ins + hubs |
| LangGraph skills middleware | New Python component: load catalog + hubs, expose list (and content) to supervisor at build/request time |
| Hub format | GitHub repo; convention e.g. `skills/*/SKILL.md`; parse both agentskills.io and OpenClaw-style SKILL.md |
| ClawHub | Out of scope for v1; document as future hub source |
| /skills command | Client-side: detect `/skills`, call catalog API, render list in chat (no A2A for list) |
| Duplicate skill ID | Default/built-in wins; then hub registration order (or explicit priority) |
| Run skills in chat | Remove; assistant-only execution from catalog; Skills page runner retained |
| Catalog/hub failure | Graceful “unavailable” message; per-hub failures skip that hub, rest of catalog still served |
| Supervisor catalog refresh | Hot reload (per-request or short TTL) or UI-triggered refresh; no restart required (FR-012) |
| System prompt injection | Use upstream `deepagents.middleware.skills.SkillsMiddleware` for progressive disclosure; custom catalog layer feeds skills into `StateBackend` (FR-015) |
| Supervisor refresh + observability | `POST /skills/refresh` invalidates cache **and** triggers MAS `_rebuild_graph`; status exposes generation, count, timestamp (FR-012, FR-016) |
| Hub crawl | Server-side crawl/preview endpoint before hub registration (FR-017) |
| Try skills gateway | UI docs + JWT or catalog API key; same catalog contract ([gateway-api.md](./contracts/gateway-api.md)) |
| Visibility | global / team / personal; union entitlement; enforce in catalog layer + supervisor feed |
| Skill-scanner | Hub ingest + optional CI; persisted findings; configurable gate; **Cisco AI Defense attribution** in docs/UI/NOTICE ([skill-scanner-pipeline.md](./contracts/skill-scanner-pipeline.md)) |
| Prompt bounds | Cap skill summaries in prompt; pagination + search on API; full SKILL.md on demand only |
| Catalog source tag + collection (FR-025) | Single model: MongoDB `agent_skills` + `source: agent_skills`; refactor UI/routes; backward-compatible reads/migration |
| Gateway–supervisor sync (FR-026) | Compare `catalog_cache_generation` vs `graph_generation` (+ timestamps); `in_sync` / `supervisor_stale` / `unknown` in Try skills gateway |
| Scanner on agent-skills save (FR-027) | Sync scan on save; persist always with `scan_status` (`passed` / `flagged` / `unscanned`); strict gate excludes flagged from catalog; findings in `skill_scan_findings` with `source_type: "agent_skills"` |
| Multi-file skills (FR-028) | Skills may contain ancillary files (scripts, references, assets) alongside SKILL.md per agentskills.io spec. Hub skills fetch the full directory tree. Agent-skills documents support file upload and GitHub fetch-and-snapshot import. 5 MB soft limit for agent-skills documents; no limit for hubs. All files written to StateBackend for agent access via FilesystemMiddleware. |
