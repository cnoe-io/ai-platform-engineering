# Research: 096 - Refactor Quick Sanity Integration Workflows

**Date**: 2026-03-20
**Spec**: [spec.md](./spec.md)

## R1: Docker Compose Profiles for Dev Workflow

**Decision**: Use multiple `--profile` flags to compose the dev workflow's service set.

**Rationale**: `docker-compose.dev.yaml` assigns every service to at least one profile. There is no single "everything minus graph-rag" profile. The correct combination is:

| Profile            | What it starts                                                    |
|--------------------|-------------------------------------------------------------------|
| `caipe-supervisor` | Supervisor agent                                                  |
| `caipe-mongodb`    | MongoDB (supervisor state)                                        |
| `deps`             | MongoDB, Neo4j, Redis, Milvus, etcd, MinIO (shared deps)         |
| `caipe-ui`         | CAIPE UI                                                          |
| `all-agents`       | All A2A sub-agents except netutils, komodor, victorops, jarvis    |
| `netutils-agent`   | NetUtils agent + MCP                                              |
| `rag`              | RAG server, rag-redis, Milvus, etcd, MinIO                       |

Profiles explicitly **excluded**: `graph_rag`, `tracing`, `evaluation`, `dynamic-agents`, `slack-bot`, `langgraph-*`, `slim`, individual agent profiles already covered by `all-agents`.

**Alternatives considered**:
- Single `--profile=p2p`: Current approach, but `p2p` profile doesn't exist in docker-compose.dev.yaml, so no profiled services start. This is why the current dev workflow fails at service startup.
- Creating a new composite profile: Over-engineers the solution; multiple `--profile` flags are standard docker-compose usage.

## R2: `CAIPE_CHART_VERSION` for Release-Tag Workflow

**Decision**: Pass the resolved semver tag as `CAIPE_CHART_VERSION` environment variable to `setup-caipe.sh`.

**Rationale**: `setup-caipe.sh` reads `CAIPE_CHART_VERSION` at line 5 and if pre-set, uses it directly (skips version picker in both interactive and non-interactive modes). The Helm install at line 2147 uses `--version "$CAIPE_CHART_VERSION"`. This is the documented, supported way to pin chart versions.

**Alternatives considered**:
- Passing version as a CLI flag: No such flag exists; env var is the designed interface.
- Letting the script auto-resolve: Would get latest from OCI, not the specific release tag we want to test.

## R3: Quick Sanity Test Compatibility with Minimal Agent Set

**Decision**: The quick sanity test (`make quick-sanity`) sends a GitHub-specific query that requires the GitHub agent. For the release-tag workflow (supervisor + weather + netutils only), use `setup-caipe.sh validate` instead, which runs built-in sanity tests (agent card, basic A2A "What is 2+2?", UI health, sub-agent health) that don't require the GitHub agent.

**Rationale**: The integration test file `integration/test_prompts_quick_sanity.yaml` contains a single prompt: "Find description of github repo name ai-platform-engineering in cnoe-io org" with expected keywords including "github" and "repository". Without the GitHub agent deployed, the supervisor cannot answer this query, and the test would fail.

The `setup-caipe.sh validate` command (lines 3414-3434) runs `run_validation` + `run_sanity_tests` which test:
- T1: Agent card validity
- T2: Basic A2A communication ("What is 2+2?")
- T3: UI serves HTML
- T4: Sub-agent health (weather + netutils in-cluster)
- T5: RAG health (skipped when RAG disabled)
- T6: Langfuse health (skipped when tracing disabled)

These tests are appropriate for the minimal agent set.

For the dev workflow (all agents + RAG), `make quick-sanity` remains appropriate since the GitHub agent is available.

**Alternatives considered**:
- Creating a new test prompts YAML for minimal: Adds maintenance burden for a test that already exists in `setup-caipe.sh`.
- Adding GitHub agent to the release-tag workflow: Contradicts the spec requirement for minimal (supervisor + weather + netutils only).

## R4: Port-Forwarding for Kind-based Tests

**Decision**: Use `setup-caipe.sh validate` which handles port-forwarding automatically.

**Rationale**: `setup-caipe.sh validate` (line 3424-3429) calls `start_pf` to port-forward:
- `caipe-supervisor-agent:8000` → `localhost:8000`
- `caipe-caipe-ui:3000` → `localhost:3000`

Then runs validation and sanity tests. This matches the `A2A_HOST=localhost` / `A2A_PORT=8000` defaults used by the integration test client.

For the dev workflow using docker-compose, services bind directly to localhost ports (supervisor on 8000), so no port-forwarding is needed.

## R5: Concurrency Groups

**Decision**: Add `concurrency` groups to both workflows to prevent overlapping runs on the same self-hosted runner.

**Rationale**: None of the current quick-sanity workflows have concurrency groups. Since both workflows run on the same `caipe-integration-tests` runner and compete for ports (8000, 3000) and resources (Kind cluster named `caipe`, docker-compose services), concurrent runs would conflict.

**Implementation**:
- Release-tag workflow: `concurrency: { group: caipe-integration-release, cancel-in-progress: false }`
- Dev workflow: `concurrency: { group: caipe-integration-dev, cancel-in-progress: true }` (cancel older in-progress dev runs when new code is pushed)

## R6: Resolving Latest Semver Release Tag

**Decision**: Use `git tag --sort=-version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1` to resolve the latest release tag (same pattern used by the current `tests-quick-sanity-integration-on-stable-tag.yml`).

**Rationale**: This is the proven approach already in use. It filters out pre-release tags (rc, alpha, beta) and the `stable` alias tag, returning only clean semver releases sorted by version.

For the `workflow_dispatch` trigger, the workflow should also accept an optional `chart_version` input to allow testing a specific version.

## R7: Leftover Kind Cluster Cleanup

**Decision**: Run `setup-caipe.sh nuke` in the `always` cleanup step, preceded by a `kind delete cluster --name caipe` fallback.

**Rationale**: `setup-caipe.sh nuke` runs the full cleanup (Helm uninstall, PVC/secret/namespace deletion, and optionally Kind cluster deletion). However, if the initial setup failed partway through, the script's cleanup might not cover all cases. A pre-step `kind delete cluster --name caipe 2>/dev/null || true` ensures any leftover cluster from a previous failed run is cleaned up before starting.
