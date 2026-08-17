---
name: caipe-regression-suite
description: Run the CAIPE production regression suite against an explicitly approved CAIPE deployment. Use for major-release validation and commit-derived regression planning across MCP servers, agents, credentials, knowledge bases, TOME, chats, workflows, integrations, UX, and OpenFGA Private/Team/Global authorization. Requires full release-history mapping, a production-safety preflight, a screenshot for every test, per-transition tuple and CAS decision evidence, manifest-scoped cleanup, and a final PASS/FAIL/BLOCKED report.
---

# CAIPE Regression Suite

Validate a CAIPE release end to end without touching pre-existing resources. Treat the persisted resource, its OpenFGA projection, and effective authorization as one contract.

Codex discovers this project skill at `.agents/skills/caipe-regression-suite`. The repository's tracked `.agents/skills` compatibility link resolves to `.claude/skills`, so Codex and Claude Code share this single implementation.

## Mandatory workflow

1. Read [production-safety.md](references/production-safety.md), the human-owned [CAIPE Regression Suite matrix](../../../docs/docs/development/caipe-regression-suite.md), and [screen and negative-test coverage](../../../docs/docs/development/caipe-regression-screen-coverage.md).
2. Set the release boundary and map the full reachable commit graph before production writes:

   ```bash
   CAIPE_REGRESSION_SUITE_RELEASE_BASE_REF=0.5.0 CAIPE_REGRESSION_SUITE_RELEASE_HEAD_REF=HEAD \
     .agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh matrix
   ```

   Inspect the attached commit ledger. Add or strengthen matrix rows for changed behavior; do not accept an unmapped commit.
3. Confirm the user approved the target deployment and production writes. Without approval, stop after the read-only matrix and preflight.
4. Inspect `git status`; preserve unrelated worktree changes.
5. Run the preflight:

   ```bash
   .agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh preflight
   ```

6. Stop as `BLOCKED` if release-history coverage, identity, team membership, system health, OpenFGA administration, cleanup capability, or the safe MCP endpoint is unavailable.
7. Run the approved mode:

   ```bash
   .agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh smoke
   .agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh full
   ```

8. Exercise the actual authenticated Safari admin and Chrome non-admin profiles using the browser-control skills named by the operator. Playwright WebKit is not Safari; do not substitute it for the real-browser acceptance pass.
9. Run cleanup even after failures:

   ```bash
   .agents/skills/caipe-regression-suite/scripts/run-caipe-regression-suite.sh cleanup
   ```

10. Report `PASS`, `FAIL`, or `BLOCKED` for every matrix row. Link screenshots, the release commit ledger, JSON/JUnit report, traces, and cleanup residue report.

## Non-negotiable assertions

- Never deploy, upgrade, synchronize ArgoCD, publish or repair an authorization model, run migrations, or change platform configuration. Report deployment drift as `BLOCKED` with evidence.
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

## Runtime configuration

The runner reads `CAIPE_REGRESSION_SUITE_*` environment variables. Do not commit deployment URLs, company identities, team names, session cookies, passwords, access tokens, or a production `NEXTAUTH_SECRET`.

Required for deterministic Playwright/API mode:

- `CAIPE_REGRESSION_SUITE_BASE_URL`
- `CAIPE_REGRESSION_SUITE_ADMIN_EMAIL`, `CAIPE_REGRESSION_SUITE_ADMIN_SUB`
- `CAIPE_REGRESSION_SUITE_MEMBER_EMAIL`, `CAIPE_REGRESSION_SUITE_MEMBER_SUB`
- `CAIPE_REGRESSION_SUITE_TEAM_SLUG` (the canonical hyphenated slug returned by the Teams API, not an OIDC display name)
- `CAIPE_REGRESSION_SUITE_ORG_KEY`
- `CAIPE_REGRESSION_SUITE_MCP_ENDPOINT` (a harmless endpoint approved for the run)
- `CAIPE_REGRESSION_SUITE_APPROVED_HOST` (must exactly match the hostname in `CAIPE_REGRESSION_SUITE_BASE_URL`)
- `NEXTAUTH_SECRET`

Optional:

- `CAIPE_REGRESSION_SUITE_RUN_ID`
- `CAIPE_REGRESSION_SUITE_RELEASE`
- `CAIPE_REGRESSION_SUITE_RELEASE_BASE_REF` (defaults to `0.5.0`)
- `CAIPE_REGRESSION_SUITE_RELEASE_HEAD_REF` (defaults to `HEAD`)

The real-browser pass uses existing signed-in sessions and must verify the displayed identity before acting.

## Evidence locations

- Playwright output: `ui/test-results/caipe-regression-suite/<run-id>/<mode>/`
- HTML report: `ui/playwright-report/caipe-regression-suite/<run-id>/<mode>/`
- JUnit: `ui/test-results/caipe-regression-suite/<run-id>/<mode>/results.xml`
- JSON: `ui/test-results/caipe-regression-suite/<run-id>/<mode>/results.json`
- Release commit ledger: `release-commit-ledger` attachment in the matrix/preflight result

Do not claim success when cleanup evidence is missing.
