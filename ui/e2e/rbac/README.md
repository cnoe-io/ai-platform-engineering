# RBAC End-to-End Harness

Playwright specs that exercise the BFF auth contract against a **live**
CAIPE + Keycloak stack:

| Spec | What it asserts |
|------|------------------|
| `sign-in.spec.ts` | A user with `chat_user` can reach `/chat` after Keycloak login. |
| `sign-out.spec.ts` | After sign-out, `/chat` redirects back to Keycloak. |
| `expired-session.spec.ts` | An expired NextAuth cookie surfaces the standardized 401 toast (Spec 102 Phase 7) instead of a generic 500. |
| `missing-role.spec.ts` | A user without `chat_user` gets a 403 toast on chat submit. |
| `pdp-down.spec.ts` | When Keycloak is unreachable, the UI shows a 503 toast (no silent allow). |
| `credential-team-sharing.spec.ts` | Live credential Team Access keeps concurrent share responses from dropping successful grants. |
| `workflow-agent-access.spec.ts` | Mocked browser regression for workflow run access and denied agent-access grants. |
| `workflows-rbac-regression.spec.ts` | Mocked browser regression for team/global/private workflow visibility, MCP step tool overrides, grant/save paths, save-as-private fallback when agent grants are denied, and non-admin run access. |
| `webex-workflow-agent-routes.spec.ts` | Mocked browser regression for Webex space onboarding and routing to workflow/MCP agents (bot dispatch path). |
| `workflow-agent-service-auth.spec.ts` | Mocked regression for agent→BFF workflow run auth (401 without Bearer, 201 with Bearer) and agent workflow wiring. |
| `workflow-agent-user-delegation.spec.ts` | Mocked regression for run-as-user workflow delegation (user OBO bearer vs service account on team/global/private workflows). |
| `workflow-agent-oauth-live.spec.ts` | Live-stack regression for Keycloak client-credentials → `/api/workflow-runs` (401 unauthenticated, 201 global workflow). |
| `workflow-agent-user-delegation-live.spec.ts` | Live-stack regression: service account 403 on team workflow; session owner 201; global fallback for SA. |
| `rbac-admin-regression.spec.ts` | Mocked browser regression for the RBAC Audit export UX. |
| `audit-service-writers.spec.ts` | Mocked browser regression for audit-service-backed audit reads, filtering, downloads, and outage recovery. |
| `audit-log.spec.ts` | Mocked browser regression for the audit-service reader UI: storage status, time windows, custom ranges, ZIP export, and outage badges. |
| `mcp-openfga-tuples.spec.ts` | Mocked browser regression for team MCP resource saves and MCP server list visibility. |
| `mcp-credential-editor.spec.ts` | Mocked regression for MCP credential editor: clear bindings, reload persistence, team-shared secret picker, read-only gating. |
| `mcp-empty-credential-sources.spec.ts` | Mocked upstream-only credential regression (test modal without credential resolution) and live AgentGateway bridge contract for `credential_sources: []`. |
| `mcp-test-modal-and-agentgateway.spec.ts` | Mocked regression for AgentGateway target picker, MCP test modal, schema-driven tools, and team-shared `secret_ref` resolution for generic users. |
| `chat-navigation-regression.spec.ts` | Mocked regression for chat tab navigation: resume last conversation, slow-list race, localStorage pointer, single create when empty. |
| `chat-stream-regression.spec.ts` | Mocked AG-UI streaming regression for Bedrock schema errors and same-conversation recovery after a missing `toolResult` failure. |
| `chat-workflow-run-card.spec.ts` | Mocked regression for workflow run cards in chat showing step outputs when terminal. |
| `workflow-run-detail.spec.ts` | Mocked regression for workflow run detail page: failed/completed status, step errors, and `step.response` in the timeline. |
| `chat-auto-create.spec.ts` | Live-stack regression: `/chat` must not create duplicate conversations when one already exists (requires `RUN_RBAC_E2E=1`). |
| `credentials-workspace-regression.spec.ts` | Mocked browser regression for admin credentials (protection details, usage, inline audit), personal secrets workspace (when SSR session available), and MCP credential binding. |
| `credential-secrets-management.spec.ts` | Live-stack + mocked API hybrid for full credentials UX (requires `RUN_RBAC_E2E=1`). |
| `identity-sync-regression.spec.ts` | Mocked browser regression for the Identity Sync admin tab and manual Okta sync trigger path. |
| `service-accounts.spec.ts` | Mocked browser regression for Service Accounts create, see-once credential reveal, scope manage, rotate, and revoke UX. |
| `slack-run-as.spec.ts` | Mocked browser regression for Slack route “Run as Service Account” selection and route-save payload. |
| `slack-bff-user-directory-live.spec.ts` | Live-stack Slack bot service-account regression for BFF user-directory lookup, federation metadata, validation guardrails, and IdP broker summary. |
| `mcp-server-create-live.spec.ts` | Live-stack regression for MCP server create → OpenFGA tuple reconcile → BFF list visibility. |
| `openfga-live.spec.ts` | Live-stack OpenFGA/CAS regression for decisions, grants, revokes, delegation, explain, raw tuple admin APIs, and guardrails. |
| `resource-lifecycle-live.spec.ts` | Live-stack resource lifecycle matrix for agents, skills, workflows, workflow runs, teams, KB/data-source sharing, credentials, MCP custom headers, and AgentGateway tool-call tuples. |

