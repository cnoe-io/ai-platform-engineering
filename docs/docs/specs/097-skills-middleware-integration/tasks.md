# Tasks: Integrated Skills — Single Source, Chat, Hubs, Gateway, Visibility, Scanner

**Input**: Design documents from `docs/docs/specs/097-skills-middleware-integration/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/` (including `gateway-api.md`, `skill-scanner-pipeline.md`, `catalog-api.md`, `supervisor-skills-status.md`)

**Tests**: **Required** for Phases 8–14 (Constitution VII): **T062–T064** must be implemented with the corresponding code; earlier phases (1–7) remain as delivered.

**Organization**: Phases 1–16 are **complete** ([X]), including Phases 8–13 (**2026-03-24** spec), Phase **14** (T062–T064), Phase **15** (T065–T066), and Phase **16** (T067–T070: FR-025, FR-026, FR-023 attribution). Phase **17** (T071–T076: FR-027 scanner on agent-skills save) is **complete**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency)
- **[Story]**: `[US1]` … `[US4]` for user-story phases only
- Every description includes at least one concrete file path

## Path Conventions

- **Backend**: `ai_platform_engineering/skills_middleware/`, `ai_platform_engineering/multi_agents/platform_engineer/`
- **UI**: `ui/src/app/api/`, `ui/src/components/chat/`, `ui/src/components/skills/`, `ui/src/components/admin/`, `ui/src/lib/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package layout, MongoDB hub collection, env documentation.

- [X] T001 Create `skills_middleware` package layout: `ai_platform_engineering/skills_middleware/__init__.py`, `catalog.py`, loaders package per plan
- [X] T002 [P] Add or document MongoDB `skill_hubs` collection and indexes (unique `id`, `enabled`, `type`) in deployment docs or Mongo bootstrap
- [X] T003 [P] Document env vars for skills (`SKILLS_DIR`, OIDC for catalog, GitHub tokens) in `ui/env.example` and/or repo `env.example`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Merged catalog, precedence, GET skills + JWT, supervisor + `SkillsMiddleware` for A2A (`deep_agent.py`). **Blocks all user stories.**

**⚠️ CRITICAL**: Complete before User Stories 1–3.

- [X] T004 [P] Implement default loader (both agentskills.io and OpenClaw-style SKILL.md per FR-011) in `ai_platform_engineering/skills_middleware/loaders/default.py`
- [X] T005 [P] Implement agent_skills loader in `ai_platform_engineering/skills_middleware/loaders/agent_skill.py`
- [X] T006 Implement precedence merge (default > agent_skills > hub; hub order) in `ai_platform_engineering/skills_middleware/precedence.py`
- [X] T007 Implement `get_merged_skills(include_content: bool = False)` and TTL cache + `invalidate_skills_cache()` in `ai_platform_engineering/skills_middleware/catalog.py`
- [X] T008 [P] Implement `build_skills_files` / backend sync so normalized skills land in `StateBackend` paths for `SkillsMiddleware` (see `ai_platform_engineering/skills_middleware/` and `deep_agent.py` usage)
- [X] T009 Expose `GET /skills` with pagination/meta and FR-014 JWT validation in `ai_platform_engineering/skills_middleware/router.py` and mount in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/fastapi/main.py`
- [X] T010 Implement `POST /skills/refresh` that calls `invalidate_skills_cache()` in `ai_platform_engineering/skills_middleware/router.py` (extend in **T031** to trigger MAS rebuild)
- [X] T011 Wire `AIPlatformEngineerMAS` in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py`: `_build_graph()` calls `get_merged_skills`, passes `skills` + injects `files` into invoke state for upstream `SkillsMiddleware` via `create_deep_agent` (FR-015)
- [X] T012 Implement Next.js `GET` proxy for catalog in `ui/src/app/api/skills/route.ts` per `contracts/catalog-api.md`

**Checkpoint**: Catalog API + supervisor read same merged skills; graph builds at startup and on registry change.

---

## Phase 3: User Story 1 — Single Source (Priority: P1) 🎯 MVP

**Goal**: UI and assistant share one catalog; no run-skills / **Run in Chat** in chat.

**Independent Test**: Gallery list matches `GET /api/skills`; chat has no run-skills control.

- [X] T013 [P] [US1] Drive skills gallery from unified catalog in `ui/src/components/skills/SkillsGallery.tsx` and related pages under `ui/src/app/(app)/skills/`
- [X] T014 [P] [US1] Remove **Run in Chat** / run-skills actions from `ui/src/components/chat/ChatPanel.tsx` and `ui/src/components/chat/DynamicAgentChatPanel.tsx`
- [X] T015 [US1] Map 503 / `skills_unavailable` from backend through `ui/src/app/api/skills/route.ts` for gallery and chat consumers

**Checkpoint**: US1 independently testable.

---

## Phase 4: User Story 2 — `/skills` in Chat (Priority: P1)

**Goal**: Slash command lists skills in-chat; placeholder directs users to `/skills` (FR-002).

**Independent Test**: `/skills` shows list without A2A; normal messages unchanged; empty and error states per contract.

- [X] T016 [US2] Detect `/skills` on submit (trim, exact match) in `ui/src/components/chat/ChatPanel.tsx`
- [X] T017 [US2] Fetch `GET /api/skills` and render in-chat list (no A2A send) in `ui/src/components/chat/ChatPanel.tsx`
- [X] T018 [US2] Loading, 503, and empty-list copy per `docs/docs/specs/097-skills-middleware-integration/contracts/chat-command-skills.md` in `ui/src/components/chat/ChatPanel.tsx`
- [X] T019 [US2] Add placeholder/tooltip “Type /skills…” in `ui/src/components/chat/ChatPanel.tsx`
- [X] T020 [US2] Mirror `/skills` behavior in `ui/src/components/chat/DynamicAgentChatPanel.tsx` (and `ui/src/components/chat/useSlashCommands.ts` / `SlashCommandMenu.tsx` if used)

**Checkpoint**: US2 independently testable.

---

## Phase 5: User Story 3 — GitHub Skill Hubs (Priority: P2)

**Goal**: Register GitHub hubs; merge hub skills; partial failure + `meta.unavailable_sources`; admin UI; FR-012 refresh path (completed with **T031**).

**Independent Test**: Hub CRUD + catalog + `/skills` include hub skills; 403 for unauthorized; hub failure does not wipe catalog.

- [X] T021 [P] [US3] GitHub hub fetcher in `ai_platform_engineering/skills_middleware/loaders/hub_github.py` (FR-011 formats; ClawHub out of scope)
- [X] T022 [US3] Merge enabled hubs from MongoDB in `ai_platform_engineering/skills_middleware/catalog.py` with failure attribution for `meta.unavailable_sources`
- [X] T023 [US3] `GET`/`POST` skill-hubs in `ui/src/app/api/skill-hubs/route.ts` per `contracts/skill-hubs-api.md`
- [X] T024 [P] [US3] `PATCH`/`DELETE` skill-hub by id in `ui/src/app/api/skill-hubs/[id]/route.ts`
- [X] T025 [US3] Admin / settings UI for hub list + add/remove in `ui/src/app/(app)/admin/page.tsx` or dedicated route under `ui/src/app/(app)/`
- [X] T026 [US3] Optional UI “Refresh skills” calling refresh endpoint after hub save (wire to **T031** when done)

**Checkpoint**: US3 independently testable (crawl preview completed in **T034–T036**).

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Docs, quickstart, integration coverage.

- [X] T027 [P] Keep feature docs in `docs/docs/specs/097-skills-middleware-integration/` aligned with `spec.md` and `plan.md`
- [X] T028 Run scenarios 1–6 in `docs/docs/specs/097-skills-middleware-integration/quickstart.md`
- [X] T029 [P] Catalog / hub integration or unit coverage under `integration/` or `tests/` as appropriate
- [X] T030 [P] Extend `ui/src/lib/__tests__/api-middleware.test.ts` for skills and skill-hubs proxies as needed

---

## Phase 7: Spec alignment — Supervisor refresh, status, hub crawl (2026-03-23)

**Purpose**: Close FR-012/FR-016/FR-017 and `contracts/supervisor-skills-status.md` (refresh must update MAS snapshot; operators see load metadata; crawl before register).

- [X] T031 After `invalidate_skills_cache()` in `ai_platform_engineering/skills_middleware/router.py`, trigger `AIPlatformEngineerMAS._rebuild_graph()` via `ai_platform_engineering/skills_middleware/mas_registry.py`; return optional `graph_generation` / `skills_loaded_count` in JSON response
- [X] T032 Record `self._skills_merged_at` (UTC) and `self._skills_loaded_count` after successful merge in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` `_build_graph()`
- [X] T033 [P] Add authenticated `GET /internal/supervisor/skills-status` in `ai_platform_engineering/skills_middleware/router.py` per `contracts/supervisor-skills-status.md`
- [X] T034 [P] [US3] Implement `preview_github_hub_skills()` in `ai_platform_engineering/skills_middleware/loaders/hub_github.py` and `POST /skill-hubs/crawl` on the Python router
- [X] T035 [US3] Add `ui/src/app/api/skill-hubs/crawl/route.ts` (proxy when `BACKEND_SKILLS_URL` set; else `ui/src/lib/hub-crawl.ts`)
- [X] T036 [US3] Crawl preview in admin hub form (`Preview skills (crawl)`) in `ui/src/components/admin/SkillHubsSection.tsx`
- [X] T037 [P] Supervisor status UI in `ui/src/components/admin/SupervisorSkillsStatusSection.tsx` on admin page
- [X] T038 [P] New routes use existing `withAuth` / `requireAdmin`; no `api-middleware.ts` change required
- [X] T039 Manual validation: quickstart scenarios 7–8 with `BACKEND_SKILLS_URL` + running supervisor

