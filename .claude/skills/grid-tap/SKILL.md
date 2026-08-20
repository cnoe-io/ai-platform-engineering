---
name: grid-tap
description: Run the GRID Tests Against Production (TAP) release regression against an explicitly approved GRID deployment. Use for major-release validation and commit-derived regression planning across MCP servers, agents, credentials, knowledge bases, TOME, chats, workflows, integrations, UX, and OpenFGA Private/Team/Global authorization. Requires full release-history mapping, a production-safety preflight, a screenshot for every test, per-transition tuple and CAS decision evidence, manifest-scoped cleanup, and a final PASS/FAIL/BLOCKED report.
---

# GRID TAP

Validate a GRID release end to end without touching pre-existing resources. Treat the persisted resource, its OpenFGA projection, and effective authorization as one contract.

## Mandatory workflow

1. Read [production-safety.md](references/production-safety.md) and [test-matrix.md](references/test-matrix.md).
2. Set the release boundary and map the full reachable commit graph before production writes:

   ```bash
   GRID_TAP_RELEASE_BASE_REF=0.5.0 GRID_TAP_RELEASE_HEAD_REF=HEAD \
     .claude/skills/grid-tap/scripts/run-grid-tap.sh matrix
   ```

   Inspect the attached commit ledger. Add or strengthen matrix rows for changed behavior; do not accept an unmapped commit.
3. Confirm the user approved the target deployment and production writes. An explicit approval already present anywhere in the active task is sufficient; do not ask again. Without approval, stop after the read-only matrix and preflight.
4. Inspect `git status`; preserve unrelated worktree changes.
5. Run the preflight:

   ```bash
   .claude/skills/grid-tap/scripts/run-grid-tap.sh preflight
   ```

6. Stop as `BLOCKED` if release-history coverage, identity, team membership, system health, OpenFGA administration, cleanup capability, or the safe MCP endpoint is unavailable.
7. Run the approved mode:

   ```bash
   .claude/skills/grid-tap/scripts/run-grid-tap.sh smoke
   .claude/skills/grid-tap/scripts/run-grid-tap.sh tome
   .claude/skills/grid-tap/scripts/run-grid-tap.sh full
   ```

8. Exercise the actual authenticated Safari admin and Chrome non-admin profiles using the browser-control skills named by the operator. Playwright WebKit is not Safari; do not substitute it for the real-browser acceptance pass.
9. Run cleanup even after failures:

   ```bash
   .claude/skills/grid-tap/scripts/run-grid-tap.sh cleanup
   ```

10. Report `PASS`, `FAIL`, or `BLOCKED` for every matrix row. Link screenshots, the release commit ledger, JSON/JUnit report, traces, and cleanup residue report.

## Non-negotiable assertions

- Capture at least one screenshot for every test, including passing tests.
- For every Private/Team/Global create, share, revoke, or visibility transition:
  - read the exact expected OpenFGA tuples;
  - assert stale tuples are absent;
  - check effective CAS decisions for the admin and non-admin subjects;
  - attach the tuple/decision evidence to the test result.
- Test both positive and negative access. A hidden UI control is not sufficient; the corresponding API must deny unauthorized calls.
- Use only run-prefixed fixtures and delete only IDs recorded by the current run.
- Never reuse, rotate, clear, or reveal an existing credential. Use a harmless marker secret.
- Keep global exposure as short as possible and revoke it immediately after verification.
- For TOME, test the deployed UI, BFF routes, TOME MCP transport, TOME agent,
  PageStore/Mongo persistence, and OpenFGA projection as one contract. Unit or
  mocked browser tests do not satisfy a live TOME row.
- A TOME release must run the dedicated `tome` mode at minimum. The `full`
  mode includes the same TOME tests alongside the platform-wide suite.
- Persist every created TOME project, page, and gist in the run manifest.
  Delete children before their project and prove the immutable
  `document:tome/<kind>/<id>` object has zero tuples afterward.

## Runtime configuration

The runner reads `GRID_TAP_*` environment variables. Do not commit deployment URLs, company identities, team names, session cookies, passwords, access tokens, or a production `NEXTAUTH_SECRET`.

Required for deterministic Playwright/API mode:

- `GRID_TAP_BASE_URL`
- `GRID_TAP_ADMIN_EMAIL`, `GRID_TAP_ADMIN_SUB`
- `GRID_TAP_MEMBER_EMAIL`, `GRID_TAP_MEMBER_SUB`
- `GRID_TAP_TEAM_SLUG` (the canonical hyphenated slug returned by the Teams API, not an OIDC display name)
- `NEXTAUTH_SECRET`

The dedicated `tome` and `cleanup` modes do not require the MCP probe inputs
below. `preflight`, `smoke`, and `full` do because they also exercise saved MCP
servers and tools.

Required when saved MCP/tool invocation is in scope:

- `GRID_TAP_MCP_ENDPOINT` (an approved, read-only HTTP MCP endpoint)
- `GRID_TAP_MCP_SERVER_ID` (an existing, approved saved server that routes to that endpoint)
- `GRID_TAP_MCP_TOOL_NAME`
- `GRID_TAP_MCP_TOOL_PARAMS` (a JSON object containing harmless arguments)

Optional:

- `GRID_TAP_RUN_ID`
- `GRID_TAP_ORG_KEY`
- `GRID_TAP_AGENT_MODEL_ID`, `GRID_TAP_AGENT_MODEL_PROVIDER`
- `GRID_TAP_RELEASE`
- `GRID_TAP_RELEASE_BASE_REF` (defaults to `0.5.0`)
- `GRID_TAP_RELEASE_HEAD_REF` (defaults to `HEAD`)
- `GRID_TAP_ALLOW_NON_PROD=1` for an explicitly approved non-production target

The real-browser pass uses existing signed-in sessions and must verify the displayed identity before acting.

## Evidence locations

- Playwright output: `ui/test-results/grid-tap/<run-id>/<mode>/`
- HTML report: `ui/playwright-report/grid-tap/<run-id>/<mode>/`
- JUnit: `ui/test-results/grid-tap/<run-id>/<mode>/results.xml`
- JSON: `ui/test-results/grid-tap/<run-id>/<mode>/results.json`
- Release commit ledger: `release-commit-ledger` attachment in the matrix/preflight result
- Cross-mode fixture manifest: `ui/test-results/grid-tap/<run-id>/manifest.json`

Do not claim success when cleanup evidence is missing.