## Commands

Use these from `ui/`:

| Command | Scope |
|---------|-------|
| `npm run test:e2e:all` | Full RBAC Playwright suite: mocked regressions plus live RBAC/OpenFGA specs. |
| `npm run test:e2e:rbac-regression` | Fast mocked browser regression subset. |
| `npm run test:e2e:rbac-live-resources` | Live resource lifecycle matrix only. |
| `npm run test:e2e:rbac-live-workflow-oauth` | Live workflow service-account OAuth contract only. |
| `npm run test:e2e:rbac -- --list` | Raw discovery/debug command for every RBAC spec. |

Use `npm run test:e2e:all -- --list` to see exactly what the full command will
run without executing tests.

## Skip-by-default

The live specs only run when `RUN_RBAC_E2E=1`. The mocked browser regression
specs run when `RUN_RBAC_REGRESSION=1`. With both env vars unset, gated specs
hit `test.skip()` immediately, so:

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
       KEYCLOAK_URL=http://localhost:7080 \
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
       npx playwright test e2e/rbac/workflow-agent-access.spec.ts e2e/rbac/rbac-admin-regression.spec.ts e2e/rbac/audit-service-writers.spec.ts e2e/rbac/audit-log.spec.ts e2e/rbac/mcp-openfga-tuples.spec.ts e2e/rbac/service-accounts.spec.ts e2e/rbac/admin-settings-regression.spec.ts e2e/rbac/identity-sync-regression.spec.ts e2e/rbac/slack-run-as.spec.ts --config=playwright.rbac.config.ts

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

## Live MCP server create regression

`mcp-server-create-live.spec.ts` covers issue #1832 against a real running stack:

* installs a local NextAuth JWT session for the RBAC fixture user,
* creates an MCP server through the Dynamic Agents → MCP Servers UI,
* verifies the server remains visible after the post-create list refresh,
* checks live CAS decisions for `mcp_server#read` and `mcp_server#manage`, and
* reads the raw OpenFGA tuples for creator `owner` and organization-admin `manager`.

The `RBAC_USER_*` account must be able to create MCP servers and view OpenFGA
tuples, so use an org-admin / RBAC-admin fixture. The `RBAC_USER_SUB` value must
match that user's Keycloak subject because CAS/OpenFGA decisions are keyed by
stable subject, not email. The test bypasses the interactive OIDC redirect so
local stacks with `OIDC_IDP_HINT=duo-sso` can run headlessly.
`playwright.rbac.config.ts` loads `.env`, `ui/.env`, and `ui/.env.local`
automatically; shell-exported values override file values.

       RUN_RBAC_E2E=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       KEYCLOAK_URL=http://localhost:8080 \
       KEYCLOAK_REALM=caipe \
       RBAC_USER_EMAIL=e2e-rbac-admin@caipe.local \
       RBAC_USER_PASSWORD=changeme \
       RBAC_USER_SUB=<keycloak-user-id> \
       npm run test:e2e:rbac-live-mcp

## Live Slack bot BFF user-directory regression

`slack-bff-user-directory-live.spec.ts` covers the Slack bot’s BFF-only
Keycloak access path. It obtains a Slack bot service-account token with
`SLACK_INTEGRATION_AUTH_*`, calls the real BFF endpoints, and verifies:

* unauthenticated Slack-source calls are denied,
* `GET /api/admin/users/resolve?id=...` returns `{sub, enabled, attributes,
  federatedIdentities}`,
* a missing id returns `data:null` with HTTP 200,
* ambiguous locators and disallowed attributes fail with stable 400 codes,
* optional email and allowed-attribute locators resolve the same user, and
* `GET /api/admin/realm/identity-providers` returns enabled-broker state.

The test user should be a real Keycloak user visible to the BFF. The Slack bot
service account must have `reader admin_surface:user_directory`.

       RUN_RBAC_E2E=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       KEYCLOAK_URL=http://localhost:7080 \
       KEYCLOAK_REALM=caipe \
       SLACK_INTEGRATION_AUTH_TOKEN_URL=http://localhost:7080/realms/caipe/protocol/openid-connect/token \
       SLACK_INTEGRATION_AUTH_CLIENT_ID=caipe-slack-bot \
       SLACK_INTEGRATION_AUTH_CLIENT_SECRET=<secret> \
       SLACK_BFF_TEST_USER_ID=<keycloak-user-id> \
       SLACK_BFF_TEST_USER_EMAIL=e2e-rbac-admin@caipe.local \
       SLACK_BFF_TEST_ATTRIBUTE_NAME=slack_user_id \
       SLACK_BFF_TEST_ATTRIBUTE_VALUE=<optional-slack-user-id> \
       npm run test:e2e:rbac-live-slack-bff

