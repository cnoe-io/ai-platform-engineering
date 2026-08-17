---
sidebar_position: 7
title: CAIPE Regression Suite
description: Human-owned production regression matrix, execution modes, evidence requirements, and release coverage rules.
---

# CAIPE Regression Suite

This page is the canonical, human-editable regression plan for major CAIPE releases. Update it in the same pull request whenever a product change adds, removes, or materially changes a release-critical behavior.

The Codex project skill is available as `$caipe-regression-suite`. It reads this page before execution and produces test reports; it does not deploy or upgrade the target environment.

See [Screen and Negative-Test Coverage](./caipe-regression-screen-coverage.md) for the complete route inventory, role matrix, tabbed surfaces, sharing transitions, failure modes, accessibility, and browser coverage.

## Editing the matrix

- Keep row IDs stable so reports remain comparable across releases.
- Add a row or strengthen an existing row when a change introduces new behavior or risk.
- Update the commit-domain routing table and `release-commit-matrix.mjs` together when adding a new domain.
- Update the Playwright suite when a required assertion can be automated.
- Treat a documented but unimplemented assertion as `BLOCKED`, not `PASS`.
- Never add deployment-specific identities, URLs, credentials, or secrets to this page.

## Running the suite

| Mode | Command | Production writes |
|---|---|---|
| Matrix | `.agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh matrix` | None |
| Preflight | `.agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh preflight` | Read-only |
| Smoke | `.agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh smoke` | Approved disposable fixtures only |
| Full | `.agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh full` | Approved disposable fixtures only |
| Cleanup | `.agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh cleanup` | Deletes only current-run fixture IDs |

Every row produces a screenshot. Every create, share, revoke, or visibility change also produces exact OpenFGA tuple evidence, stale-tuple assertions, and admin/member contextual authorization system (CAS) decisions.

The suite never deploys, upgrades, synchronizes ArgoCD, publishes or repairs an authorization model, runs migrations, or changes platform configuration. Report deployment drift as `BLOCKED` with evidence.

## Release-history gate

Run the matrix mode before touching the target. `REL-01` analyzes the full reachable commit graph from `CAIPE_REGRESSION_SUITE_RELEASE_BASE_REF` through `CAIPE_REGRESSION_SUITE_RELEASE_HEAD_REF`, attaches a commit-level JSON ledger, and fails when any commit has no mapped test domain. Do not reduce this to first-parent or non-merge history.

For the 0.5 release line, use:

```bash
CAIPE_REGRESSION_SUITE_RELEASE_BASE_REF=0.5.0 CAIPE_REGRESSION_SUITE_RELEASE_HEAD_REF=HEAD \
  .agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh matrix
```

The base commit is excluded and all descendants reachable from the head are included. Change the refs for each later major-release candidate.

## Core production matrix