**Checkpoint**: SC-007 satisfied; crawl preview before hub save; no cache-only refresh without MAS update.

---

## Phase 8: Foundational — Visibility, search, entitlement, prompt cap (2026-03-24)

**Purpose**: FR-019, FR-020, FR-024; `contracts/catalog-api.md` and `data-model.md`. **Blocks** gateway consistency and supervisor entitlement alignment.

**⚠️ CRITICAL**: Complete before Phases 9–12 that rely on filtered catalog and bounded prompts.

- [X] T040 Add `visibility`, `team_ids`, `owner_user_id` defaults on merged skills in `ai_platform_engineering/skills_middleware/catalog.py` and loaders `ai_platform_engineering/skills_middleware/loaders/default.py`, `agent_skill.py`, `hub_github.py`
- [X] T041 Implement entitlement filter helpers (global / team / personal union) in new `ai_platform_engineering/skills_middleware/entitlement.py`
- [X] T042 Resolve caller principal + team ids from JWT/userinfo and apply entitlement filter on `GET /skills` responses in `ai_platform_engineering/skills_middleware/router.py` (mirror validation **behavior** of `ui/src/lib/jwt-validation.ts` in Python: JWKS, issuer, claims, group claim — do not import TypeScript from Python)
- [X] T043 Implement `q`, `page`, `page_size`, `source`, `visibility` query handling and `meta.total` in `ai_platform_engineering/skills_middleware/router.py` and `ai_platform_engineering/skills_middleware/catalog.py`
- [X] T044 Enforce `MAX_SKILL_SUMMARIES_IN_PROMPT` (env) when building skills for `SkillsMiddleware` in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` per FR-024
- [X] T045 [P] Document `MAX_SKILL_SUMMARIES_IN_PROMPT`, `SKILL_SCANNER_GATE` (`warn` \| `strict`), `SKILL_SCANNER_POLICY`, `SKILL_SCANNER_FAIL_ON`, `catalog_api_keys`, `skill_scan_findings`, and `SKILLS_DIR` for packaged scans in `ui/env.example`, `docs/docs/specs/097-skills-middleware-integration/data-model.md`, and `docs/docs/specs/097-skills-middleware-integration/contracts/skill-scanner-pipeline.md`
- [X] T046 Implement Mongo-backed catalog API key store (hash-only secrets) in `ai_platform_engineering/skills_middleware/api_keys_store.py` per `data-model.md`

**Checkpoint**: Entitled catalog list matches spec; large catalogs paginate; supervisor prompt bounded.

---

## Phase 9: User Story 1 — Source UX & hub discoverability (Priority: P1)

**Goal**: FR-021, FR-022 — distinguish default vs agent_skills vs hub; visible path to Admin → Skill Hubs.

**Independent Test**: User recognizes skill origin; empty state or banner links to skill hub onboarding without hunting admin.

- [X] T047 [P] [US1] Add source labels, grouping, or filters for `default` / `agent_skills` / `hub` in `ui/src/components/skills/SkillsGallery.tsx` and `ui/src/components/skills/SkillsBuilderEditor.tsx` (keep wording consistent with spec FR-021)
- [X] T048 [US1] Add hub onboarding CTA and empty-state copy linking to `ui/src/app/(app)/admin/page.tsx` (Skill Hubs) from `ui/src/components/skills/SkillsGallery.tsx` or `ui/src/app/(app)/skills/page.tsx`

**Checkpoint**: US1 UX extended; independently verifiable in UI.

---

## Phase 10: User Story 2 — `/skills` parity with catalog API (Priority: P1)

**Goal**: FR-004, FR-019 — chat command sees same entitled data shape as UI; optional first-page list; empty search message.

**Independent Test**: `/skills` list matches first page of `GET /api/skills` for the same user; no skills shows friendly empty copy.

- [X] T049 [US2] Align `/skills` fetch with entitled catalog + pagination defaults and empty-search messaging in `ui/src/components/chat/ChatPanel.tsx` and `ui/src/components/chat/DynamicAgentChatPanel.tsx`

**Checkpoint**: US2 still independently testable with stricter parity.

---

## Phase 11: User Story 4 — Try skills gateway (Priority: P1)

**Goal**: FR-018, SC-008 — UI docs, Okta JWT + API key auth to catalog, Claude/Cursor steps per `contracts/gateway-api.md`.

**Independent Test**: Developer uses only in-product gateway text to run authenticated `curl` with search.

- [X] T050 [US4] Add mint/list/revoke catalog API key HTTP handlers in `ai_platform_engineering/skills_middleware/router.py` using `ai_platform_engineering/skills_middleware/api_keys_store.py`
- [X] T051 [P] [US4] Add Next.js admin proxy for API key lifecycle under `ui/src/app/api/skills/token/` (or `ui/src/app/api/catalog-api-keys/route.ts`) with `requireAdmin`
- [X] T052 [US4] Accept API key authentication on `GET /skills` alongside JWT in `ai_platform_engineering/skills_middleware/router.py` per `contracts/gateway-api.md`
- [X] T053 [US4] Implement Try skills gateway panel with base URL, auth options, and `curl` examples in `ui/src/components/skills/TrySkillsGateway.tsx`
- [X] T054 [US4] Mount gateway panel from `ui/src/app/(app)/skills/page.tsx` (or sibling route) and add Claude + Cursor step-by-step copy in `ui/src/components/skills/TrySkillsGateway.tsx`

**Checkpoint**: SC-008 satisfied.

---

## Phase 12: User Story 3 — Skill-scanner pipeline (Priority: P2)

**Goal**: FR-023, SC-009 — run [skill-scanner](https://github.com/cisco-ai-defense/skill-scanner) on hub ingest; persist findings; admin visibility per `contracts/skill-scanner-pipeline.md`.

**Independent Test**: Fixture hub produces findings row; UI shows severity; policy warn/block configurable.

- [X] T055 [US3] Add scanner runner wrapper (subprocess or SDK) in `ai_platform_engineering/skills_middleware/skill_scanner_runner.py` invoking `cisco-ai-skill-scanner` with documented flags
- [X] T056 [US3] Invoke scanner after hub fetch in `ai_platform_engineering/skills_middleware/loaders/hub_github.py` or `ai_platform_engineering/skills_middleware/catalog.py`; persist to Mongo `skill_scan_findings` per `data-model.md`; honor **`SKILL_SCANNER_GATE`** / **`SKILL_SCANNER_FAIL_ON`** from `contracts/skill-scanner-pipeline.md` (warn vs block on high/critical)
- [X] T057 [P] [US3] Surface last scan / max severity / disclaimer in `ui/src/components/admin/SkillHubsSection.tsx` or new `ui/src/components/admin/SkillScanFindingsSection.tsx` (Cisco AI Defense **Skill Scanner** attribution: **T070**)

**Checkpoint**: SC-009 satisfied.

---

## Phase 13: Polish & cross-cutting (2026-03-24)

**Purpose**: Proxy parity, dependency docs, quickstart validation.

- [X] T058 [P] Forward `q`, `page`, `page_size`, `source`, `visibility` from browser to Python in `ui/src/app/api/skills/route.ts`
- [X] T059 [P] Add optional `cisco-ai-skill-scanner` dependency group or documented install line in `pyproject.toml` and `docs/docs/specs/097-skills-middleware-integration/research.md` / `plan.md` references
- [X] T060 Manual validation: scenarios 9–12 in `docs/docs/specs/097-skills-middleware-integration/quickstart.md`
- [X] T061 Document **Scenario 13** (catalog list latency / p95 smoke) in `docs/docs/specs/097-skills-middleware-integration/quickstart.md` and run a manual or scripted timing check against `GET /api/skills` (target: plan p95 &lt; 500 ms under typical catalog size, or record actuals)

---

## Phase 14: Automated tests (Constitution VII, Phases 8–13)

**Purpose**: Acceptance criteria for entitlement, catalog API, and UI proxy become automated tests (remediation C1/D1).

- [X] T062 [P] Add unit tests for `ai_platform_engineering/skills_middleware/entitlement.py` (global/team/personal union, edge cases) under `tests/` or `integration/` per repo convention (`tests/test_skills_catalog.py` — `TestEntitlement`)
- [X] T063 Add integration or API tests for `GET /skills` (JWT + optional API key path), query params `q` / `page` / `source` / `visibility`, and 401/200 behavior in `tests/` or `integration/` targeting `ai_platform_engineering/skills_middleware/router.py`
- [X] T064 [P] Extend `ui/src/lib/__tests__/api-middleware.test.ts` (or add `ui/src/app/api/skills/__tests__/route.test.ts` if used) for forwarded query params and error mapping for skills proxy

**Checkpoint**: `make test` / `make caipe-ui-tests` cover new skills middleware surfaces.

---

## Phase 15: Packaged skills scan + multi-user supervisor wiring

**Purpose**: FR-023 default/packaged path; spec assumption multi-user supervisor (per-invoke entitlement).

- [X] T065 [P] [US3] Run `scripts/scan-packaged-skills.sh` from CI on release or `workflow_dispatch` (document in `.github/workflows/` or `docs/docs/specs/097-skills-middleware-integration/research.md`); set `SKILLS_DIR` to chart/repo packaged skills root; use `SKILL_SCANNER_GATE=strict` on protected branches if desired
- [X] T066 Pass **caller principal** (`sub`, team ids) from `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` (and FastAPI invoke path if applicable) into `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` / catalog merge so **each** supervisor invocation uses an **entitled + capped** skill set (per spec Assumptions: multi-user); avoid rebuilding the full compiled graph per user unless benchmarked and documented

---

## Phase 16: Gateway–supervisor sync, agent_skills source-tag refactor, Skill Scanner attribution

**Purpose**: **FR-026**, **SC-010** (`contracts/supervisor-skills-status.md`); **FR-025**; **FR-023** third-party attribution (`contracts/skill-scanner-pipeline.md`, spec Session 2026-03-27).

- [X] T067 [P] Track `last_built_catalog_generation` (or equivalent) on `AIPlatformEngineerMAS` in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` at end of `_build_graph()`; expose `sync_status` (`in_sync` \| `supervisor_stale` \| `unknown`) and aligned fields on `GET /internal/supervisor/skills-status` in `ai_platform_engineering/skills_middleware/router.py` per `contracts/supervisor-skills-status.md`
- [X] T068 [US4] Add **skills sync status** (human-readable + optional raw fields) to Try skills gateway in `ui/src/components/skills/TrySkillsGateway.tsx`; add BFF route under `ui/src/app/api/` if the UI cannot call Python status directly (e.g. `ui/src/app/api/supervisor/skills-status/route.ts`); wire refresh CTA to existing refresh endpoint per FR-012
- [X] T069 [P] [US1] **FR-025**: Consolidate legacy **agent_skills** naming (routes, components, user-facing copy) onto **agent skills** / `source: agent_skills` semantics in `ui/src/app/api/`, `ui/src/components/skills/` — preserve backward-compatible API and Mongo reads; no change to merge precedence (FR-010) or visibility (FR-020)
- [X] T070 [P] **FR-023 attribution**: Add **Skill Scanner** **provided by Cisco AI Defense** + `https://github.com/cisco-ai-defense/skill-scanner` in admin scan surfaces (`ui/src/components/admin/SkillHubsSection.tsx` and/or `SkillScanFindingsSection.tsx`); add or extend repo **NOTICE** / third-party credits file at repo root (or `docs/`) per `contracts/skill-scanner-pipeline.md`

