# CAIPE Playwright scenarios

These specs cover the UI journeys that exist in this repository today:

- Scenario grid tracking for each requested test area.
- Chat with the SRE agent through A2A JSON-RPC streaming mocks.
- Outshift SRE triage across GitHub, ArgoCD, AWS, PagerDuty, and Splunk.
- GRID Prod 0.5.x deployment testing scenarios from the deployment testing PDF.
- Workflows replacing Task Builder.
- Spot check UI personalization settings and integration health indicators.

Several requested areas are tracked as `test.fixme` because this UI tree does not currently expose those pages:

- Legacy use-case gallery and builder flows.
- Agent, MCP server, and Skill creation/sharing/RBAC screens.
- Dedicated Webex integration and admin settings pages.

Run locally with:

```bash
npm run test:e2e
```

The specs mock the browser chat stream and `http://localhost:8000` A2A traffic, so they do not require live ArgoCD, GitHub, AWS, PagerDuty, Splunk, Jira, RAG, or Webex credentials.

## GRID prod chat scenarios

The prod smoke spec is opt-in because it talks to the live GRID chat app:

```bash
RUN_GRID_PROD=true \
GRID_CHAT_URL="https://grid.outshift.io/chat" \
GRID_SCENARIOS_PATH="./e2e/fixtures/grid-prod-scenarios.example.json" \
npm run test:e2e:grid
```

Use `GRID_SCENARIOS_PATH` for scenarios exported from the Confluence deployment testing page, or set `GRID_SCENARIOS_JSON` to an inline JSON array with the same shape.

Live GRID tests need an authenticated GRID session. Playwright does not reuse
your normal Chrome SSO cookies. In Playwright UI mode, you can let the spec
open Cisco/Duo SSO for you:

```bash
RUN_GRID_PROD=true \
GRID_INTERACTIVE_SSO=true \
GRID_SSO_EMAIL="you@cisco.com" \
GRID_SAVE_STORAGE_STATE="./e2e/.auth/grid-prod.json" \
GRID_CHAT_URL="https://grid.outshift.io/chat" \
GRID_SCENARIOS_PATH="./e2e/fixtures/grid-prod-scenarios.example.json" \
npm run test:e2e:ui
```

When the GRID login page appears, the spec clicks **Sign in with SSO**. Complete
Cisco/Duo login in the Playwright browser window and wait for GRID chat to load.
If `GRID_SSO_EMAIL` is set, the spec fills the Duo email step and clicks
**Next** before handing control back for password and MFA. The test saves the
resulting session to `GRID_SAVE_STORAGE_STATE`.

You can also create a local storage-state file ahead of time:

```bash
mkdir -p e2e/.auth
npx playwright codegen \
  --save-storage=e2e/.auth/grid-prod.json \
  https://grid.outshift.io/chat
```

Complete SSO in the browser that opens, close it, then run:

```bash
RUN_GRID_PROD=true \
GRID_STORAGE_STATE="./e2e/.auth/grid-prod.json" \
GRID_CHAT_URL="https://grid.outshift.io/chat" \
GRID_SCENARIOS_PATH="./e2e/fixtures/grid-prod-scenarios.example.json" \
npm run test:e2e:grid
```

Use the same `GRID_STORAGE_STATE` variable with `npm run test:e2e:ui` for Playwright UI mode. Omit `GRID_STORAGE_STATE` when you want to force a fresh interactive SSO login. The `e2e/.auth/` directory is ignored and must not be committed.