## Comprehensive OpenFGA live regression

`openfga-live.spec.ts` is the broad semantic regression for CAS/OpenFGA. It
uses the same local NextAuth fixture session as the live MCP test, then creates
random OpenFGA-only resource ids and cleans up all grants at the end.

It covers:

* default deny on ungranted resources,
* public request validation for invalid ids and empty batches,
* subject-binding: non-auditors cannot evaluate another subject,
* admin-only explain output and relation mapping (`read` → `can_read`),
* product PAP grant/revoke through `/api/authz/v1/grants`,
* cache invalidation after grant and revoke,
* batch allow/deny filtering,
* resource manager delegation without org-admin,
* rejection of unsafe `everyone` grants such as `manage`,
* allowed `everyone` grants for low-risk capabilities,
* service-account grants on MCP servers, and
* raw OpenFGA tuple admin read/write/check validation, including rejection of
  materialized `can_*` writes.

Run it against a live stack:

       RUN_RBAC_E2E=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       KEYCLOAK_URL=http://localhost:7080 \
       KEYCLOAK_REALM=caipe \
       RBAC_USER_EMAIL=e2e-rbac-admin@caipe.local \
       RBAC_USER_PASSWORD=changeme \
       RBAC_USER_SUB=<keycloak-user-id> \
       npm run test:e2e:rbac-live-openfga

## Comprehensive resource lifecycle live regression

`resource-lifecycle-live.spec.ts` exercises the product APIs that sit on top of
CAS/OpenFGA, not only the low-level decision endpoints. It uses generated
resource ids and cleans up after itself.

It covers:

* org-admin can create global agents, skills, workflows, MCP servers, teams,
  KB assignments, and public data-source grants,
* non-org-admin cannot create a global agent until explicitly granted resource
  management,
* non-org-admin can update/delete resources after explicit CAS grants,
* global workflow visibility and workflow-run start/list/poll use the same
  visibility union semantics,
* team member vs non-member decisions through OpenFGA team membership tuples,
* team resource sharing writes both team tool-call tuples and
  AgentGateway-facing `agent:<id> caller tool:<server>/*` tuples,
* KB assignment add/remove updates knowledge-base and data-source decisions,
* public data-source sharing writes and revokes `user:* reader` tuples,
* credential secret create/read/rotate/share/revoke/delete when credentials are
  enabled, and
* MCP server custom headers plus credential source persistence on the MCP-backed
  workflow path.

Run only the lifecycle matrix:

       RUN_RBAC_E2E=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       KEYCLOAK_URL=http://localhost:7080 \
       KEYCLOAK_REALM=caipe \
       RBAC_USER_EMAIL=e2e-rbac-admin@caipe.local \
       RBAC_USER_PASSWORD=changeme \
       RBAC_USER_SUB=<keycloak-user-id> \
       npm run test:e2e:rbac-live-resources

Run the full live RBAC regression target:

       RUN_RBAC_E2E=1 \
       CAIPE_UI_BASE_URL=http://localhost:3000 \
       KEYCLOAK_URL=http://localhost:7080 \
       KEYCLOAK_REALM=caipe \
       RBAC_USER_EMAIL=e2e-rbac-admin@caipe.local \
       RBAC_USER_PASSWORD=changeme \
       RBAC_USER_SUB=<keycloak-user-id> \
       npm run test:e2e:rbac-live-full

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
* `admin-settings-regression.spec.ts`

Local parity: `make caipe-ui-e2e-rbac` (with `npm run dev` already on
`:3000`) or `RUN_RBAC_REGRESSION=1 npm run test:e2e:rbac-regression`.

**Live stack harness** (`sign-in`, `pdp-down`, etc.) is still opt-in via
`.github/workflows/test-rbac.yaml` (PR label `rbac-e2e` / nightly). Tracked in
`BLOCKERS.md` until full stack provisioning lands in default CI.

**Live Playwright stack** runs in
`.github/workflows/playwright-rbac-live.yml`. It deploys CAIPE into Kind with
`setup-caipe.sh --non-interactive --create-cluster --no-ingress`, pins
`CAIPE_SELECTED_AGENTS=netutils` so the job does not start every built-in agent
and MCP sidecar, opens local port-forwards for the UI/Keycloak/OpenFGA/
AgentGateway, resolves the local Keycloak admin subject, then runs one of the
`test:e2e:rbac-live-*` targets. Use this for manual or nightly live-stack
confidence; keep it out of default PR gating unless the runner budget can absorb
a full Helm deploy.
