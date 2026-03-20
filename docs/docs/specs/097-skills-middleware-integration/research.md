# Research: Integrated Skills — Single Source, Chat Commands, Skill Hubs

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-18

## 1. Single Catalog vs Existing Collections (agent_configs, task_configs)

**Decision**: Introduce a dedicated **skill catalog** (e.g. `skills` or `skill_catalog` collection) as the single source of truth for “skills available to the assistant and UI.” Optionally map or sync from existing `agent_configs` and filesystem templates into this catalog so the UI and supervisor both read from one logical store.

**Rationale**: The spec requires one shared catalog. Today the UI uses (1) `/api/skill-templates` (filesystem) and (2) `/api/agent-configs` (MongoDB) for the gallery; the supervisor uses `task_configs` for workflow definitions. Unifying under one catalog avoids divergence: a single API (e.g. `GET /api/skills` or backend equivalent) returns the merged list. Existing `agent_configs` can be treated as one source that is ingested into the catalog (or the catalog can be populated from agent_configs + filesystem + hubs). No requirement to delete agent_configs; they can remain the storage for user-created “Agent Skills” and be projected into the catalog.

**Alternatives considered**:
- Use only `task_configs` as the catalog: Task configs are workflow-oriented and may not align 1:1 with agentskills.io skill format; supervisor already uses them for task routing. Keeping a distinct catalog keeps “skill” as a first-class concept and allows hubs to contribute without touching task_configs. Rejected.
- Use only `agent_configs`: Agent configs are UI-centric (owner_id, visibility). The assistant needs a unified view that includes built-in and hub-sourced skills. A single catalog that aggregates agent_configs + built-ins + hubs is clearer. Chosen.

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

**Decision**: The CAIPE supervisor MUST reflect catalog updates (new skills, new hubs, agent_config changes) without restart. Implement either **hot reload** (e.g. on each catalog read or short TTL cache) or a **UI-triggered refresh** (e.g. "Refresh skills" button or automatic trigger after onboarding a hub). At least one of these mechanisms is required (FR-012).

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
| MongoDB/agent_config loading | Upstream only reads from backend storage paths |
| GitHub hub fetching | Upstream has no hub concept |
| Dual SKILL.md format normalization (FR-011) | Upstream validates agentskills.io strictly; we need OpenClaw compat |
| Precedence rules (default > agent_config > hub) | Upstream uses last-wins; we need explicit precedence |
| Hot reload / TTL cache (FR-012) | Upstream loads once per session; we manage cache invalidation |
| REST API for UI catalog (`GET /api/skills`) | Upstream is in-process only |

**Alternatives considered**:

- Custom system prompt injection (no SkillsMiddleware): Would duplicate upstream's progressive disclosure logic, system prompt template, and YAML parsing. Rejected — upstream already does this well and is maintained.
- Full upstream-only (no custom catalog layer): Upstream has no MongoDB, hub, or precedence support. Would require forking or extending upstream substantially. Rejected for v1.

---

## Summary Table

| Topic | Decision |
|-------|----------|
| Catalog vs agent_configs/task_configs | New shared catalog (e.g. `skills` collection); aggregate from agent_configs + built-ins + hubs |
| LangGraph skills middleware | New Python component: load catalog + hubs, expose list (and content) to supervisor at build/request time |
| Hub format | GitHub repo; convention e.g. `skills/*/SKILL.md`; parse both agentskills.io and OpenClaw-style SKILL.md |
| ClawHub | Out of scope for v1; document as future hub source |
| /skills command | Client-side: detect `/skills`, call catalog API, render list in chat (no A2A for list) |
| Duplicate skill ID | Default/built-in wins; then hub registration order (or explicit priority) |
| Run skills in chat | Remove; assistant-only execution from catalog; Skills page runner retained |
| Catalog/hub failure | Graceful “unavailable” message; per-hub failures skip that hub, rest of catalog still served |
| Supervisor catalog refresh | Hot reload (per-request or short TTL) or UI-triggered refresh; no restart required (FR-012) |
| System prompt injection | Use upstream `deepagents.middleware.skills.SkillsMiddleware` for progressive disclosure; custom catalog layer feeds skills into `StateBackend` (FR-015) |
