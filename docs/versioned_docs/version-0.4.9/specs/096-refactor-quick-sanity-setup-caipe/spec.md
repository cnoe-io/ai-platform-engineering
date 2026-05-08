# Feature Specification: Refactor Quick Sanity Integration Workflows

**Feature Branch**: `096-refactor-quick-sanity-setup-caipe`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "Refactor quick sanity integration workflows. Create a release-tag workflow using setup-caipe.sh with Kind for minimal verification (supervisor, weather, netutils). Refactor the dev workflow to use docker-compose.dev.yaml with all-agents + RAG (no graph-rag). Remove the stable-tag workflow and the stable git tag."

## Clarifications

### Session 2026-03-20

- Q: Should only the stable-tag workflow be removed, or also the `stable` git tag and its creation logic? → A: Remove the `stable` git tag entirely. Follow standard convention: use the latest semver release tag directly, with no separate `stable` alias tag.
- Q: What should the latest-tag workflow become after removing the `create-stable-tag-and-test` job? → A: Two separate workflows: (1) A release-tag workflow that uses `setup-caipe.sh` with Kind, resolves the latest semver release tag from GitHub Releases (not `latest` or `stable`), and runs on tag push or manual trigger against the tagged Helm chart. (2) A dev workflow that uses `docker-compose.dev.yaml`, brings up all-agents + RAG (no graph-rag), and runs after merge to main or on-demand.
- Q: Should the `latest` git tag also be removed alongside `stable`? → A: Yes. Both `stable` and `latest` git tags must be deleted from the remote. The project uses only semver release tags (e.g., `0.2.41`) as canonical release identifiers.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Release-Tag Integration Test via setup-caipe.sh (Priority: P1)

A CI maintainer wants to validate that a released Helm chart version works end-to-end. A workflow resolves the latest semver release tag from GitHub Releases (e.g., `0.2.41`), provisions a Kind cluster using `setup-caipe.sh`, deploys the tagged Helm chart with only supervisor, weather, and netutils agents (no RAG, no tracing, no GraphRAG, no AgentGateway), runs the quick sanity integration test suite, and tears everything down. This workflow triggers on tag push events or manual dispatch.

**Why this priority**: This is the primary gate for release quality. It validates the exact Helm chart artifact that users install, catching packaging or chart-level regressions that docker-compose testing cannot.

**Independent Test**: Trigger the workflow via `workflow_dispatch`. Verify that a Kind cluster is created, the correct Helm chart version is deployed with only supervisor + weather + netutils, quick sanity tests pass, and the Kind cluster is deleted on teardown.

**Acceptance Scenarios**:

1. **Given** a new semver tag is pushed (e.g., `0.2.41`), **When** the release-tag workflow triggers, **Then** it resolves that tag, creates a Kind cluster, deploys via `setup-caipe.sh` with the tagged Helm chart version, and the supervisor, weather, and netutils pods reach Running state.
2. **Given** the workflow is triggered manually via `workflow_dispatch`, **When** no tag input is provided, **Then** it resolves the latest semver release tag from GitHub Releases and uses that version.
3. **Given** all pods are healthy, **When** the quick sanity test suite runs, **Then** the tests execute against the Kind-deployed services and report pass/fail.
4. **Given** any step fails or succeeds, **When** the workflow completes, **Then** the Kind cluster and all associated resources are cleaned up.

---

### User Story 2 - Dev Integration Test via Docker Compose (Priority: P1)

A CI maintainer wants to validate the latest code on `main` with a broad agent set. After a merge to `main` (or manual trigger), a workflow uses `docker-compose.dev.yaml` to bring up all agents plus RAG (no GraphRAG), runs the quick sanity integration test suite, and tears everything down.

**Why this priority**: This is the primary gate for code quality on main. It tests the broadest agent configuration against the latest development code, catching integration regressions early.

**Independent Test**: Trigger the workflow via `workflow_dispatch`. Verify that docker-compose brings up all agents + RAG services, quick sanity tests pass, and services are torn down.

**Acceptance Scenarios**:

