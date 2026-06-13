# RBAC End-to-End Harness (Spec 102 / US7)

Playwright specs that exercise the BFF auth contract against a **live**
CAIPE + Keycloak stack:

| Spec | What it asserts |
|------|------------------|
| `sign-in.spec.ts` | A user with `chat_user` can reach `/chat` after Keycloak login. |
| `sign-out.spec.ts` | After sign-out, `/chat` redirects back to Keycloak. |
| `expired-session.spec.ts` | An expired NextAuth cookie surfaces the standardized 401 toast (Spec 102 Phase 7) instead of a generic 500. |
| `missing-role.spec.ts` | A user without `chat_user` gets a 403 toast on chat submit. |
| `pdp-down.spec.ts` | When Keycloak is unreachable, the UI shows a 503 toast (no silent allow). |
| `workflow-agent-access.spec.ts` | Mocked browser regression for workflow run access and denied agent-access grants. |
| `rbac-admin-regression.spec.ts` | Mocked browser regression for the Permissions Tool and RBAC Audit export UX. |
| `mcp-openfga-tuples.spec.ts` | Mocked browser regression for team MCP resource saves and MCP server list visibility. |

## Skip-by-default

These specs **only run when `RUN_RBAC_E2E=1`**. With that env unset,
each spec hits `test.skip()` immediately, so:

* day-to-day `npx playwright test` runs are no-ops on this dir, and
* the harness can ship in `main` without breaking CI for devs who
  haven't spun up the full stack.

## Running locally

1. Spin up the dev stack:

       docker compose -f docker-compose.dev.yaml --profile caipe-ui --profile dynamic-agents up -d

2. Provision two fixture users in Keycloak (one with `chat_user`, one
   without). The `init-idp.sh` realm bootstrap creates `e2e-rbac-user`
   and `e2e-rbac-noaccess-user` when `E2E_USERS=1` is set.

3. Install Playwright browsers (one-time):

       cd ui
       npx playwright install chromium

4. Run the suite:

       RUN_RBAC_E2E=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       KEYCLOAK_URL=http://localhost:8080 \
       KEYCLOAK_REALM=caipe \
       RBAC_USER_EMAIL=e2e-rbac-user@caipe.local \
       RBAC_USER_PASSWORD=changeme \
       RBAC_NOACCESS_USER_EMAIL=e2e-rbac-noaccess-user@caipe.local \
       RBAC_NOACCESS_USER_PASSWORD=changeme \
       npx playwright test --config=playwright.rbac.config.ts

## Workflow agent-access regression

`workflow-agent-access.spec.ts` uses the real Workflows UI in Chromium but
intercepts the BFF APIs it needs. It does not require Keycloak fixture users:

       WORKFLOWS_ENABLED=true npm run dev

       RUN_WORKFLOW_E2E=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       npx playwright test e2e/rbac/workflow-agent-access.spec.ts --config=playwright.rbac.config.ts

## Mocked RBAC browser regression

The mocked regression suite uses the real browser UI and intercepts BFF APIs.
It is intended for fast PR checks around RBAC UI behavior without requiring
Keycloak/OpenFGA fixture data:

       WORKFLOWS_ENABLED=true npm run dev

       RUN_RBAC_REGRESSION=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       npx playwright test e2e/rbac/workflow-agent-access.spec.ts e2e/rbac/rbac-admin-regression.spec.ts e2e/rbac/mcp-openfga-tuples.spec.ts --config=playwright.rbac.config.ts

## MCP OpenFGA tuple regression

`mcp-openfga-tuples.spec.ts` covers the PR #1819 browser contract:

* Admin → Teams → Resources re-sends the full selected MCP tool list on Save
  (drift repair), not an empty diff.
* Dynamic Agents → MCP Servers keeps a newly created server visible after the
  post-create list refresh.

       WORKFLOWS_ENABLED=true npm run dev

       RUN_RBAC_REGRESSION=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       npx playwright test e2e/rbac/mcp-openfga-tuples.spec.ts --config=playwright.rbac.config.ts

## PDP-down spec

The `pdp-down.spec.ts` spec needs Keycloak to be unreachable from the
supervisor / DA processes during the run. It will not break Keycloak
on your behalf — that would be too easy to leave in a broken state.

To run it:

1. In a separate shell, point the supervisor + DA at a black-hole URL:

       docker compose -f docker-compose.dev.yaml stop keycloak

2. Then re-run with the gate flipped:

       RBAC_E2E_PDP_DOWN_BREAK_KC=1 \
       RUN_RBAC_E2E=1 [...other vars...] \
       npx playwright test pdp-down.spec.ts --config=playwright.rbac.config.ts

3. **Restart Keycloak afterwards** — `docker compose start keycloak`.

## CI

**Mocked RBAC browser regression** runs in `.github/workflows/caipe-ui-tests.yml`
(`playwright-rbac-regression` job) on every PR that touches `ui/**`. It starts
`next dev`, sets `RUN_RBAC_REGRESSION=1`, and runs:

* `workflow-agent-access.spec.ts`
* `rbac-admin-regression.spec.ts`
* `mcp-openfga-tuples.spec.ts`

Local parity: `make caipe-ui-e2e-rbac` (with `npm run dev` already on
`:3000`) or `RUN_RBAC_REGRESSION=1 npm run test:e2e:rbac-regression`.

**Live stack harness** (`sign-in`, `pdp-down`, etc.) is still opt-in via
`.github/workflows/test-rbac.yaml` (PR label `rbac-e2e` / nightly). Tracked in
`BLOCKERS.md` until full stack provisioning lands in default CI.