| ID | Capability | Required assertions |
|---|---|---|
| REL-00 | Codex skill discovery | `.agents/skills/caipe-regression-suite` resolves to a valid skill package and the invocation metadata names `$caipe-regression-suite` |
| REL-01 | Release commit coverage | Base is an ancestor of head; every reachable commit has a domain and one or more matrix rows; full ledger attached |
| REL-02 | Human-visible matrix | This canonical page builds in Docusaurus, appears in the Development sidebar, and contains every required matrix row |
| REL-03 | Screen inventory coverage | Every `ui/src/app/**/page.tsx` route is represented in the human-editable screen matrix with positive and negative assertions |
| PRE-01 | Identity, deployment, and health | Correct admin/member subjects; expected release; healthy readiness; canonical shared-team membership tuples; compatible OpenFGA relations |
| DEP-01 | Deployment compatibility contract | Read-only UI/API version checks agree with the candidate; critical routes and services respond; startup/readiness behavior is healthy; drift is reported as `BLOCKED`, never repaired by the regression suite |
| SEC-01 | Authentication and security | Login/session renewal/logout; protected APIs reject anonymous or forged subjects; secrets/tokens are redacted; security headers and redirect boundaries hold |
| FGA-01 | Authorization model integrity | Deployed model accepts required resource relations; owner/team/org inheritance works; stale tuples and unintended wildcard grants are absent |
| MCP-01 | Private MCP | Owner can read/manage/use/invoke; member denied in UI and API; no team/org grants |
| MCP-02 | Team MCP | Shared-team member can read/use/invoke; team admin manages; outsider denied; no organization grant |
| MCP-03 | Global MCP | Organization member can read/use; exact global tuple contract; non-admin cannot manage |
| MCP-04 | MCP visibility transitions | Private → Team → Global → Private writes exact tuples and revokes every stale tuple |
| CRED-01 | Private credential | Owner relations exist; marker value is never returned after creation; member denied |
| CRED-02 | Team credential | Team member metadata-reader/user decisions; outsider denied; revoke removes both relations |
| CRED-03 | Organization credential | Organization member metadata-reader/user decisions; non-admin cannot manage; revoke removes global access |
| KB-01 | Knowledge base and source | Tiny unique marker ingests; owner/shared team can search; outsider denied; source status and deletion complete |
| KB-02 | Custom MCP tool | Owner/team/global `can_call` decisions match configuration; tool is callable only where granted; revoke is immediate |
| AGT-01 | Private agent | Owner can use/manage; member denied in list/detail/chat/API; no team/global grant |
| AGT-02 | Team agent | Shared-team member can discover/use; cannot write; owner/team-admin manages; outsider denied |
| AGT-03 | Global agent | Exact global-use tuple exists; both personas can discover/use; non-admin cannot manage |
| AGT-04 | MCP access from agent | Agent-to-tool caller tuple exists; selected MCP and credential binding persist; harmless tool call succeeds; unauthorized agent is denied |
| CHAT-01 | New chat | Selected fixture agent persists; marker response, tool lineage, history, refresh, and deep link work |
| CHAT-02 | Direct chat share | Recipient reader/writer decision matches view/edit permission; API enforcement and revoke verified |
| CHAT-03 | Team chat share | Team member reader/writer decision matches permission; non-member denied; revoke verified |
| CHAT-04 | Streaming and interaction | SSE ordering/completion, stop/retry, attachments, timeline, feedback, and error recovery remain usable |
| TOME-01 | Project/wiki/gist editing | Create/edit/cancel/preview/save; unsaved-change guard; UI and TOME MCP updates converge; non-editor mutation denied |
| TOME-02 | TOME ingestion and retrieval | KB/source credentials healthy; auto-ingest fires; search/synthesis/analytics reflect the unique marker; failures surface actionable state |
| TOME-03 | External content embeds | Vidcast container, YouTube, and arXiv render in gist and non-gist wiki pages; edit preview matches saved rendering; unsafe HTML stays blocked |
| WF-01 | Workflows and schedules | Create/edit/run/disable/delete; inputs and agent binding persist; owner/team/global authorization enforced when sharing is supported |
| SKL-01 | Skills | Catalog discovery, install/update, agent attachment, invocation, and permission boundary work without exposing deployment credentials |
| INT-01 | External integrations | Enabled release-critical integration paths pass with disposable fixtures; disabled or unapproved providers are marked `BLOCKED`, never silently skipped |
| OBS-01 | Admin, audit, and operations | Health/audit/metrics/navigation load; mutations emit attributable audit records; non-admin surfaces remain read-only and mutation APIs return 403 |
| RBAC-01 | Admin boundary | Non-admin Admin surfaces remain read-only; direct mutation APIs return 403; privileged data is not leaked in payloads |
| UX-01 | Cross-cutting UX | Validation, async options, cancel, refresh, pagination, narrow viewport, keyboard/focus, error/empty/loading states, and deep links |
| QUAL-01 | Release governance | User-facing docs/config claims match deployed behavior; dependency and migration changes have a mapped smoke assertion; no unreviewed commit class |
| CLEAN-01 | Cleanup | Manifest resources deleted in reverse dependency order; reads fail; object tuples and run-prefixed residue are zero |

## Commit-domain routing

`release-commit-matrix.mjs` assigns every commit to one or more domains using its subject and changed paths. Domains intentionally overlap because cross-cutting commits need multiple regression assertions.

| Domain | Matrix rows |
|---|---|
| Deployment/runtime | PRE-01, DEP-01, OBS-01 |
| Security/authentication | PRE-01, SEC-01, RBAC-01 |
| OpenFGA/RBAC/identity | PRE-01, FGA-01, RBAC-01, MCP-04, AGT-01, CRED-02, CHAT-03 |
| MCP/gateway | MCP-01 through MCP-04, AGT-04 |
| Credentials | CRED-01 through CRED-03, AGT-04 |
| Knowledge/RAG | KB-01, KB-02, TOME-02 |
| Agents/models | AGT-01 through AGT-04, CHAT-01 |
| Chat/streaming | CHAT-01 through CHAT-04 |
| Projects/TOME | TOME-01 through TOME-03 |
| Workflows/skills | WF-01, SKL-01 |
| Integrations/bots | INT-01 |
| Admin/observability | OBS-01, RBAC-01 |
| General UI | UX-01, RBAC-01 |
| Tests/docs/dependencies/release | REL-00 through REL-03, QUAL-01 |

## Evidence and reports

- Playwright output: `ui/test-results/caipe-regression-suite/<run-id>/<mode>/`
- HTML report: `ui/playwright-report/caipe-regression-suite/<run-id>/<mode>/`
- JUnit: `ui/test-results/caipe-regression-suite/<run-id>/<mode>/results.xml`
- JSON: `ui/test-results/caipe-regression-suite/<run-id>/<mode>/results.json`
- Release commit ledger: `release-commit-ledger` attachment in the matrix and preflight results

For the real-browser acceptance pass, use actual Safari for the admin and the operator-specified Chrome profile for the non-admin. Verify the displayed identity before acting and capture the entire application viewport after each row.