1. **Given** a push to `main`, **When** the dev workflow triggers, **Then** it starts services via `docker-compose.dev.yaml` with all agents and RAG enabled (no GraphRAG), and all service containers reach healthy state.
2. **Given** all services are healthy, **When** the quick sanity test suite runs, **Then** the tests execute against the docker-compose services and report pass/fail.
3. **Given** any step fails or succeeds, **When** the workflow completes, **Then** all docker-compose services are torn down and resources cleaned up.

---

### User Story 3 - Remove Stable-Tag Workflow and Legacy Git Tags (Priority: P2)

A CI maintainer wants to simplify the CI pipeline by removing the redundant `tests-quick-sanity-integration-on-stable-tag.yml` workflow, eliminating both the `stable` and `latest` git tag aliases, and removing the `create-stable-tag-and-test` job from the latest-tag workflow. The project follows standard convention: semver release tags (e.g., `0.2.41`) are the only canonical release identifiers, with no separate `stable` or `latest` alias tags.

**Why this priority**: The stable-tag workflow, `stable` git tag, and `latest` git tag are redundant indirection. Standard semver tags already identify releases. Removing all three reduces CI runner load, eliminates confusing aliases, and simplifies the release pipeline.

**Independent Test**: Verify that the file `tests-quick-sanity-integration-on-stable-tag.yml` no longer exists. Verify the latest-tag workflow no longer creates a `stable` tag or triggers the stable-tag workflow. Verify both `stable` and `latest` tags are deleted from the remote.

**Acceptance Scenarios**:

1. **Given** the stable-tag workflow file exists in `.github/workflows/`, **When** this feature is merged, **Then** the file `tests-quick-sanity-integration-on-stable-tag.yml` is deleted.
2. **Given** the latest-tag workflow has a `create-stable-tag-and-test` job, **When** this feature is merged, **Then** that entire job is removed (the latest-tag workflow is replaced by the new release-tag workflow from User Story 1).
3. **Given** the `stable` git tag exists on the remote, **When** the cleanup is performed, **Then** the `stable` tag is deleted from the remote repository.
4. **Given** the `latest` git tag exists on the remote, **When** the cleanup is performed, **Then** the `latest` tag is deleted from the remote repository.

---

### User Story 4 - Self-Hosted Runner Compatibility (Priority: P3)

Both workflows continue to run on the existing `caipe-integration-tests` self-hosted runner. The runner must have `kind`, `kubectl`, `helm`, and other prerequisites installed for `setup-caipe.sh` to succeed. Docker and Docker Compose must be available for the dev workflow.

**Why this priority**: The workflows must remain compatible with the existing CI infrastructure.

**Independent Test**: The `setup-caipe.sh` script includes a prerequisite check. If any required tool is missing, the workflow fails with a clear error message.

**Acceptance Scenarios**:

1. **Given** the self-hosted runner has `kind`, `kubectl`, `helm`, `openssl`, `curl`, `jq`, `docker`, and `docker compose` installed, **When** either workflow runs, **Then** prerequisites pass and execution proceeds.
2. **Given** the self-hosted runner is missing a required tool, **When** the workflow runs, **Then** it fails early with a clear error listing the missing tools.

---

### Edge Cases

- What happens when a previous Kind cluster named `caipe` still exists from a failed run? The cleanup step MUST handle leftover Kind clusters by running teardown before or after the run.
- What happens when the Helm chart OCI registry is unreachable? The release-tag workflow MUST fail with a clear error and upload available logs for diagnosis.
- What happens when pods fail to reach Running state within the timeout? The built-in pod wait timeout MUST trigger, and the workflow MUST capture and upload diagnostic logs before cleanup.
- What happens when the `.env` file has missing or empty credentials? The workflow MUST still proceed (agents that need those credentials will fail gracefully), and the quick sanity tests report which agents could not respond.
- What happens when no semver release tags exist in the repository? The release-tag workflow MUST fail with a clear error indicating no release tag was found.
- What happens when two workflows run concurrently on the same self-hosted runner? The workflows should use `concurrency` groups to prevent overlapping runs from conflicting on ports or Kind cluster names.

## Requirements *(mandatory)*

### Functional Requirements

