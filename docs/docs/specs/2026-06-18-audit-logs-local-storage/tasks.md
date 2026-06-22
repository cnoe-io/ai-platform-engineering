# Tasks: Configurable Audit Log Storage Backend

**Input**: Design documents from `docs/docs/specs/2026-06-18-audit-logs-local-storage/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Organization**: Tasks are grouped by user story (US1 = local disk, US2 = S3, US3 = MongoDB fallback/migration).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new file structure and install dependencies before any backend is implemented.

- [x] T001 Create `ai_platform_engineering/utils/audit_backends/` directory with `__init__.py`
- [x] T002 Create `ui/src/lib/audit/` directory with `index.ts` stub
- [x] T003 Create `ui/src/lib/audit/backends/` directory placeholder
- [x] T004 Add `boto3` to Python dependencies in `pyproject.toml` (if not already present)
- [x] T005 Add `@aws-sdk/client-s3` to `ui/package.json` and run `npm install`

---

## Phase 2: Foundational (AuditBackend Abstraction — Blocking)

**Purpose**: Define the protocol/interface and factory that all backends implement. ALL user-story phases depend on this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 Implement `AuditBackend` Protocol and `get_audit_backend()` factory in `ai_platform_engineering/utils/audit_backend.py`
  - Protocol with single `write(event: Dict[str, Any]) -> None` method
  - Factory reads `AUDIT_LOG_BACKEND` env var; raises `ValueError` for unknown values
  - Module-level singleton with thread-safe double-checked locking
  - Logs startup message: `[audit] backend=<name> ...` (no credentials)
  - Default: `mongodb` when env var is unset

- [x] T007 Implement `AuditBackend` interface and `getAuditBackend()` factory in `ui/src/lib/audit/backend.ts`
  - Interface with `write(event: Record<string, unknown>): void`
  - Factory reads `AUDIT_LOG_BACKEND`; throws `Error` for unknown values
  - Module-level singleton (initialized on first call)
  - Logs startup message via `console.info` (no credentials)
  - Default: `mongodb` when env var is unset

- [x] T008 [P] Add `AUDIT_LOG_BACKEND`, `AUDIT_LOG_LOCAL_PATH`, `AUDIT_LOG_S3_BUCKET`, `AUDIT_LOG_S3_PREFIX`, `AUDIT_LOG_S3_REGION`, `AUDIT_LOG_S3_ENDPOINT_URL` to `ui/src/lib/config.ts` server config

- [x] T009 [P] Add same env vars to `ui/env.example` and `ai_platform_engineering/` env docs

**Checkpoint**: Abstraction is in place — backend implementations can now be built in parallel.

---

## Phase 3: User Story 1 — Local Disk Backend (Priority: P1) 🎯 MVP

**Goal**: All audit events write to NDJSON files on local disk when `AUDIT_LOG_BACKEND=local`. No MongoDB connection required.

**Independent Test**: Start the stack with `AUDIT_LOG_BACKEND=local AUDIT_LOG_LOCAL_PATH=/tmp/audit-test`. Trigger a tool action. Confirm `.ndjson` files appear under `/tmp/audit-test/YYYY/MM/DD/`. No MongoDB error in logs.

- [x] T010 [US1] Implement `LocalBackend` in `ai_platform_engineering/utils/audit_backends/local_backend.py`
  - `write(event)`: serialize event to JSON line, append to `<path>/YYYY/MM/DD/<type>-<YYYYMMDD>-<uuid>.ndjson`
  - Create directory tree with `os.makedirs(exist_ok=True)` on first write
  - UUID generated once at backend init (per-process stable file name)
  - Catch all `OSError`; log warning with `logger.warning`; never raise
  - Serialize `datetime` values to ISO-8601 strings

- [x] T011 [US1] Implement `LocalBackend` in `ui/src/lib/audit/backends/local-backend.ts`
  - `write(event)`: serialize to JSON line, append to `<path>/YYYY/MM/DD/<type>-<YYYYMMDD>-<uuid>.ndjson`
  - Create directory with `fs.mkdir({recursive: true})` on first write
  - UUID generated once at backend init
  - Catch all errors; log with `console.warn`; never throw
  - Serialize `Date` values to ISO strings

- [x] T012 [US1] Wire `LocalBackend` into Python factory in `ai_platform_engineering/utils/audit_backend.py`
  - Return `LocalBackend(path=AUDIT_LOG_LOCAL_PATH)` when `AUDIT_LOG_BACKEND=local`

- [x] T013 [US1] Wire `LocalBackend` into TypeScript factory in `ui/src/lib/audit/backend.ts`
  - Return `new LocalBackend(path)` when `AUDIT_LOG_BACKEND=local`

- [x] T014 [US1] Swap `_persist_to_mongo(event)` for `get_audit_backend().write(event)` in `ai_platform_engineering/utils/audit_logger.py`
  - Remove `_persist_to_mongo` function
  - Remove `_ensure_indexes` and all MongoDB-specific imports from this file
  - Existing `MongoBackend` (T019) encapsulates that logic

- [x] T015 [US1] Swap `persistAuthzDecisionToMongo` + `persistToUnifiedAuditEvents` calls for a single `getAuditBackend().write(...)` call in `ui/src/lib/rbac/audit.ts`
  - Merge the unified `audit_events` shape (include `user_email`, `type`, `source` fields)
  - Keep both private persist functions but call them only from `MongoBackend` (T020)

- [x] T016 [US1] Replace direct `getCollection('credential_audit_events').insertOne(...)` with `getAuditBackend().write(...)` in `ui/src/lib/credentials/audit.ts`

- [x] T017 [P] [US1] Write unit tests for `LocalBackend` (Python) in `tests/test_audit_backend.py`
  - Test: file created at correct path
  - Test: second write appends (file not recreated)
  - Test: directory auto-created
  - Test: write error is caught and logged, does not raise

- [x] T018 [P] [US1] Write unit tests for `LocalBackend` (TypeScript) in `ui/src/lib/audit/__tests__/local-backend.test.ts`
  - Mock `fs/promises`; verify `mkdir` + `appendFile` calls
  - Test error path: FS error is caught, no throw

---

## Phase 4: User Story 2 — S3 Backend (Priority: P2)

**Goal**: All audit events write to a configured S3 bucket as gzip-compressed NDJSON when `AUDIT_LOG_BACKEND=s3`.

**Independent Test**: Configure `AUDIT_LOG_BACKEND=s3` with a valid bucket (or local MinIO). Trigger events. Confirm objects appear in `<prefix>/YYYY/MM/DD/`. Confirm no MongoDB writes.

- [x] T019 [US2] Implement `S3Backend` in `ai_platform_engineering/utils/audit_backends/s3_backend.py`
  - `write(event)`: serialize event to JSON, gzip in-memory, PUT to `s3://<bucket>/<prefix>/YYYY/MM/DD/<type>-<ts>-<uuid>.ndjson.gz`
  - Build `boto3` S3 client with `endpoint_url=AUDIT_LOG_S3_ENDPOINT_URL` if set (MinIO/GCS compat)
  - Standard credential chain (env vars, IRSA `AWS_ROLE_ARN`/`AWS_WEB_IDENTITY_TOKEN_FILE`, instance profile) — no extra code needed
  - Catch all `ClientError` / `BotoCoreError`; log warning; never raise

