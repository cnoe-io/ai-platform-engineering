# Tasks: Webex Bot Integration

**Input**: Design documents from `/specs/098-webex-bot-integration/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md

**Note**: The Slack bot is NOT modified in this feature. All shared modules (A2A client, event parser, session manager, OAuth2 client, MongoDB session, Langfuse client) are copied into the Webex bot codebase with Webex-specific adaptations.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Copy Shared Modules into Webex Bot (Prerequisite)

**Purpose**: Copy platform-agnostic modules from the Slack bot into the Webex bot codebase with Webex-specific adaptations. Slack bot is NOT modified.

- [x] T001 [US1] Create `ai_platform_engineering/integrations/webex_bot/` directory with `__init__.py`
- [x] T002 [P] [US1] Copy `a2a_client.py` from `slack_bot/a2a_client.py` → `webex_bot/a2a_client.py`, change `X-Client-Source` to `"webex-bot"`, add `client_source` parameter
- [x] T003 [P] [US1] Copy `event_parser.py` from `slack_bot/utils/event_parser.py` → `webex_bot/event_parser.py` (no changes — platform-agnostic)
- [x] T004 [P] [US1] Copy `oauth2_client.py` from `slack_bot/utils/oauth2_client.py` → `webex_bot/oauth2_client.py`, change default env prefix to `WEBEX_INTEGRATION_AUTH`
- [x] T005 [P] [US1] Copy `session_manager.py` from `slack_bot/utils/session_manager.py` → `webex_bot/session_manager.py` (no changes — platform-agnostic)
- [x] T006 [P] [US1] Copy `mongodb_session.py` from `slack_bot/utils/mongodb_session.py` → `webex_bot/mongodb_session.py`, change collection to `webex_sessions`
- [x] T007 [P] [US1] Copy `langfuse_client.py` from `slack_bot/utils/langfuse_client.py` → `webex_bot/langfuse_client.py` (no changes — platform-agnostic)
- [x] T008 [US1] Create `webex_bot/requirements.txt` with dependencies: `websockets>=15.0.1`, `webexteamssdk`, `requests`, `loguru`, `pydantic`, `pymongo`
- [x] T009 [US1] Write unit tests for copied modules — verify Webex-specific adaptations (`webex_bot/tests/test_a2a_client.py`, `test_oauth2_client.py`, `test_event_parser.py`, `test_session_manager.py`)

**Checkpoint**: Webex bot has its own copies of all shared modules with Webex-specific config. Slack bot untouched.

---

## Phase 2: Webex Bot Core — WebSocket & Config (Story 1 — P1) 🎯 MVP

**Goal**: Connect to Webex via WebSocket (WDM pattern from jarvis-agent), receive messages, and send basic replies.

**Independent Test**: Bot connects to WebSocket, receives a message in a 1:1 space, and sends a "Hello" reply.

### Implementation

- [x] T010 [US1] Implement `webex_bot/webex_websocket.py` — WebSocket client with WDM device registration, auth, event routing, exponential backoff reconnection (based on jarvis-agent)
- [x] T011 [P] [US1] Implement `webex_bot/utils/config.py` and `webex_bot/utils/config_models.py` — Pydantic config models, env var loading (`WEBEX_BOT_TOKEN`, `CAIPE_URL`, `WEBEX_INTEGRATION_*`)
- [x] T012 [P] [US1] Implement `webex_bot/utils/webex_context.py` — message text extraction, @mention stripping for group spaces
- [x] T013 [US1] Implement `webex_bot/app.py` — entry point: load config, init auth client, init A2A client + session manager, define message/card handlers, start WebSocket client
- [x] T014 [P] [US1] Write `webex_bot/tests/test_webex_websocket.py` — WDM mock, WebSocket connect/auth/recv mock, message routing, reconnection, self-message filtering
- [x] T015 [P] [US1] Write `webex_bot/tests/test_app.py` — handler routing (1:1 vs group, @mention stripping), config loading

**Checkpoint**: Bot connects to Webex via WebSocket and routes messages to handlers.

---

## Phase 3: Webex Bot Core — A2A Streaming & Formatting (Story 1 — P1) 🎯 MVP

**Goal**: Forward user messages to CAIPE supervisor via A2A protocol and stream responses back with the hybrid approach (working → progress updates → final message).

**Independent Test**: User sends a question in Webex, bot shows "Working on it...", updates with progress, then posts the final consolidated response.

### Implementation

- [x] T016 [US1] Implement `webex_bot/utils/webex_formatter.py` — `format_execution_plan()`, `format_tool_notification()`, `format_progress_message()`, `format_error_message()`, `split_long_message()` (7000 char limit)
- [x] T017 [US1] Implement `webex_bot/utils/cards.py` — `send_card()`, `create_feedback_card()`, `create_execution_plan_card()`, `create_error_card()`
- [x] T018 [US1] Implement `webex_bot/utils/ai.py` — `stream_a2a_response_webex()` with hybrid approach: post working message → parse SSE events → throttled updates (3s min) → final message + feedback card
- [x] T019 [US1] Wire `stream_a2a_response_webex()` into `app.py` message handler
- [x] T020 [P] [US1] Write `webex_bot/tests/test_webex_formatter.py` — plan formatting, tool notifications, long message splitting, error formatting
- [x] T021 [P] [US1] Write `webex_bot/tests/test_cards.py` — card schema validation, feedback card, HITL form card
- [x] T022 [P] [US1] Write `webex_bot/tests/test_ai.py` — mock A2A client + Webex API, verify working message, progress updates, final message, feedback card, error handling

**Checkpoint**: Bot receives messages, streams A2A responses with progress, and posts formatted results. Story 1 MVP is complete.

---

## Phase 4: Space Authorization — Bot Side (Story 2b — P1)

**Goal**: Authorize Webex spaces to use CAIPE via a dynamic MongoDB-backed registry with TTL cache. Unauthorized spaces receive a denial message.

**Independent Test**: Bot in unauthorized group space → denial message. User runs `@caipe authorize` → bot sends Adaptive Card with "Connect to CAIPE" link.

### Implementation

- [x] T023 [US2b] Implement `webex_bot/utils/space_auth.py` — `SpaceAuthorizationManager` class (MongoDB + in-memory TTL cache), `handle_authorize_command()` function
- [x] T024 [US2b] Add `create_authorize_card()` to `webex_bot/utils/cards.py` — Adaptive Card with "Connect to CAIPE" button linking to `CAIPE_UI_BASE_URL/api/admin/integrations/webex/authorize?roomId=<roomId>`
- [x] T025 [US2b] Wire authorization check into `app.py` message handler: skip for 1:1 (`roomType == "direct"`), detect `authorize` command, check `space_auth_manager.is_authorized()`, deny with message if unauthorized
- [x] T026 [US2b] Write `webex_bot/tests/test_space_auth.py` — cache hit (skip DB), cache miss (query DB), TTL expiry (re-query), MongoDB unavailable (fallback), authorize command detection, deny message

**Checkpoint**: Space authorization enforced on bot side. Unauthorized spaces get denial + instructions.

---

## Phase 5: CAIPE UI — Authorization API & Admin Dashboard (Stories 2b, 2b-admin — P1/P2)

**Goal**: CAIPE UI provides API endpoints for space authorization (OIDC-gated) and an admin dashboard tab for managing authorized Webex spaces.

**Independent Test**: Admin can add/revoke spaces via dashboard. User clicking "Connect to CAIPE" link authenticates via OIDC and registers the space.

### Implementation

- [x] T027 [P] [US2b] Add `AuthorizedWebexSpace` TypeScript interface to `ui/src/types/mongodb.ts`
- [x] T028 [P] [US2b] Add `authorized_webex_spaces` collection and indexes (`roomId` unique, `status`) to `ui/src/lib/mongodb.ts`
- [x] T029 [US2b] Create `ui/src/app/api/admin/integrations/webex/authorize/route.ts` — GET (auth page redirect with OIDC validation), POST (store authorized space in MongoDB after OIDC group check)
- [x] T030 [US2b-admin] Create `ui/src/app/api/admin/integrations/webex/spaces/route.ts` — GET (list authorized spaces with pagination, `requireAdminView`), POST (add space by room ID, `requireAdmin`)
- [x] T031 [US2b-admin] Create `ui/src/app/api/admin/integrations/webex/spaces/[id]/route.ts` — DELETE (revoke authorization, `requireAdmin`)
- [x] T032 [US2b-admin] Add "Integrations" or "Webex Spaces" tab to admin dashboard (`ui/src/app/(app)/admin/page.tsx`) — table with Space Name, Room ID, Authorized By, Date, Actions (Revoke); "Add Space" button
- [x] T033 [US2b] Write API tests for authorization endpoints — CRUD operations, OIDC session validation, admin role enforcement, error handling

**Checkpoint**: Full authorization flow works end-to-end: bot command → UI auth → MongoDB → bot allows messages.

---

## Phase 6: Threading & HITL (Stories 4, 5 — P2/P3)

**Goal**: Support threaded conversations in group spaces and Human-in-the-Loop interactive forms via Adaptive Cards.

**Independent Test**: Bot replies in a thread when user messages in a group space thread. HITL form appears as an Adaptive Card and submission continues the A2A flow.

### Implementation

- [x] T034 [US4] Add `parentId`-based threading to `app.py` message handler and `stream_a2a_response_webex()` — use `roomId:parentId` as thread key for group spaces
- [x] T035 [US5] Implement `webex_bot/utils/hitl_handler.py` — `WebexHITLHandler` class: `handle_card_action()`, `_extract_form_values()`, `_submit_response()`
- [x] T036 [US5] Add `create_hitl_form_card()` and `create_user_input_card()` to `webex_bot/utils/cards.py`
- [x] T037 [US5] Wire card action handler in `app.py` — route `cardAction` WebSocket events to `WebexHITLHandler`
- [x] T038 [P] [US4] Write threading tests — thread key generation, parent ID propagation, session mapping
- [x] T039 [P] [US5] Write HITL tests — card action extraction, form value mapping, A2A response submission

**Checkpoint**: Threading and HITL fully functional.

---

## Phase 7: Deployment (Story 1 — FR-011)

**Purpose**: Containerize, configure Docker Compose, Helm charts, CI, and environment.

- [x] T040 [P] [US1] Create `build/Dockerfile.webex-bot` — Python 3.13-slim, non-root user, healthcheck, COPY webex_bot only (self-contained)
- [x] T041 [P] [US1] Add webex-bot service to `docker-compose.yaml` (production) and `docker-compose.dev.yaml` (dev with volume mounts)
- [x] T042 [US1] Create Helm subchart `charts/ai-platform-engineering/charts/webex-bot/` — `Chart.yaml`, `values.yaml`, `templates/` (deployment, configmap, external-secret, serviceaccount)
- [x] T043 [US1] Update parent Helm chart — add webex-bot dependency in `Chart.yaml`, add webex-bot config block in `values.yaml`
- [x] T044 [P] [US1] Create `deploy/secrets-examples/webex-secret.yaml.example` with `WEBEX_BOT_TOKEN` template
- [x] T045 [P] [US1] Update `.env.example` with all `WEBEX_INTEGRATION_*` and `WEBEX_SPACE_AUTH_*` variables
- [x] T046 [US1] Update CI workflow paths (`.github/workflows/`) to add webex-bot Dockerfile build trigger
- [x] T047 [US1] Update root `Makefile` with webex-bot test targets (`test-webex-bot`, `lint-webex-bot`)

**Checkpoint**: Webex bot can be built and deployed via Docker Compose and Helm.

---

## Phase 8: Documentation & Cleanup

**Purpose**: User-facing docs, ADR, and spec status update.

- [x] T048 [P] Create `docs/docs/integrations/webex-bot.md` — setup guide, env vars, features, troubleshooting
- [x] T049 [P] Create ADR in `docs/docs/changes/2026-03-18-webex-bot-integration.md` — architecture decision, deferred commonization rationale
- [x] T050 Update `docs/docs/specs/098-webex-bot-integration/spec.md` status from Draft to Implemented

**Checkpoint**: All documentation complete. Feature is production-ready.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Copy Modules)
    │
    ▼
Phase 2 (WebSocket & Config)  ──→  Phase 3 (A2A Streaming)  ──→  Phase 4 (Space Auth Bot)
                                                                        │
                                                                        ▼
                                                               Phase 5 (UI Auth API)
                                                                        │
Phase 6 (Threading & HITL) ←── depends on Phase 3                       │
    │                                                                   │
    ▼                                                                   ▼
Phase 7 (Deployment) ←── depends on Phases 3, 4, 5
    │
    ▼
Phase 8 (Documentation)
```

### Parallel Opportunities

- **Phase 1**: T002–T007 can all run in parallel (different files, no deps)
- **Phase 2**: T011, T012, T014, T015 can run in parallel
- **Phase 3**: T016, T017 can run in parallel; T020, T021, T022 can run in parallel
- **Phase 4 & Phase 5**: Can run in parallel (bot side + UI side)
- **Phase 6**: T038, T039 can run in parallel
- **Phase 7**: T040, T041, T044, T045 can run in parallel
- **Phase 8**: T048, T049 can run in parallel

### MVP Path (Minimum Viable)

For a working Webex bot without space authorization or HITL:

1. Phase 1 → Phase 2 → Phase 3 → Phase 7 (deployment subset: Dockerfile + docker-compose)

### Full Feature Path

Phase 1 → 2 → 3 → 4 + 5 (parallel) → 6 → 7 → 8

---

## Notes

- [P] tasks = different files, no dependencies — can be dispatched to parallel agents
- Slack bot is NOT modified — verify with `git diff` that no files under `slack_bot/` are changed
- All Webex bot code lives under `ai_platform_engineering/integrations/webex_bot/`
- All UI code lives under `ui/src/app/api/admin/integrations/webex/`
- Commit after each phase with conventional commit format + DCO sign-off