**Release-tag workflow (setup-caipe.sh + Kind):**

- **FR-001**: A new release-tag integration workflow MUST provision a Kind cluster using `setup-caipe.sh` in non-interactive mode with cluster creation enabled.
- **FR-002**: The release-tag workflow MUST resolve the latest semver release tag from GitHub Releases (e.g., `0.2.41`) and deploy that specific Helm chart version.
- **FR-003**: The release-tag deployment MUST include only the CAIPE supervisor, weather agent, and netutils agent (no RAG, no tracing, no GraphRAG, no AgentGateway).
- **FR-004**: The release-tag workflow MUST trigger on tag push events and `workflow_dispatch`.
- **FR-005**: The release-tag workflow MUST clean up the Kind cluster and all associated resources on completion (both success and failure).

**Dev workflow (docker-compose.dev.yaml):**

- **FR-006**: The dev quick sanity workflow MUST use `docker-compose.dev.yaml` to start services with all agents and RAG enabled (no GraphRAG).
- **FR-007**: The dev workflow MUST trigger on push to `main` and `workflow_dispatch`.
- **FR-008**: The dev workflow MUST clean up all docker-compose services and resources on completion (both success and failure).

**Both workflows:**

- **FR-009**: Both workflows MUST run the existing quick sanity integration test suite (`make quick-sanity`).
- **FR-010**: Both workflows MUST upload diagnostic logs as an artifact on every run (success or failure).
- **FR-011**: Both workflows MUST continue to run on the `caipe-integration-tests` self-hosted runner.
- **FR-012**: Both workflows MUST create a `.env` file with required LLM provider credentials from GitHub Secrets before starting services.

**Cleanup (stable tag and workflow removal):**

- **FR-013**: The `tests-quick-sanity-integration-on-stable-tag.yml` workflow file MUST be deleted.
- **FR-014**: The `tests-quick-sanity-integration-on-latest-tag.yml` workflow MUST be replaced by the new release-tag workflow (the `create-stable-tag-and-test` job and its `stable` tag logic are eliminated).
- **FR-015**: The `stable` git tag MUST be deleted from the remote repository as part of this change.
- **FR-016**: The `latest` git tag MUST be deleted from the remote repository as part of this change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The release-tag workflow completes successfully end-to-end (Kind cluster creation, Helm chart deploy from release tag, quick sanity tests, teardown) when triggered via `workflow_dispatch`.
- **SC-002**: The dev workflow completes successfully end-to-end (docker-compose startup with all agents + RAG, quick sanity tests, teardown) when triggered via `workflow_dispatch`.
- **SC-003**: The quick sanity test suite achieves the same or better pass rate compared to the previous workflows when all services are healthy.
- **SC-004**: The stable-tag workflow is fully removed, both `stable` and `latest` git tags are deleted from the remote, and no dangling references remain in any workflow files.
- **SC-005**: Workflow teardown leaves no orphaned Kind clusters, dangling containers, or images on the runner after completion.
- **SC-006**: Total execution time for each workflow remains within 150% of the previous comparable approach.

## Assumptions

- The `caipe-integration-tests` self-hosted runner already has `kind`, `kubectl`, `helm`, `openssl`, `curl`, `jq`, `docker`, and `docker compose` installed.
- The default invocation of `setup-caipe.sh` in non-interactive mode with cluster creation enabled deploys exactly supervisor + weather + netutils (no optional features) unless explicitly flagged.
- The `CAIPE_CHART_VERSION` environment variable can be passed to `setup-caipe.sh` to pin the Helm chart to a specific release tag version.
- The LLM provider credentials stored in GitHub Secrets are compatible with both the `setup-caipe.sh` credential flow and the docker-compose `.env` approach.
- The quick sanity tests can connect to services whether deployed via Kind (port-forwarded) or docker-compose (localhost).
- The `setup-caipe.sh nuke` (or `cleanup`) command can fully tear down the Kind cluster and associated resources.
- No external systems depend on the `stable` or `latest` git tags. Standard semver release tags are sufficient to identify releases.
- `docker-compose.dev.yaml` has a profile or configuration that enables all agents + RAG without GraphRAG.
