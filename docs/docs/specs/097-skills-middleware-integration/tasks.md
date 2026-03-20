# Tasks: Integrated Skills with Single Source, Chat Commands, and Skill Hubs

**Input**: Design documents from `docs/docs/specs/097-skills-middleware-integration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `ai_platform_engineering/skills_middleware/`, `ai_platform_engineering/multi_agents/`
- **UI**: `ui/src/app/api/`, `ui/src/components/chat/`, `ui/src/components/skills/`, `ui/src/app/(app)/skills/`
- **Integration**: `integration/`, `tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package layout, MongoDB collection for hubs, and configuration for the skills catalog.

- [X] T001 Create skills_middleware package layout: `ai_platform_engineering/skills_middleware/__init__.py`, `catalog.py`, `precedence.py`, `backend_sync.py`, `loaders/__init__.py` (placeholders per plan)
- [X] T002 [P] Add or document MongoDB `skill_hubs` collection and indexes (id unique, enabled, type) in backend or UI MongoDB setup
- [X] T003 [P] Document env vars for skills (e.g. SKILLS_DIR, optional BACKEND_SKILLS_URL) in repo env.example or docs per plan

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core catalog merge logic, precedence, backend catalog API, Next.js GET /api/skills, and supervisor integration with hot reload or UI-triggered refresh. Must be complete before any user story implementation.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Implement default skill loader (read SKILLS_DIR / chart data/skills; parse both agentskills.io and OpenClaw-style SKILL.md frontmatter per FR-011) in `ai_platform_engineering/skills_middleware/loaders/default.py`
- [X] T005 [P] Implement agent_configs loader (read from MongoDB, project to Skill shape with source `agent_config`) in `ai_platform_engineering/skills_middleware/loaders/agent_config.py`
- [X] T006 Implement precedence and merge (default > agent_config > hub; among hubs by registration order; stable output) in `ai_platform_engineering/skills_middleware/precedence.py`
- [X] T007 Implement `get_merged_skills(include_content: bool = False)` returning list of skill dicts per contracts/catalog-api.md in `ai_platform_engineering/skills_middleware/catalog.py`
- [X] T007a [P] Implement `write_skills_to_backend(skills, backend)` that writes normalized skills as SKILL.md files into `StateBackend` paths (e.g. `/skills/default/<skill-name>/SKILL.md`, `/skills/hub-<id>/<skill-name>/SKILL.md`) so `SkillsMiddleware` can discover and parse them via its `before_agent` hook in `ai_platform_engineering/skills_middleware/backend_sync.py`
- [X] T008 Expose GET endpoint that returns merged skills JSON (e.g. GET /skills or /internal/skills) in the backend — e.g. add route in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/fastapi/main.py` or a dedicated skills router included by that app, so the Next.js /api/skills route (T009) can proxy to it. Enforce auth per FR-014: validate Bearer token using JWKS or user_info (same pattern as RAG server; see `knowledge_bases/rag/server/src/server/auth.py` and `rbac.py`).
- [X] T009 Implement Next.js GET /api/skills route that proxies to backend skills endpoint and returns 200/503 per contracts/catalog-api.md in `ui/src/app/api/skills/route.ts`
- [X] T010 Wire supervisor to use upstream `SkillsMiddleware` for system prompt injection (FR-015): (a) call `get_merged_skills(include_content=True)` from the catalog layer; (b) call `write_skills_to_backend()` to populate `StateBackend` with SKILL.md files; (c) add `SkillsMiddleware(backend=lambda rt: StateBackend(rt), sources=["/skills/default/", ...])` to the `middleware` list in `create_deep_agent()` in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py`; (d) implement hot reload (e.g. call catalog + backend sync on each request or short TTL cache, clearing `skills_metadata` from state) or document UI-triggered refresh so catalog updates without restart (FR-012)

**Checkpoint**: Foundation ready — catalog API and supervisor use same merged list via upstream `SkillsMiddleware`; hot reload or UI trigger in place; user story implementation can begin.

---

## Phase 3: User Story 1 — Single Source of Skills for UI and Assistant (Priority: P1) 🎯 MVP

**Goal**: UI and assistant consume the same catalog; no "run skills" action in the chat window.

**Independent Test**: Skill list in the UI (skills page/gallery) matches the list returned by GET /api/skills and used by the assistant; chat has no "run skills" button or equivalent.