- [x] T020 [US2] Implement `S3Backend` in `ui/src/lib/audit/backends/s3-backend.ts`
  - `write(event)`: serialize to JSON, gzip with `zlib.gzip`, `PutObjectCommand` to S3
  - Use `@aws-sdk/client-s3` with optional `endpoint` override for MinIO/GCS
  - Standard credential provider chain (picks up `AWS_ROLE_ARN` + `AWS_WEB_IDENTITY_TOKEN_FILE` for IRSA automatically)
  - Catch all errors; log with `console.warn`; never throw

- [x] T021 [US2] Wire `S3Backend` into Python factory in `ai_platform_engineering/utils/audit_backend.py`
  - Return `S3Backend(bucket, prefix, region, endpoint_url)` when `AUDIT_LOG_BACKEND=s3`
  - Raise `ValueError` at factory time if `AUDIT_LOG_S3_BUCKET` is unset

- [x] T022 [US2] Wire `S3Backend` into TypeScript factory in `ui/src/lib/audit/backend.ts`
  - Return `new S3Backend(bucket, prefix, region, endpointUrl)` when `AUDIT_LOG_BACKEND=s3`
  - Throw `Error` at factory time if `AUDIT_LOG_S3_BUCKET` is unset

- [x] T023 [P] [US2] Write unit tests for `S3Backend` (Python) in `tests/test_audit_backend.py`
  - Mock `boto3.client`; verify `put_object` called with correct key pattern and gzip content
  - Test: S3 error is caught and logged, does not raise

- [x] T024 [P] [US2] Write unit tests for `S3Backend` (TypeScript) in `ui/src/lib/audit/__tests__/s3-backend.test.ts`
  - Mock `@aws-sdk/client-s3`; verify `PutObjectCommand` called with correct key and gzip body
  - Test error path: S3 error is caught, no throw

---

## Phase 5: User Story 3 — MongoDB Fallback (Priority: P3)

**Goal**: Extract existing MongoDB write logic into `MongoBackend` so the factory is complete and `AUDIT_LOG_BACKEND` unset/`mongodb` behaves exactly as before.

**Independent Test**: Leave `AUDIT_LOG_BACKEND` unset. Confirm audit events still reach `audit_events` and `authorization_decision_records` in MongoDB. Existing `admin-audit-logs.test.ts` suite passes unchanged.