**Checkpoint**: SC-010 satisfied; FR-025 naming consistent; attribution visible wherever scanner is named.

---

## Phase 17: Scanner on agent-skills save (FR-027, SC-011)

**Purpose**: Run skill-scanner synchronously when agent-skills documents with `skill_content` are saved; persist-but-flag; exclude flagged from catalog under strict gate.

**Independent Test**: Save document with `skill_content`; response includes `scan_status`; under `SKILL_SCANNER_GATE=strict`, flagged document absent from `GET /skills`.

- [X] T071 [P] Add `write_single_skill_to_temp_tree(name, content)` helper in `ai_platform_engineering/skills_middleware/skill_scanner_runner.py`
- [X] T072 [P] Generalize `_persist_scan_run` in `ai_platform_engineering/skills_middleware/hub_skill_scan.py` to accept `source_type` (`hub` | `agent_skills`) and `source_id` instead of only `hub_id`
- [X] T073 Add `POST /skills/scan-content` endpoint in `ai_platform_engineering/skills_middleware/router.py`: accept `{name, content}`, run scanner, apply gate logic, persist findings via generalized helper, return `{passed, blocked, max_severity, exit_code, summary}`
- [X] T074 [P] Add `scan_status?: "passed" | "flagged" | "unscanned"` to `AgentSkill`, `CreateAgentSkillInput`, `UpdateAgentSkillInput` in `ui/src/types/agent-skill.ts`
- [X] T075 Wire scanner call into `POST` and `PUT` handlers in `ui/src/app/api/skills/configs/route.ts` (historically `agent-skills/route.ts`): call Python `POST /skills/scan-content` when `skill_content` present; set `scan_status` on persisted document; include in response
- [X] T076 When `SKILL_SCANNER_GATE=strict`, add `scan_status: { $ne: "flagged" }` filter to MongoDB query in `ai_platform_engineering/skills_middleware/loaders/agent_skill.py`