- [X] T011 [P] [US1] Switch skills gallery to consume GET /api/skills for the unified skill list (replace or complement /api/skill-templates and /api/agent-configs for listing) in `ui/src/components/skills/SkillsGallery.tsx` and `ui/src/app/(app)/skills/page.tsx`
- [X] T012 [P] [US1] Remove any "run skills" or "Run in Chat" action from the chat panel so skill execution is assistant-driven only in `ui/src/components/chat/ChatPanel.tsx` and `ui/src/components/chat/DynamicAgentChatPanel.tsx`
- [X] T013 [US1] Add 503 and empty-catalog response handling to GET /api/skills (return skills_unavailable message per contracts/catalog-api.md) in `ui/src/app/api/skills/route.ts`

**Checkpoint**: User Story 1 complete — single source in use, no run skills in chat; verify with independent test.

---

## Phase 4: User Story 2 — /skills in Chat to Show Available Skills (Priority: P1)

**Goal**: User can type `/skills` in chat and see the list of available skills in-conversation; UI directs users to use `/skills` to see loaded skills (FR-002).

**Independent Test**: Open chat, type `/skills`, submit; list appears in chat and matches central catalog; normal messages do not trigger the list; placeholder or tooltip directs users to `/skills`.

- [X] T014 [US2] Detect /skills command in chat input (trim, exact match on submit) before sending to assistant in `ui/src/components/chat/ChatPanel.tsx`
- [X] T015 [US2] When /skills detected: call GET /api/skills and render skills list as an in-chat message (do not call A2A send-message) in `ui/src/components/chat/ChatPanel.tsx`
- [X] T016 [US2] Show loading state while fetching skills; on 503 or error show "Skills are temporarily unavailable. Please try again later." per contracts/chat-command-skills.md in `ui/src/components/chat/ChatPanel.tsx`
- [X] T017 [US2] When catalog returns empty skills array show "No skills available at the moment." in chat in `ui/src/components/chat/ChatPanel.tsx`
- [X] T018 [US2] Add chat input placeholder or tooltip directing users to type /skills to see loaded skills (e.g. "Type /skills to see available skills") per FR-002 in `ui/src/components/chat/ChatPanel.tsx`
- [X] T019 [US2] Replicate /skills detection, rendering, and placeholder in DynamicAgentChatPanel if used for chat in `ui/src/components/chat/DynamicAgentChatPanel.tsx`

**Checkpoint**: User Story 2 complete — /skills shows list in chat; UI directs users to /skills; verify with independent test.

---

## Phase 5: User Story 3 — Add Skill Hubs from External Sources (e.g. GitHub) (Priority: P2)

**Goal**: Admins can register GitHub hubs via UI onboarding; hub skills (agentskills.io or OpenClaw-style SKILL.md) are merged into the catalog; supervisor hot reload or UI trigger reflects new hubs; hub failures do not break the rest of the catalog. ClawHub as a hub source is out of scope for v1.

**Independent Test**: Register a GitHub hub via UI, confirm its skills appear in GET /api/skills and /skills in chat; remove or disable hub, confirm skills disappear after refresh; unauthorized POST /api/skill-hubs returns 403.

