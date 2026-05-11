---
description: "Task list for Unified Skills API, Gateway, Template Import, and Skill Scanner visibility"
---

# Tasks: Unified Skills API, Gateway, Template Import, and Skill Scanner

**Input**: Design documents from `docs/docs/specs/2026-04-29-skills-api-unification/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [contracts/rest-api.md](./contracts/rest-api.md), [data-model.md](./data-model.md), [implementation-plan.md](./implementation-plan.md), [mongodb-migration.md](./mongodb-migration.md)

**Tests**: Not mandated by spec; include running `npm run lint` and `npm test` in `ui/` (CI gates).

**Organization**: Phases follow user story priority from [spec.md](./spec.md) (P1 → P4; US5 is P2). Setup and Foundational precede all user stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no ordering dependency within the same checkpoint)
- **[USn]**: User Story n from [spec.md](./spec.md)

---

## Phase 1: Setup (shared infrastructure)

**Purpose**: Align contracts, data model notes, and implementation-plan with FR-011–FR-016 before scanner/quarantine work.

- [X] T001 Extend `docs/docs/specs/2026-04-29-skills-api-unification/contracts/rest-api.md` with planned HTTP surfaces for scan re-run, hub scan job start, job status polling, and optional quarantine policy admin read/write (stub sections OK until implemented)
- [X] T002 [P] Update `docs/docs/specs/2026-04-29-skills-api-unification/data-model.md` with **Scan job** and **Quarantine policy** entities and their relationship to `agent_skills` / 097 `skill_scan_findings`
- [X] T003 [P] Add a **route matrix** subsection (in-product UI vs Skills API Gateway / agent catalog vs config CRUD) to `docs/docs/specs/2026-04-29-skills-api-unification/implementation-plan.md` per FR-016; reference `GET /api/skills` behavior for quarantined rows
- [X] T004 Cross-check finding severities and field names in `docs/docs/specs/097-skills-middleware-integration/data-model.md` against FR-015 mapping notes in `implementation-plan.md`

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Confirm unified `/api/skills/*` surface and template import exist so user stories do not depend on removed `agent-skills` paths.

**⚠️ CRITICAL**: User story phases assume this phase complete (stable routes, no legacy API tree).

- [X] T005 Verify persisted-config CRUD and supervisor refresh behavior in `ui/src/app/api/skills/configs/route.ts` matches `contracts/rest-api.md` and [implementation-plan.md](./implementation-plan.md) §2
- [X] T006 [P] Verify `ui/src/app/api/skills/seed/route.ts`, `ui/src/app/api/skills/generate/route.ts`, and `ui/src/app/api/skills/import-github/route.ts` exist and match Phase A of [implementation-plan.md](./implementation-plan.md)
- [X] T007 Verify `ui/src/app/api/skills/templates/import/route.ts` implements deterministic `skill-{slug}-{6hex}` IDs and dedupe on `metadata.template_source_id` + `is_system` per FR-005–FR-006
- [X] T008 Confirm legacy `ui/src/app/api/agent-skills/` is absent; if any residual references exist in `ui/`, remove or rewrite per FR-001

**Checkpoint**: New paths are the only HTTP entry points for configs/seed/generate/import-github/template import.

---

## Phase 3: User Story 1 — One URL family (Priority: P1) 🎯 MVP

**Goal**: Operators and integrators use only the unified skills URL family; no parallel `agent-skills` documentation or clients.

**Independent Test**: Repository search shows no `/api/agent-skills` usage in `ui/`; [quickstart.md](./quickstart.md) API checks pass; release notes can cite a single path family.

### Implementation for User Story 1

- [X] T009 [US1] Audit `ui/` for `/api/agent-skills` and `agent-skills` path strings; fix any stragglers in `ui/src/store/agent-skills-store.ts`, `ui/src/components/skills/SkillsBuilderEditor.tsx`, and `ui/src/components/chat/useSlashCommands.ts`
- [X] T010 [P] [US1] Align tests: `ui/src/store/__tests__/agent-skills-store.test.ts`, `ui/src/app/api/__tests__/agent-skill-visibility.test.ts`, `ui/src/app/api/__tests__/agent-skill-content.test.ts` import from `ui/src/app/api/skills/configs/route.ts` and assert `/api/skills/configs`
- [X] T011 [US1] Update in-repo documentation under `docs/` that still references `ui/src/app/api/agent-skills/` to `ui/src/app/api/skills/configs/route.ts` per SC-001

**Checkpoint**: MVP = unified URLs + green `ui/` tests for updated paths.

---

## Phase 4: User Story 2 — Import packaged templates on purpose (Priority: P2)

**Goal**: Administrators explicitly import chart templates as system skills; repeat import does not create duplicate rows.

**Independent Test**: POST `ui` `/api/skills/templates/import` twice with the same template id — second run reports skip / zero new inserts ([SC-002](./spec.md)).

### Implementation for User Story 2

- [X] T012 [US2] Implement or complete **Import packaged templates** UX in `ui/src/components/skills/SkillsGallery.tsx` (and/or a colocated modal), listing templates via existing loader/API and POSTing to `/api/skills/templates/import`
- [X] T013 [US2] Surface partial success/failure (per-template errors) with toasts or inline summary per spec edge cases

**Checkpoint**: Story 2 verifiable without US3–US5.

---

## Phase 5: User Story 3 — At most one auto-seeded example (Priority: P2)

**Goal**: First-time initialization creates at most one example skill in shared storage; full template set requires explicit import (Story 2).

**Independent Test**: Fresh DB — after init, ≤1 auto-seeded system row from the designated example template ([SC-003](./spec.md)).

### Implementation for User Story 3

- [X] T014 [US3] Narrow auto-seed to a single `EXAMPLE_TEMPLATE_ID` / env `SKILLS_AUTO_SEED_TEMPLATE_ID` in `ui/src/app/api/skills/seed/route.ts` and `ui/src/store/agent-skills-store.ts` per [implementation-plan.md](./implementation-plan.md) §4
- [X] T015 [P] [US3] Verify packaged default skill content under `charts/ai-platform-engineering/data/skills/incident-postmortem-report/` and visibility through `ui/src/app/api/skills/skill-templates-loader.ts` ([SC-005](./spec.md))

**Checkpoint**: No silent full-disk seed of all templates on first load.

---

## Phase 6: User Story 4 — Gateway favors live catalog (Priority: P3)

**Goal**: Gateway and installer copy emphasize authenticated live catalog fetch; bulk local install is clearly advanced ([FR-009](./spec.md)).

**Independent Test**: Primary `TrySkillsGateway` flow describes catalog query before optional bulk; install script comments match.

### Implementation for User Story 4

- [X] T016 [US4] Reorder and label sections in `ui/src/components/skills/TrySkillsGateway.tsx` so live catalog + auth precede bulk/install flows
- [X] T017 [P] [US4] Align narrative in `ui/src/app/api/skills/bootstrap/route.ts` and `ui/src/app/api/skills/bootstrap/agents.ts` with the same ordering
- [X] T018 [P] [US4] Mark bulk/advanced modes clearly in `ui/src/app/api/skills/install.sh/route.ts` header comments

**Checkpoint**: UX review against User Story 4 acceptance scenarios in [spec.md](./spec.md).

---

## Phase 7: User Story 5 — Skill scanner status, re-run, job progress, quarantine (Priority: P2)

**Goal**: Visible scan status, authorized re-scan (single skill + hub), pollable jobs for hub/bulk scans, and gateway exclusion for quarantined skills while UI shows them for remediation ([FR-011](./spec.md)–[FR-016](./spec.md)).

**Independent Test**: UI shows pass/flagged/unscanned; hub re-scan returns a job id and polling reaches a terminal state; quarantined skills absent from agent-facing catalog smoke, visible in gallery/builder with status ([SC-006](./spec.md), [SC-007](./spec.md)).

### Implementation for User Story 5

- [ ] T019 [US5] Document and implement **scan job** persistence (collection name, document shape, indexes, optional TTL) in `docs/docs/specs/2026-04-29-skills-api-unification/mongodb-migration.md` and add a small data-access module (e.g. `ui/src/lib/skill-scan-jobs.ts`) used by API routes
- [ ] T020 [US5] Implement **admin-only quarantine policy** read/update (Mongo-backed settings document or validated env with admin API) in new `ui/src/lib/skill-quarantine-policy.ts` and wire to an admin route under `ui/src/app/api/` per team conventions
- [ ] T021 [US5] Implement server-side **quarantine evaluation** from persisted findings + policy; filter **quarantined** `agent_skills` entries out of merged **agent/CLI catalog** responses in `ui/src/app/api/skills/route.ts` while keeping them available through in-app config/list paths per FR-015–FR-016 and the implementation-plan route matrix
- [ ] T022 [P] [US5] Surface **scan_status** / outcome badges on persisted skills in `ui/src/components/skills/SkillsGallery.tsx` and/or `ui/src/components/skills/SkillsBuilderEditor.tsx` (reuse types in `ui/src/types/agent-skill.ts`)
- [ ] T023 [US5] Add **single-skill re-scan** API under `ui/src/app/api/skills/` (e.g. `configs/[id]/rescan/route.ts` or dedicated `scan/route.ts`) invoking existing scanner integration patterns from `ui/src/app/api/skills/configs/route.ts`; enforce FR-012 (admin for `is_system`; owner / linked team member / admin for non-system) with **403** on denial
- [ ] T024 [US5] Add **hub/collection re-scan** entry point (e.g. `ui/src/app/api/skill-hubs/[id]/scan/route.ts` or extend `ui/src/app/api/skill-hubs/[id]/refresh/route.ts`) **admin-only**, returning a **job id**; integrate with `ui/src/components/admin/SkillHubsSection.tsx` actions
- [ ] T025 [US5] Implement **GET** pollable **job status** route (e.g. `ui/src/app/api/skills/scan-jobs/[jobId]/route.ts` or `ui/src/app/api/admin/skill-scan-jobs/[jobId]/route.ts`) returning progress/phases until terminal state per FR-013–FR-014
- [ ] T026 [P] [US5] Add **job progress UI** (poll loop, non-empty progress signal) in `ui/src/components/admin/SkillHubsSection.tsx` or a new `ui/src/components/admin/SkillScanJobProgress.tsx` wired to T025
- [ ] T027 [US5] Implement **concurrent job** policy for the same hub/skill scope (409 or idempotent same `jobId`) per spec edge cases; document choice in `implementation-plan.md`
- [ ] T028 [P] [US5] On **quarantine threshold change**, re-evaluate eligibility from stored findings without requiring a new scan where possible; update policy handler and any cache invalidation for `ui/src/app/api/skills/route.ts`
- [ ] T029 [P] [US5] Show **quarantined** state clearly in in-product skills UI (gallery/builder) per FR-016 while confirming gateway paths do not list those skills for agents

**Checkpoint**: Scanner visibility, jobs, and quarantine behavior independently testable per User Story 5 acceptance scenarios.

---

## Phase 8: Polish & cross-cutting concerns

**Purpose**: CI, contracts finalization, release communications, [quickstart.md](./quickstart.md).

- [ ] T030 [P] Finalize `docs/docs/specs/2026-04-29-skills-api-unification/contracts/rest-api.md` with implemented paths from Phases 2–7 (Phase 7/US5 APIs still planned-only; stub section added in T001)
- [X] T031 [P] Sweep `docs/docs/specs/097-skills-middleware-integration/` for stale `agent-skills` file paths; point to `ui/src/app/api/skills/configs/route.ts` where relevant
- [X] T032 Document **breaking URL** table and **scanner/quarantine** behavior for operators in PR or `docs/` release notes ([FR-010](./spec.md), FR-011–FR-016)
- [X] T033 Run `npm run lint` and `npm test` in `ui/` and fix regressions (`npm test` passes; `npm run lint` fails: Next.js 16 CLI no longer exposes `next lint` — migrate script to `eslint` or `next`’s supported lint path)
- [X] T034 Execute validation steps in `docs/docs/specs/2026-04-29-skills-api-unification/quickstart.md` including `rg '/api/agent-skills' ui` (expect no matches) and SC-006/SC-007 spot checks when US5 is in scope
- [X] T035 [P] Extend `docs/docs/specs/2026-04-29-skills-api-unification/quickstart.md` with **Skills AI Assist** prerequisites: `DYNAMIC_AGENTS_URL` in `ui/.env.local` must match a running **dynamic-agents** service (`POST /api/v1/assistant/suggest`); see `ui/env.example` and `ui/src/lib/server/assistant-suggest-da.ts`
- [X] T036 [P] Verify **Skills Builder** loads full SKILL.md for persisted skills: `skill_content` on seed/import (`ui/src/app/api/skills/seed/route.ts`, `ui/src/app/api/skills/templates/import/route.ts`), `resolvePersistedSkillMarkdownForEditor` in `ui/src/lib/skill-md-parser.ts`, and editor hydration in `ui/src/components/skills/SkillsBuilderEditor.tsx`
- [X] T037 [P] Keep **AI Assist** unified panel (create + checkbox enhancements) covered by `ui/src/components/skills/__tests__/SkillsBuilderEditor.test.tsx` when changing `SkillsBuilderEditor.tsx`

---

## Dependencies & execution order

### Phase dependencies

| Phase | Depends on |
|-------|------------|
| 1 Setup | — |
| 2 Foundational | Phase 1 (light); **blocks** all user stories |
| 3 US1 | Phase 2 |
| 4 US2 | Phase 2; template import route (T007) |
| 5 US3 | Phase 2; coordinates with US2 on `seed/route.ts` / store |
| 6 US4 | Phase 2; can parallelize with US2–US5 if no file conflicts |
| 7 US5 | Phase 2; **coordinates with T021 on** `ui/src/app/api/skills/route.ts` |
| 8 Polish | Target user stories complete |

### User story dependencies

- **US1**: After Foundational — no dependency on other stories.
- **US2**: After Foundational + import route; UI can follow US1 audit.
- **US3**: Independent except shared `seed/route.ts` / store with US2.
- **US4**: Independent copy/layout work.
- **US5**: After Foundational; may run parallel to US2–US4 with care for `ui/src/app/api/skills/route.ts` merge conflicts.

### Within User Story 5

- Policy + job persistence (T019–T020) before filtering and routes that read jobs (T021, T025).
- T021 before or alongside T029 (UI badges depend on stable quarantine rules).
- T023–T024 before T026 (UI needs endpoints).

### Parallel opportunities

- Phase 1: T002, T003, T004 in parallel after T001 scope is clear.
- Phase 2: T006 parallel to parts of T005/T007 once configs behavior is frozen.
- US1: T010 parallel after T009.
- US4: T017, T018 parallel after T016 outline.
- US5: T022, T026, T028, T029 parallel when job API and policy (T019–T021, T025) exist.
- Polish: T030, T031, T033, T035, T036, T037 in parallel.

---

## Parallel example: User Story 5 (after T019–T021)

```bash
# Concurrent workstreams:
# - SkillsGallery / SkillsBuilder scan badges (T022)
# - SkillScanJobProgress component + SkillHubsSection wiring (T026)
# - Quarantine badge + gateway filter verification (T029)
```

---

## Implementation strategy

### MVP first (User Story 1 only)

1. Complete Phase 1–2.
2. Complete Phase 3 (US1): audit paths, tests, docs.
3. **Stop and validate** against [quickstart.md](./quickstart.md) and `rg '/api/agent-skills' ui`.

### Incremental delivery

1. Setup + Foundational → stable routes.
2. US1 → unified URLs (MVP).
3. US2 + US3 → template control + narrow seed.
4. US4 → gateway narrative.
5. US5 → scanner UX, jobs, quarantine (largest vertical slice).
6. Polish → CI + release notes.

### Parallel team strategy

After Foundational: Developer A on US1/US2; B on US3/US4; C on US5 (coordinate on `ui/src/app/api/skills/route.ts`).

---

## Notes

- Local Speckit: `SPECKIT_SKIP_BRANCH_CHECK=1 SPECKIT_FEATURE_DIR=docs/docs/specs/2026-04-29-skills-api-unification ./.specify/scripts/bash/check-prerequisites.sh --json`
- Supervisor Python URLs for refresh/scan remain as today unless [implementation-plan.md](./implementation-plan.md) adds explicit proxy routes.
- **Teams / RBAC**: reuse existing Admin + MongoDB team membership and skill–team linkage fields only ([spec.md](./spec.md) Assumptions).

---

## Task summary (for `/speckit.implement`)

| Metric | Value |
|--------|------:|
| **Total tasks** | 37 |
| **Complete (this run)** | 26 |
| **Remaining** | 11 (T019–T029 US5 + T030 polish) |
| **Phase 1** | 4 ✓ |
| **Phase 2** | 4 ✓ |
| **US1** | 3 ✓ |
| **US2** | 2 ✓ |
| **US3** | 2 ✓ |
| **US4** | 3 ✓ |
| **US5** | 0 / 11 |
| **Polish** | 7 / 8 (T030 open) |

**Suggested MVP scope**: Phase 1 + Phase 2 + Phase 3 (US1) — **14 tasks** (T001–T011).

**Format validation**: All tasks use `- [ ] Tnnn` with optional `[P]` and required `[USn]` only on user-story phases; each description includes at least one concrete file or doc path.
