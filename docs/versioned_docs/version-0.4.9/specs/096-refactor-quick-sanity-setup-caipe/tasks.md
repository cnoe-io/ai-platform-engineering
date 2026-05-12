# Tasks: Refactor Quick Sanity Integration Workflows

**Input**: Design documents from `/specs/096-refactor-quick-sanity-setup-caipe/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Not explicitly requested in the feature specification. Validation is performed by running the workflows themselves via `workflow_dispatch`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Review current workflow files and establish shared patterns

- [x] T001 Read current workflow files to understand existing structure: `.github/workflows/tests-quick-sanity-integration-dev.yml`, `.github/workflows/tests-quick-sanity-integration-on-latest-tag.yml`, `.github/workflows/tests-quick-sanity-integration-on-stable-tag.yml`
- [x] T002 Read `setup-caipe.sh` usage section (lines 3599-3710) and validate command (lines 3414-3434) to confirm invocation patterns for the release-tag workflow

**Checkpoint**: Existing workflow structure and setup-caipe.sh invocation patterns are understood.

---

## Phase 2: User Story 1 - Release-Tag Integration Test via setup-caipe.sh (Priority: P1)

**Goal**: Rewrite `tests-quick-sanity-integration-on-latest-tag.yml` into a release-tag workflow that uses `setup-caipe.sh` with Kind, deploys a specific Helm chart version (resolved from the latest semver release tag), validates with built-in sanity tests, and cleans up.

**Independent Test**: Trigger via `workflow_dispatch` on GitHub Actions. Verify Kind cluster created, Helm chart deployed, `setup-caipe.sh validate` passes, Kind cluster deleted.

### Implementation for User Story 1

- [x] T003 [P] [US1] Rewrite `.github/workflows/tests-quick-sanity-integration-on-latest-tag.yml` with the following changes:
  - Rename workflow to `[Tests][Release Tag] Quick Sanity Integration`
  - Change triggers: remove `push.branches: [main]` and `schedule`; add `push.tags: ['[0-9]+.[0-9]+.[0-9]+']` and `workflow_dispatch` with optional `chart_version` string input
  - Add `concurrency: { group: caipe-integration-release, cancel-in-progress: false }`
  - Remove `create-stable-tag-and-test` job entirely (satisfies FR-014)
  - Rewrite `quick-sanity` job as `quick-sanity-release` with steps:
    1. Cleanup previous run artifacts (keep existing step)
    2. Ensure workspace directory exists (keep existing step)
    3. Checkout with `fetch-tags: true`, `fetch-depth: 0`
    4. Pre-clean Kind cluster: `kind delete cluster --name caipe 2>/dev/null || true`
    5. Resolve chart version: if `github.event.inputs.chart_version` is set use it, otherwise `git tag --sort=-version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1`. Set as `CHART_VERSION` env var. Fail if empty.
    6. Create `.env` from GitHub Secrets (keep existing credential injection pattern, add `ENABLE_TRACING=false`)
    7. Run setup-caipe.sh: `CAIPE_CHART_VERSION=$CHART_VERSION ./setup-caipe.sh --non-interactive --create-cluster setup`
    8. Run validation: `./setup-caipe.sh validate`
    9. On failure: collect pod logs via `kubectl get pods -n caipe -o wide` and `kubectl logs -n caipe --all-containers --tail=300 -l app.kubernetes.io/instance=caipe`
    10. Upload logs artifact (always): collect logs to file and upload with `actions/upload-artifact@v7`, name `kind-logs-release-${{ env.CHART_VERSION }}`
    11. Cleanup (always): `./setup-caipe.sh nuke` then `kind delete cluster --name caipe 2>/dev/null || true` then `docker rmi -f $(docker images -aq) 2>/dev/null || true`

**Checkpoint**: Release-tag workflow is fully rewritten. Can be tested independently via `workflow_dispatch`.

---

## Phase 3: User Story 2 - Dev Integration Test via Docker Compose (Priority: P1)

**Goal**: Rewrite `tests-quick-sanity-integration-dev.yml` to use `docker-compose.dev.yaml` with multi-profile invocation for all agents + RAG (no GraphRAG), run `make quick-sanity`, and clean up.

**Independent Test**: Trigger via `workflow_dispatch` on GitHub Actions. Verify all agents + RAG containers start, `make quick-sanity` passes, docker-compose services torn down.

### Implementation for User Story 2

- [x] T004 [P] [US2] Rewrite `.github/workflows/tests-quick-sanity-integration-dev.yml` with the following changes:
  - Keep workflow name `[Tests][Dev] Quick Sanity Integration`
  - Keep triggers: `push.branches: [main]` and `workflow_dispatch`
  - Add `concurrency: { group: caipe-integration-dev, cancel-in-progress: true }`
  - Rewrite `quick-sanity` job as `quick-sanity-dev` with steps:
    1. Cleanup previous run artifacts (keep existing step)
    2. Ensure workspace directory exists (keep existing step)
    3. Checkout with `actions/checkout@v6`
    4. Create `.env` from GitHub Secrets: keep existing credential injection, add `ENABLE_RAG=true`, `ENABLE_TRACING=false`, add `ENABLE_*=true` flags for all agents included in the `all-agents` profile (ENABLE_ARGOCD, ENABLE_AWS, ENABLE_BACKSTAGE, ENABLE_CONFLUENCE, ENABLE_GITHUB, ENABLE_JIRA, ENABLE_PAGERDUTY, ENABLE_PETSTORE, ENABLE_SLACK, ENABLE_SPLUNK, ENABLE_WEBEX, ENABLE_WEATHER, ENABLE_NETUTILS)
    5. Show Docker version (keep existing step)
    6. Setup Python 3.13 with `actions/setup-python@v6` (keep existing step)
    7. Install uv (keep existing step)
    8. Start services: `docker compose -f docker-compose.dev.yaml --profile caipe-supervisor --profile caipe-mongodb --profile deps --profile caipe-ui --profile all-agents --profile netutils-agent --profile rag up -d --build`
    9. Stream service logs (background): `docker compose -f docker-compose.dev.yaml --profile caipe-supervisor --profile caipe-mongodb --profile deps --profile caipe-ui --profile all-agents --profile netutils-agent --profile rag logs -f --no-color --timestamps | tee -a compose-live.log` (background shell)
    10. Wait for readiness: poll `localhost:8000/.well-known/agent.json` up to 36 times, 5s interval (~3min)
    11. Install GNU Make (keep existing step)
    12. Run Quick Sanity Tests: `make quick-sanity`
    13. On failure: show last 300 lines of `compose-live.log`
    14. Upload logs artifact (always): upload `compose-live.log` with name `compose-logs-dev`
    15. Cleanup (always): `docker compose -f docker-compose.dev.yaml --profile caipe-supervisor --profile caipe-mongodb --profile deps --profile caipe-ui --profile all-agents --profile netutils-agent --profile rag down -v --remove-orphans || true` then `docker rmi -f $(docker images -aq) 2>/dev/null || true`

**Checkpoint**: Dev workflow is fully rewritten. Can be tested independently via `workflow_dispatch`.

---

## Phase 4: User Story 3 - Remove Stable-Tag Workflow and Legacy Git Tags (Priority: P2)

**Goal**: Delete the stable-tag workflow file and delete both the `stable` and `latest` git tags from the remote repository.

**Independent Test**: Verify the workflow file no longer exists. Verify `git ls-remote --tags origin | grep -E 'stable|latest'` returns empty (only semver tags remain).

### Implementation for User Story 3

- [x] T005 [US3] Delete `.github/workflows/tests-quick-sanity-integration-on-stable-tag.yml` (git rm)
- [x] T006 [US3] Delete the `stable` and `latest` git tags from the remote: `git push origin :refs/tags/stable` and `git push origin :refs/tags/latest` (and local: `git tag -d stable 2>/dev/null || true` and `git tag -d latest 2>/dev/null || true`)
- [x] T007 [US3] Verify no remaining references to `stable` tag, `latest` tag, or `tests-quick-sanity-integration-on-stable-tag.yml` in any workflow file by grepping `.github/workflows/*.yml` for `stable` and `latest` (exclude semver tag patterns and `latest-tag` in workflow filenames)

**Checkpoint**: Stable-tag workflow and both legacy git tags (`stable`, `latest`) are completely removed. No dangling references.

---

## Phase 5: User Story 4 - Self-Hosted Runner Compatibility (Priority: P3)

**Goal**: Ensure both workflows are compatible with the `caipe-integration-tests` self-hosted runner.

**Independent Test**: Both workflows specify `runs-on: caipe-integration-tests`. The `setup-caipe.sh` prerequisite check validates `kind`, `kubectl`, `helm`, `openssl`, `curl`, `jq`. The dev workflow uses standard Docker Compose commands.

### Implementation for User Story 4

- [x] T008 [US4] Verify both rewritten workflows specify `runs-on: caipe-integration-tests` in `.github/workflows/tests-quick-sanity-integration-dev.yml` and `.github/workflows/tests-quick-sanity-integration-on-latest-tag.yml`
- [x] T009 [US4] Verify concurrency groups are set correctly to prevent overlapping runs: `caipe-integration-release` (no cancel) and `caipe-integration-dev` (cancel-in-progress)

**Checkpoint**: Runner compatibility confirmed. Concurrency protection in place.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and documentation

- [x] T010 Validate all workflow YAML files parse correctly: `python -c "import yaml; yaml.safe_load(open('.github/workflows/tests-quick-sanity-integration-dev.yml')); yaml.safe_load(open('.github/workflows/tests-quick-sanity-integration-on-latest-tag.yml'))"` or use `actionlint` if available
- [x] T011 Run quickstart.md validation steps from `docs/docs/specs/096-refactor-quick-sanity-setup-caipe/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **US1 (Phase 2)**: Depends on Phase 1 — can run in parallel with US2
- **US2 (Phase 3)**: Depends on Phase 1 — can run in parallel with US1
- **US3 (Phase 4)**: No dependencies on US1/US2 — can run in parallel. Note: T003 already removes the `create-stable-tag-and-test` job that references the stable workflow.
- **US4 (Phase 5)**: Depends on US1 and US2 completion (verifies their output)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Independent. Operates on `tests-quick-sanity-integration-on-latest-tag.yml`
- **User Story 2 (P1)**: Independent. Operates on `tests-quick-sanity-integration-dev.yml`
- **User Story 3 (P2)**: Independent. Operates on `tests-quick-sanity-integration-on-stable-tag.yml` (delete) + remote tag
- **User Story 4 (P3)**: Depends on US1 + US2 (verification only)

### Parallel Opportunities

- **T003 and T004** can run in parallel (different workflow files, no dependencies)
- **T005 and T006** can run in parallel (different artifacts — file vs tag)
- **US1, US2, and US3** can all proceed in parallel after Phase 1

---

## Parallel Example: User Story 1 + User Story 2

```bash
# These two tasks operate on different files and can run concurrently:
Task T003: "Rewrite release-tag workflow in .github/workflows/tests-quick-sanity-integration-on-latest-tag.yml"
Task T004: "Rewrite dev workflow in .github/workflows/tests-quick-sanity-integration-dev.yml"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (read existing files)
2. Complete Phase 2: US1 — Rewrite release-tag workflow
3. **STOP and VALIDATE**: Trigger via `workflow_dispatch`, verify Kind deploy + validate + cleanup
4. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup → Patterns understood
2. Implement US1 (release-tag) → Test via `workflow_dispatch` → Verify
3. Implement US2 (dev) → Test via `workflow_dispatch` → Verify
4. Implement US3 (cleanup) → Delete stable workflow + tag → Verify
5. Implement US4 (verify compatibility) → Final checks
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Complete Setup together
2. Once Setup is done:
   - Developer A: US1 (release-tag workflow)
   - Developer B: US2 (dev workflow)
   - Developer C: US3 (delete stable workflow + tag)
3. Stories complete and integrate independently
4. US4 verification after all others done

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- T003 (US1) and T004 (US2) are the core implementation tasks — each is a full workflow rewrite
- T005-T007 (US3) are simple deletion/cleanup tasks
- T008-T009 (US4) are verification-only tasks
- No test code is generated; validation is done by running workflows via `workflow_dispatch`
- The `stable` and `latest` tag deletions (T006) should be coordinated — confirm no CI/CD depends on them before pushing