- [x] T025 [US3] Implement `MongoBackend` in `ai_platform_engineering/utils/audit_backends/mongo_backend.py`
  - Extract logic from the old `_persist_to_mongo` and `_ensure_indexes` in `audit_logger.py` verbatim
  - `write(event)`: inserts into `audit_events` collection (existing behaviour)

- [x] T026 [US3] Implement `MongoBackend` in `ui/src/lib/audit/backends/mongo-backend.ts`
  - Extract `persistAuthzDecisionToMongo` + `persistToUnifiedAuditEvents` logic verbatim from `rbac/audit.ts`
  - `write(event)`: dual-inserts into `authorization_decision_records` + `audit_events` (existing behaviour)

- [x] T027 [US3] Wire `MongoBackend` into Python factory as default in `ai_platform_engineering/utils/audit_backend.py`

- [x] T028 [US3] Wire `MongoBackend` into TypeScript factory as default in `ui/src/lib/audit/backend.ts`

- [x] T029 [P] [US3] Update existing Python tests in `tests/test_audit_logger.py`
  - Replace direct MongoDB mock with `mock.patch('ai_platform_engineering.utils.audit_backend.get_audit_backend')`
  - Verify `backend.write()` is called with the correct event dict; no direct `pymongo` mock needed

- [x] T030 [P] [US3] Verify existing TypeScript tests in `ui/src/app/api/__tests__/admin-audit-logs.test.ts` still pass without modification (MongoDB read paths are unchanged)

---

## Phase 6: Polish & Cross-Cutting

- [x] T031 Export `get_audit_backend`, `AuditBackend` from `ai_platform_engineering/utils/audit_backends/__init__.py`
- [x] T032 Export `getAuditBackend`, `AuditBackend` from `ui/src/lib/audit/index.ts`
- [x] T033 Add `AUDIT_LOG_BACKEND` and related vars to `docker-compose/` env files with defaults (`mongodb`)
- [x] T034 Add `AUDIT_LOG_BACKEND`, `AUDIT_LOG_LOCAL_PATH`, `AUDIT_LOG_S3_BUCKET`, `AUDIT_LOG_S3_PREFIX`, `AUDIT_LOG_S3_REGION` to `charts/ai-platform-engineering/charts/supervisor-agent/values.yaml` under `extraEnv` (commented-out examples)
- [x] T035 Add `serviceAccount.annotations` IRSA example (commented out) to `charts/ai-platform-engineering/charts/supervisor-agent/values.yaml`
- [x] T036 Run `uv run ruff check ai_platform_engineering/utils/audit_backend.py ai_platform_engineering/utils/audit_backends/` and fix any issues
- [x] T037 Run `npm run lint` in `ui/` and fix any TypeScript issues
- [x] T038 Update `ai_platform_engineering/utils/` README to document the new backend abstraction and env vars

---

## Dependencies

```
Phase 1 (Setup)
    └─► Phase 2 (Abstraction — BLOCKS all)
            ├─► Phase 3 (US1 Local) ─────────┐
            ├─► Phase 4 (US2 S3)    ──────────┤
            └─► Phase 5 (US3 Mongo) ──────────┘
                                               │
                                    Phase 6 (Polish)
```

Phase 3, 4, and 5 can be executed in parallel once Phase 2 is complete. Within each phase, tasks marked `[P]` can run in parallel.

---

## Parallel Execution (Phase 2 onwards)

Once T006 + T007 are done, the following can run concurrently:

- **Stream A** (Python local): T010 → T012 → T014 → T017
- **Stream B** (TypeScript local): T011 → T013 → T015 → T016 → T018
- **Stream C** (Python S3): T019 → T021 → T023
- **Stream D** (TypeScript S3): T020 → T022 → T024
- **Stream E** (MongoDB extraction): T025 → T027 → T029 / T026 → T028 → T030

---

## Implementation Strategy

**MVP** (deliver US1 first — unblocks dev environment immediately):
1. Phase 1 + Phase 2 (T001–T009)
2. Phase 3 (T010–T018) — local disk backend, wire into both Python and TypeScript
3. Smoke test: `AUDIT_LOG_BACKEND=local` stack starts, events appear on disk

**Increment 2** (US3 before US2 — ensures no regression):
- Phase 5 (T025–T030) — extract MongoBackend, verify existing tests pass

**Increment 3** (US2 — production-ready):
- Phase 4 (T019–T024) — S3 backend

**Polish** (T031–T038) — after all backends verified.

---

## Summary

| Phase | Story | Tasks | Notes |
|-------|-------|-------|-------|
| 1 Setup | — | T001–T005 | File structure + deps |
| 2 Foundation | — | T006–T009 | Abstraction layer |
| 3 Local disk | US1 P1 | T010–T018 | MVP |
| 4 S3 | US2 P2 | T019–T024 | Production |
| 5 MongoDB | US3 P3 | T025–T030 | No-regression |
| 6 Polish | — | T031–T038 | Helm, docs, lint |
| **Total** | | **38 tasks** | |
