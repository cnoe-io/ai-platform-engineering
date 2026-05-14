# Implementation Plan: Refactor Quick Sanity Integration Workflows

**Branch**: `096-refactor-quick-sanity-setup-caipe` | **Date**: 2026-03-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/096-refactor-quick-sanity-setup-caipe/spec.md`

## Summary

Refactor the CI quick sanity integration testing into two distinct workflows: (1) a release-tag workflow that uses `setup-caipe.sh` to deploy a specific Helm chart version into a Kind cluster with minimal agents (supervisor, weather, netutils) and validates using built-in sanity tests, and (2) a dev workflow that uses `docker-compose.dev.yaml` with all agents + RAG (no GraphRAG) and runs `make quick-sanity`. Remove the stable-tag workflow, the `stable` git tag, and the `create-stable-tag-and-test` job from the latest-tag workflow.

## Technical Context

**Language/Version**: YAML (GitHub Actions workflows), Bash (setup-caipe.sh invocation)
**Primary Dependencies**: GitHub Actions, setup-caipe.sh, docker-compose, Kind, Helm, kubectl
**Storage**: N/A
**Testing**: `setup-caipe.sh validate` (release-tag workflow), `make quick-sanity` (dev workflow)
**Target Platform**: GitHub Actions self-hosted runner (`caipe-integration-tests`, Ubuntu)
**Project Type**: CI/CD workflow configuration
**Performance Goals**: Total workflow execution within 150% of current approach
**Constraints**: Single self-hosted runner; workflows must not run concurrently
**Scale/Scope**: 3 workflow files modified/created, 1 deleted, 1 git tag deleted

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| Branching convention (`prebuild/<type>/<desc>`) | PASS | Branch is `096-refactor-quick-sanity-setup-caipe`, will use `prebuild/ci/refactor-quick-sanity-setup-caipe` for PR |
| Conventional Commits | PASS | Will use `ci(workflows): ...` type |
| DCO sign-off | PASS | `git commit -s` |
| Quality gates (`make lint`, `make test`) | PASS | No Python/TS code changes; workflow YAML validated by GitHub Actions |
| Test-first (VII) | PASS | Acceptance criteria from spec become workflow validation steps |
| No secrets in source (IX) | PASS | Credentials injected via GitHub Secrets → `.env` file |
| Simplicity (X) | PASS | Reusing existing `setup-caipe.sh` and `make quick-sanity`; no new abstractions |
| Spec-driven workflow | PASS | Full specify → plan → tasks → implement pipeline |

**Post-Phase 1 re-check**: No violations introduced. The design reuses existing tools (`setup-caipe.sh`, docker-compose profiles, `make quick-sanity`) without new abstractions.

## Project Structure

### Documentation (this feature)

```text
specs/096-refactor-quick-sanity-setup-caipe/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 research output
├── data-model.md        # Phase 1 output (minimal - no data entities)
├── quickstart.md        # Phase 1 output (testing guide)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
.github/workflows/
├── tests-quick-sanity-integration-dev.yml           # MODIFY: refactor to docker-compose.dev.yaml + all-agents + rag
├── tests-quick-sanity-integration-on-latest-tag.yml # MODIFY: replace with release-tag workflow using setup-caipe.sh + Kind
└── tests-quick-sanity-integration-on-stable-tag.yml # DELETE: removed entirely
```

**Structure Decision**: This feature modifies only GitHub Actions workflow YAML files in `.github/workflows/`. No source code, Helm charts, or test files are changed.

## Phase 0: Research Findings

All research is documented in [research.md](./research.md). Key decisions:

| ID | Topic | Decision | Reference |
|----|-------|----------|-----------|
| R1 | Docker Compose profiles | Use `caipe-supervisor`, `caipe-mongodb`, `deps`, `caipe-ui`, `all-agents`, `netutils-agent`, `rag` profiles | [R1](./research.md#r1-docker-compose-profiles-for-dev-workflow) |
| R2 | Chart version pinning | Pass `CAIPE_CHART_VERSION` env var to `setup-caipe.sh` | [R2](./research.md#r2-caipe_chart_version-for-release-tag-workflow) |
| R3 | Test suite for minimal agents | Use `setup-caipe.sh validate` for release-tag (no GitHub agent), `make quick-sanity` for dev | [R3](./research.md#r3-quick-sanity-test-compatibility-with-minimal-agent-set) |
| R4 | Port-forwarding | `setup-caipe.sh validate` handles it; docker-compose binds directly | [R4](./research.md#r4-port-forwarding-for-kind-based-tests) |
| R5 | Concurrency | Separate concurrency groups per workflow; cancel-in-progress for dev only | [R5](./research.md#r5-concurrency-groups) |
| R6 | Tag resolution | `git tag --sort=-version:refname` with semver grep | [R6](./research.md#r6-resolving-latest-semver-release-tag) |
| R7 | Leftover cleanup | Pre-step `kind delete cluster` + post-step `setup-caipe.sh nuke` | [R7](./research.md#r7-leftover-kind-cluster-cleanup) |

## Phase 1: Design

### Workflow 1: Release-Tag Integration Test (`tests-quick-sanity-integration-on-latest-tag.yml` — rewritten)

**File**: `.github/workflows/tests-quick-sanity-integration-on-latest-tag.yml`
**Name**: `[Tests][Release Tag] Quick Sanity Integration`

**Triggers**:
- `push.tags`: `['[0-9]+.[0-9]+.[0-9]+']` (semver tags only)
- `workflow_dispatch` with optional `chart_version` input

**Concurrency**: `group: caipe-integration-release, cancel-in-progress: false`

**Job: `quick-sanity-release`** (runs-on: `caipe-integration-tests`)

| Step | Name | Action |
|------|------|--------|
| 1 | Cleanup previous artifacts | Remove `__pycache__`, `.pyc`, `.pyo` files |
| 2 | Ensure workspace directory | `mkdir -p` + `chown` |
| 3 | Checkout | `actions/checkout@v6` with `fetch-tags: true`, `fetch-depth: 0` |
| 4 | Pre-clean Kind cluster | `kind delete cluster --name caipe 2>/dev/null \|\| true` |
| 5 | Resolve chart version | If `workflow_dispatch` input provided, use it. Otherwise resolve latest semver tag via `git tag --sort=-version:refname` |
| 6 | Create .env from Secrets | Same credential injection as current workflows |
| 7 | Run setup-caipe.sh | `CAIPE_CHART_VERSION=$CHART_VERSION ./setup-caipe.sh --non-interactive --create-cluster setup` |
| 8 | Run validation & sanity | `./setup-caipe.sh validate` (includes port-forward, agent card check, A2A test, UI health, sub-agent health) |
| 9 | On failure: show logs | `kubectl logs` from caipe namespace |
| 10 | Upload logs artifact | Upload pod logs as artifact |
| 11 | Cleanup (always) | `./setup-caipe.sh nuke` then `kind delete cluster --name caipe 2>/dev/null \|\| true` |

### Workflow 2: Dev Integration Test (`tests-quick-sanity-integration-dev.yml` — rewritten)

**File**: `.github/workflows/tests-quick-sanity-integration-dev.yml`
**Name**: `[Tests][Dev] Quick Sanity Integration`

**Triggers**:
- `push.branches`: `[main]`
- `workflow_dispatch`

**Concurrency**: `group: caipe-integration-dev, cancel-in-progress: true`

**Job: `quick-sanity-dev`** (runs-on: `caipe-integration-tests`)

| Step | Name | Action |
|------|------|--------|
| 1 | Cleanup previous artifacts | Remove `__pycache__`, `.pyc`, `.pyo` files |
| 2 | Ensure workspace directory | `mkdir -p` + `chown` |
| 3 | Checkout | `actions/checkout@v6` |
| 4 | Create .env from Secrets | Same credential injection, plus `ENABLE_RAG=true`, `ENABLE_TRACING=false` |
| 5 | Show Docker version | `docker version` / `docker compose version` |
| 6 | Setup Python | `actions/setup-python@v6` (3.13) |
| 7 | Install uv | curl install |
| 8 | Start services | `docker compose -f docker-compose.dev.yaml --profile caipe-supervisor --profile caipe-mongodb --profile deps --profile caipe-ui --profile all-agents --profile netutils-agent --profile rag up -d --build` |
| 9 | Stream logs (background) | `docker compose ... logs -f --no-color --timestamps \| tee compose-live.log` |
| 10 | Wait for readiness | Poll `localhost:8000/.well-known/agent.json` up to 36x (5s each, ~3min) |
| 11 | Install GNU Make | `sudo apt-get install -y make` |
| 12 | Run Quick Sanity Tests | `make quick-sanity` |
| 13 | On failure: show logs | `tail -n 300 compose-live.log` |
| 14 | Upload logs artifact | Upload `compose-live.log` |
| 15 | Cleanup (always) | `docker compose -f docker-compose.dev.yaml ... down -v --remove-orphans`, `docker rmi -f $(docker images -aq)` |

### Workflow 3: Delete Stable-Tag Workflow

**Action**: Delete `.github/workflows/tests-quick-sanity-integration-on-stable-tag.yml`

### Git Tag Cleanup

**Action**: Delete the `stable` and `latest` tags from remote:
- `git push origin :refs/tags/stable`
- `git push origin :refs/tags/latest`

### Changes to Existing Files Summary

| File | Action | Key Changes |
|------|--------|-------------|
| `tests-quick-sanity-integration-dev.yml` | Rewrite | Replace `--profile=p2p` with multi-profile docker-compose.dev.yaml; add concurrency group |
| `tests-quick-sanity-integration-on-latest-tag.yml` | Rewrite | Replace docker-compose approach + stable-tag job with setup-caipe.sh + Kind; add concurrency group; remove `create-stable-tag-and-test` job |
| `tests-quick-sanity-integration-on-stable-tag.yml` | Delete | Entire file removed |

**Git Tags to Delete**: `stable`, `latest` (both from remote)

## Complexity Tracking

No constitution violations. All changes reuse existing infrastructure (`setup-caipe.sh`, docker-compose profiles, `make quick-sanity`). No new abstractions, scripts, or patterns introduced.
