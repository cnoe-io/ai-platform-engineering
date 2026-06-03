# Implementation Plan: MCP Authorization Resilience

**Branch**: `2026-06-02-mcp-authz-resilience` (authored on `main`, no feature branch yet) | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-06-02-mcp-authz-resilience/spec.md`

## Summary

Make MCP servers reliably available on a default install by (1) shipping a generous, operator-configurable AgentGateway ext_authz timeout default (**10s**, was the built-in 200ms) on the default static routing path and the dev compose path; (2) adding bounded transient-retry ("reconcile") when the agent loads MCP tools so cold-start authorization timeouts self-heal; and (3) classifying each unrecoverable load as **transient (not ready)** vs **permanent**, with honest user-facing messaging and the existing authorization denial still surfaced as a denial. The opt-in Gateway-API/CRD routing path is **documented only** (its policy has no timeout field). No persisted-storage changes.

## Technical Context

**Language/Version**: Python 3.11+ (runtime 3.13 in Docker) for `dynamic_agents`; Helm/Go templating + YAML for charts; Python stdlib for `config_bridge.py`.
**Primary Dependencies**: LangGraph/LangChain, `langchain-mcp-adapters` (`MultiServerMCPClient`), `httpx`, `loguru`; AgentGateway proxy v0.12.0 (compose) / v1.1.0 (chart default image); OpenFGA ext_authz bridge.
**Storage**: N/A — stateless. No schema/collection/index change. (No `db-migration.md`.)
**Testing**: `pytest` (dynamic-agents unit tests under `ai_platform_engineering/dynamic_agents/`); `helm template` render checks; `ruff` lint.
**Target Platform**: Linux containers — Docker Compose (dev) and Kubernetes/Helm (prod).
**Project Type**: Multi-component backend (agent runtime + gateway config + Helm chart).
**Performance Goals**: No added latency on the tool-load success path; retries add only bounded delay on the transient-failure path; healthy enumeration stays fast.
**Constraints**: ext_authz MUST stay fail-closed; total retry budget bounded; default timeout configurable; dev/prod parity.
**Scale/Scope**: ~15 MCP routes enumerated concurrently per agent init; small, localized code change + chart/values + docs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Worse is Better | PASS — minimal concrete changes: a config default, a bounded retry wrapper, and a classification branch. No new abstraction layer. |
| II. YAGNI | PASS — only the three things the spec needs; CRD path is doc-only; throughput re-architecture explicitly out of scope. |
| III. Rule of Three | PASS — retry/classification centralized in `mcp_client.py` (one place), reused by the two existing `get_tools_with_resilience` call sites. |
| IV. Composition over Inheritance | PASS — retry is a function wrapper around the existing per-server connect; classification is a pure helper. No inheritance. |
| V. Specs as Source of Truth | PASS — this spec/plan precede code. |
| VI. CI Gates | PASS (planned) — ruff + dynamic-agents pytest + `helm template` render in the verify step. |
| VII. Security by Default | PASS — fail-closed posture preserved (FR-004); genuine denials never retried into success nor mislabeled (FR-009); no secrets touched; timeout is a bounded DoS-safe value. |

Coding practices: type hints + docstrings on new functions, named constants for retry/backoff/timeout, `loguru` structured logging (no `print`), comments explain *why* (the 200ms race), per constitution.

**Result: PASS — no violations, Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-06-02-mcp-authz-resilience/
├── plan.md              # This file
├── spec.md              # Feature spec
├── research.md          # Phase 0 (decisions/rationale)
├── data-model.md        # Phase 1 (load-outcome classification)
├── quickstart.md        # Phase 1 (how to verify)
├── contracts/
│   └── internal-contracts.md   # function + warning-message contracts
└── checklists/
    └── requirements.md  # spec quality checklist (done)
```

### Source Code (repository root) — concrete touch points

```text
# Part 1 — permanent timeout default (config)
charts/ai-platform-engineering/
├── values.yaml                                   # add global.agentgateway.extAuth.timeout: "10s" (+ doc comment)
└── templates/
    ├── agentgateway-static-config.yaml           # render extAuthz.timeout from $extAuth.timeout | default "10s"
    └── agentgateway-mcp.yaml                      # (CRD path) NO code change — documented only

deploy/agentgateway/
├── config.yaml                                   # dev bootstrap — extAuthz.timeout: 10s  (ALREADY APPLIED, dev hotfix)
└── config_bridge.py                              # dev reconcile DEFAULT_MCP_ROUTE_POLICIES extAuthz.timeout (ALREADY APPLIED)

# Part 2 — reconcile + messaging (runtime)
ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/
├── mcp_client.py                                 # get_tools_with_resilience: bounded retry + classify(transient|permanent|denied)
└── agent_runtime.py                              # store per-server classification; emit honest warning (lines ~263, ~587, ~1061)

# Docs
docs/docs/security/rbac/architecture.md           # record the new ext_authz timeout knob (RBAC living-doc rule)
docs/.../agentgateway routing docs (CRD note)      # document CRD-path timeout guidance (backend requestTimeout)

# Tests
ai_platform_engineering/dynamic_agents/.../tests/  # unit tests: retry-then-success, permanent fail-fast, denial-not-retried, classification mapping
```

**Structure Decision**: Changes land in three existing areas — the Helm chart (`charts/ai-platform-engineering`), the dynamic-agents service (`mcp_client.py` + `agent_runtime.py`), and docs. The dev compose path (`deploy/agentgateway/*`) already carries the timeout hotfix and is kept as-is for dev/prod parity (FR-003). No new modules or packages.

## Database migrations

*N/A — no `db-migration.md`. This feature is stateless: it changes gateway configuration defaults and in-process tool-load behavior/messaging only. No collections, schemas, indexes, or backfills are added or altered.*

## Phase 0 — Research (decisions)

Captured in [research.md](./research.md). All previously-open questions are resolved by the user's decisions (timeout value/config, CRD doc-only, retry+messaging) plus the v0.12.0 schema finding (ext_authz timeout is `extAuthz.timeout`, not `policies.http.requestTimeout`; CRD `traffic.extAuth` has no timeout field). **No `NEEDS CLARIFICATION` remain.**

## Phase 1 — Design & Contracts

- **data-model.md** — the `MCPServerLoadOutcome` classification (available | transient/not-ready | permanent) and the error→class mapping rules.
- **contracts/internal-contracts.md** — the (backward-compatible) contract for `get_tools_with_resilience` return data + retry knobs, and the user-facing warning-message contract (transient vs permanent vs denial).
- **quickstart.md** — how to verify each user story locally (compose) and render-check the chart.
- **Agent context update** — run `.specify/scripts/bash/update-agent-context.sh` to register any new tech (none expected; existing stack).

## Complexity Tracking

> No constitution violations — section intentionally empty.