**Checkpoint**: SC-011 satisfied; flagged documents excluded under strict gate; findings in `skill_scan_findings` with `source_type: "agent_skills"`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phases 1–7**: Complete (baseline).
- **Phase 8** → **Phases 9–12** (entitlement + pagination + keys store + prompt cap before UI gateway and scanner consumers).
- **T046** before **T050**, **T052** (API key storage before mint/auth).
- **Phase 11 (US4)** can start after **T043**, **T046**; full E2E after **T042**, **T052**.
- **Phase 12 (US3)** can parallel **Phase 9–11** after **T045** if findings collection exists; **T056** should respect **T040** visibility metadata.
- **Phase 14 (T062–T064)** after **T041**, **T043**, **T058** respectively (tests follow implementation).
- **T066** depends on **T040–T044** (entitlement + cap); should complete before declaring FR-015/FR-020 satisfied for multi-tenant deployments.
- **T065** can parallel UI work; wire CI after **T055**/`skill-scanner` CLI availability.
- **T067** depends on **T031–T033** (cache generation + status endpoint baseline); **T068** depends on **T067** and **Phase 11** gateway shell (**T053**/**T054**) for placement.
- **T069** can parallel **T067**/**T068** if files do not overlap; prefer after **T047** to avoid duplicate gallery edits.
- **T070** can parallel **T057**; if **T057** not done, **T070** still adds NOTICE + placeholder admin copy for future scan UI.
- **Phase 17 (T071–T076)**: T071, T072, T074 are parallel (different files). T073 depends on T071 + T072. T075 depends on T073 + T074. T076 can parallel T075.

### User Story Dependencies (new work)

- **US1 (T047–T048)**: After Phase 8 (uses entitled responses and source field from T040).
- **US2 (T049)**: After Phase 8.
- **US4 (T050–T054)**: After T046, T042, T043.
- **US3 (T055–T057)**: After Phase 8 merge path stable; optional parallel with US4.

### Parallel Opportunities

- **Phase 8**: T045 parallel to T040–T044 once scope known.
- **Phase 9**: T047 parallel to other files if split; T048 follows T047 for layout.
- **Phase 11**: T051 parallel after T050 contract defined.
- **Phase 12**: T057 parallel after T055–T056 contract.
- **Phase 13**: T058, T059 parallel.

---

## Parallel Example: Phase 8 → 11

```text
T045: env.example + data-model doc touch
T046: api_keys_store.py (start early; required before T050/T052)

T051: Next.js proxy routes (after T050 handler shapes exist)
```

---

## Implementation Strategy

### MVP (minimal new scope)

1. Complete **Phase 8** (T040–T046).  
2. Complete **Phase 9** (T047–T048) + **Phase 10** (T049).  
3. Validate quickstart scenarios 1–2 + **10** for entitlement parity.

### Full feature (spec 2026-03-24)

1. Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12 → Phase 13 → **Phase 14** (tests) → **Phase 15** (CI scan + **T066** multi-user wiring) → **Phase 16** (**T067–T070**: sync, refactor, attribution).  
2. Run quickstart scenarios **9–14** at T060–T061 (include **Scenario 14** after **T068**).

---

## Task Summary

| Phase | Task IDs | Count | Status |
|-------|-----------|-------|--------|
| Setup | T001–T003 | 3 | Done |
| Foundational | T004–T012 | 9 | Done |
| US1 | T013–T015 | 3 | Done |
| US2 | T016–T020 | 5 | Done |
| US3 | T021–T026 | 6 | Done |
| Polish | T027–T030 | 4 | Done |
| Spec alignment 03-23 | T031–T039 | 9 | Done |
| Foundational 03-24 | T040–T046 | 7 | **Done** |
| US1 UX | T047–T048 | 2 | Done |
| US2 parity | T049 | 1 | Done |
| US4 Gateway | T050–T054 | 5 | Done |
| US3 Scanner | T055–T057 | 3 | Done |
| Polish 03-24 | T058–T061 | 4 | Done |
| Tests (VII) | T062–T064 | 3 | Done |
| Scan + multi-user | T065–T066 | 2 | Done |
| Sync + refactor + attribution | T067–T070 | 4 | Done |
| Scanner on save (FR-027) | T071–T076 | 6 | Done |
| Custom label + scanner fix + multi-file (FR-021/027/028) | T077–T086 | 10 | Done |
| **Total** | **T001–T086** | **86** | **Done** |

**Parallel-friendly (new)**: T045, T046 (early), T047, T051, T057, T058, T059, T062, T064, T065, T067, T069, T070 (within dependency order).

**Suggested MVP for new work**: **Phase 8** (T040–T046) → **Phase 14** tests for that slice (**T062** after T041) → **Phase 9–10**.

---

## Phase 18: Custom Label, Scanner Fix, Multi-file Skills (FR-021/FR-027/FR-028)

| Task | Description | Status |
|------|-------------|--------|
| T077 | Rename "Agent config" to "Custom" in SkillsGallery.tsx SOURCE_LABELS, filters, and help text (FR-021) | Done |
| T078 | Add `BACKEND_SKILLS_URL` to `ui/.env.local` and `ui/.env.example` (FR-027 fix) | Done |
| T079 | Update `fetch_github_hub_skills` in `hub_github.py` to fetch full directory tree and populate `ancillary_files` | Done |
| T080 | Update `preview_github_hub_skills` to show `ancillary_file_count` per skill | Done |
| T081 | Update `build_skills_files` in `backend_sync.py` to write ancillary files to StateBackend | Done |
| T082 | Add `ancillary_files` field to `AgentSkill` types in `agent-skill.ts` | Done |
| T083 | Project `ancillary_files` from MongoDB in `agent_skill.py` loader | Done |
| T084 | Persist `ancillary_files` in POST/PUT with 5 MB limit + GitHub import endpoint in `ui/src/app/api/skills/configs/route.ts` | Done |
| T085 | Add file drop zone and GitHub import UI in `SkillsBuilderEditor.tsx` | Done |
| T086 | Update `data-model.md`, `research.md`, and `tasks.md` for Phase 18 | Done |

---

## Extension hooks

`.specify/extensions.yml` is **not** present at the repository root — there are **no** Speckit `hooks.before_tasks` / `hooks.after_tasks` (or other) extension hooks registered for this feature. If you add `.specify/extensions.yml` later, re-run `/speckit.tasks` or align hook commands with your team’s HookExecutor.

---

## Notes

- **FR-014 / FR-018**: Okta JWT + catalog API keys on `GET /skills` — `router.py` + `api_keys_store.py`.  
- **FR-024**: Cap in `deep_agent.py` does not remove skills from storage; only limits prompt-listed summaries.  
- **Skill-scanner**: No findings ≠ safe; disclose in UI copy (T057, T054). **Attribution**: Cisco AI Defense + repo link (**T070**, `skill-scanner-pipeline.md`).  
- **FR-026**: Catalog vs supervisor generations on status API (**T067**); Try skills gateway panel (**T068**).  
- **FR-025**: Rename/align **agent_skills** surfaces without breaking stored docs (**T069**).  
- Quality gates: `make lint`, `make test`, `make caipe-ui-tests` before merge.