- [X] T020 [P] [US3] Implement GitHub hub fetcher (discover skills under skills/*/SKILL.md or repo root; parse both agentskills.io and OpenClaw-style SKILL.md and normalize to catalog Skill shape per FR-011; ClawHub out of scope) in `ai_platform_engineering/skills_middleware/loaders/hub_github.py`
- [X] T021 [US3] Integrate hubs into catalog: read enabled hubs from MongoDB skill_hubs, fetch each via hub fetcher, merge with precedence in `ai_platform_engineering/skills_middleware/catalog.py`
- [X] T022 [US3] Implement GET /api/skill-hubs (list hubs, admin-only) and POST /api/skill-hubs (register hub; 403 unauthorized) per contracts/skill-hubs-api.md in `ui/src/app/api/skill-hubs/route.ts`
- [X] T023 [P] [US3] Implement PATCH /api/skill-hubs/[id] and DELETE /api/skill-hubs/[id] with authz and 403/404 per contracts/skill-hubs-api.md in `ui/src/app/api/skill-hubs/[id]/route.ts`
- [X] T024 [US3] On hub fetch failure set last_failure_at and last_failure_message on hub record; exclude that hub's skills from merge; include unavailable_sources in GET /api/skills meta in `ai_platform_engineering/skills_middleware/catalog.py` and `ui/src/app/api/skills/route.ts`
- [X] T025 [US3] Add skill hubs admin UI: list onboarded repos, add hub (owner/repo or URL, optional credentials), remove or disable (FR-013) in `ui/src/app/(app)/admin/page.tsx` or dedicated settings/skill-hubs page
- [X] T026 [US3] Optional: Add "Refresh skills" or post-onboard trigger that invalidates catalog cache so supervisor sees new hub skills without restart (FR-012) in UI and/or backend

**Checkpoint**: User Story 3 complete — hubs can be registered via UI and their skills appear in catalog; verify with independent test.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, validation, and integration tests.

- [X] T027 [P] Document catalog API, /skills command, hub registration, and hot reload/UI trigger in `docs/docs/specs/097-skills-middleware-integration/` or docs site
- [X] T028 Run quickstart.md validation scenarios (single source, /skills, hub registration, graceful degradation, unauthorized hub, duplicate ID) and fix gaps
- [X] T029 [P] Add integration test for catalog consistency (UI skills list vs GET /api/skills vs same source used by supervisor) in `integration/` or `tests/`
- [X] T030 [P] Add integration test for skill-hubs CRUD and 403 when non-admin calls POST/DELETE in `integration/` or `tests/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 — blocks all user stories.
- **Phase 3 (US1)**: Depends on Phase 2 — single source and no run skills in chat.
- **Phase 4 (US2)**: Depends on Phase 2 (catalog API); optionally Phase 3 — /skills in chat and FR-002 placeholder.
- **Phase 5 (US3)**: Depends on Phase 2 (merge and catalog) — hub registration, merge, and admin UI.
- **Phase 6 (Polish)**: Depends on Phases 3–5 as needed.

### User Story Dependencies

- **User Story 1 (P1)**: After Foundational — no dependency on US2/US3.
- **User Story 2 (P1)**: After Foundational; can run in parallel with US1 (both use same catalog API).
- **User Story 3 (P2)**: After Foundational; extends catalog with hubs; can follow US1/US2.

### Within Each User Story

- US1: T011 (gallery) and T012 (remove run skills) can be done in parallel; T013 (503 handling) after T009.
- US2: T014 then T015–T019 (detect, render, loading/empty, placeholder, DynamicAgentChatPanel).
- US3: T020 (fetcher) then T021 (integrate); T022 and T023 (API routes) can run in parallel; T024 (failure meta); T025 (admin UI); T026 optional (refresh trigger).

### Parallel Opportunities

- Phase 1: T002 and T003 can run in parallel.
- Phase 2: T004 and T005 (loaders) can run in parallel; T007a (backend_sync) can run in parallel with T007.
- Phase 3: T011 and T012 can run in parallel.
- Phase 5: T022 and T023 (API routes) can run in parallel; T020 can start early.
- Phase 6: T027, T029, T030 can run in parallel after stories are done.

---

## Parallel Example: User Story 1

```text
# After Phase 2 complete:
T011: Switch skills gallery to GET /api/skills in ui/src/components/skills/SkillsGallery.tsx
T012: Remove run skills from chat in ui/src/components/chat/ChatPanel.tsx
```

---

## Parallel Example: User Story 3

```text
# After T020, T021:
T022: GET/POST /api/skill-hubs in ui/src/app/api/skill-hubs/route.ts
T023: PATCH/DELETE /api/skill-hubs/[id] in ui/src/app/api/skill-hubs/[id]/route.ts
T024: Hub failure handling in catalog and API meta
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup  
2. Complete Phase 2: Foundational  
3. Complete Phase 3: User Story 1  
4. **STOP and VALIDATE**: Independent test — UI list matches catalog, no run skills in chat  
5. Deploy/demo if ready  

### Incremental Delivery

1. Setup + Foundational → catalog and supervisor wired; hot reload or UI trigger  
2. Add User Story 1 → single source, no run skills in chat (MVP)  
3. Add User Story 2 → /skills in chat, placeholder for discovery (FR-002)  
4. Add User Story 3 → skill hubs (GitHub), admin UI onboarding (FR-013)  
5. Polish → docs, quickstart, integration tests  

### Suggested MVP Scope

- **MVP**: Phases 1–3 (Setup + Foundational + User Story 1). Delivers single shared catalog for UI and assistant and removal of "run skills" from chat.

---

## Notes

- [P] tasks = different files or no blocking dependencies.
- [USn] label maps task to spec user story for traceability.
- Each user story is independently testable per spec "Independent Test."
- Commit after each task or logical group.
- Run `make lint`, `make test`, `make caipe-ui-tests` before PR.
- **FR-011**: Default and hub loaders must accept both Anthropic/agentskills.io and OpenClaw-style SKILL.md; ClawHub is not a v1 hub source.
- **FR-012**: Supervisor must hot reload (per-request or short TTL) or support UI-triggered catalog refresh (T010, optional T026).
- **FR-014**: Backend GET /skills (or equivalent) must validate Bearer token via JWKS or user_info (RAG server pattern); T008 includes this.
- **FR-015**: Supervisor must use upstream `deepagents.middleware.skills.SkillsMiddleware` for system prompt injection; custom catalog layer feeds skills into its `StateBackend`. T007a (backend_sync) + T010 (supervisor wiring) implement this.
