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

By default each GRID scenario creates a fresh chat conversation before sending
the prompt. Set `GRID_REUSE_CONVERSATION=true` only when you intentionally want
to continue the currently active chat.

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
npm run test:e2e:grid:ui
```

The GRID UI script launches your installed Google Chrome app by default because
macOS Local Network permissions are tied to the browser app bundle. If Duo says
it needs local-network permission, enable **Google Chrome** under **System
Settings > Privacy & Security > Local Network**. Depending on the macOS prompt,
the entry can also appear as **Duo Desktop**.

Live chat execution can pause for human approval or required fields. In
Playwright UI mode, click **Approve** on any tool-approval card. The bundled
GRID prod scenario fixture includes default values for common **Input Required**
fields across SRE debug, LiteLLM key, AWS, S3, GitHub, deploy, Jira, Knowledge
Base/RAG, ArgoCD, LLM Gateway, session persistence, graceful degradation, and
Webex flows. Resource names include `{{run_id}}`, which resolves to a timestamp
unless you set `GRID_TEST_RUN_ID`. When GRID shows **Waiting for user
response**, the spec sends the scenario defaults back through the chat input by
default. Set `GRID_AUTO_RESPOND_TO_USER_INPUT=false` to make those follow-up
questions manual, or adjust `GRID_MAX_AUTO_USER_RESPONSES` when a workflow needs
more than five follow-up replies.

The live spec dismisses nuisance popups by default, including browser
`alert`/`confirm`/`prompt` dialogs, release/cookie/tour modals, and notification
prompts. It does not dismiss SSO pages, tool approvals, or input-required forms.
Set `GRID_DISMISS_POPUPS=false` when you need to inspect a popup manually.

To let Playwright approve tool calls automatically after you run a scenario:

```bash
npm run test:e2e:grid:ui:approve
```

To execute the full live scenario suite without manual tool approvals and write
per-scenario results:

```bash
npm run test:e2e:grid:execute
```

Print the report in a PR-friendly format:

```bash
npm run test:e2e:grid:report
```

The execution report is written to
`test-results/grid-prod-execution-report.json`. Each scenario records the fresh
chat URL, completion timestamp, final GRID response, whether a completed tool
signal was observed, and resource details derived from the executed inputs and
GRID response. For example, the LLM key scenario reports the generated LiteLLM
key name, model, key type, owner, TTL, budget, and completion timestamp. The EC2
scenario reports the generated instance name, AWS account, region, instance
type, AMI/OS, network defaults, TTL, and any observed EC2 instance IDs or IPs
found in GRID's final response. Secret-looking key/token values are redacted.

To also supply input-form values automatically:

```bash
GRID_HITL_FORM_VALUES_JSON='{"key_type":"individual","model":"azure/gpt-4o-mini"}' \
npm run test:e2e:grid:ui:approve
```

Use `GRID_HITL_FORM_VALUES_JSON` for global overrides, or set a per-scenario
override named from the scenario id. For example:

```bash
GRID_CREATE_EC2_INSTANCE_HITL_FORM_VALUES_JSON='{"region":"us-west-2","instance_type":"t3.micro"}' \
npm run test:e2e:grid:ui:approve
```

For plain chat follow-up answers, use `GRID_HITL_RESPONSE` globally or a
per-scenario variable such as `GRID_CREATE_LLM_KEY_HITL_RESPONSE`.

The `Create Jira ticket` scenario includes default input-required values:
project key `SRE`, issue type `Task`, a GRID prod testing summary/description,
epic `GRID Prod 0.5.x Deployment Testing`, labels, and priority `Medium`.
Override those defaults with `GRID_JIRA_PROJECT_KEY`, `GRID_JIRA_EPIC`,
`GRID_JIRA_ISSUE_TYPE`, `GRID_JIRA_SUMMARY`, `GRID_JIRA_DESCRIPTION`,
`GRID_JIRA_LABELS`, or `GRID_JIRA_PRIORITY`. For a full per-scenario override,
set `GRID_CREATE_JIRA_TICKET_HITL_FORM_VALUES_JSON`.

When the GRID login page appears, the spec clicks **Sign in with SSO**. Complete
Cisco/Duo login in the Playwright browser window and wait for GRID chat to load.
If `GRID_SSO_EMAIL` is set, the spec fills the Duo email step and clicks
**Next** before handing control back for password and MFA. If the SSO page asks
for input the script cannot safely automate, type it directly in the Playwright
browser window; the test keeps waiting for GRID chat until `GRID_AUTH_TIMEOUT_MS`
expires. The test saves the resulting session to `GRID_SAVE_STORAGE_STATE`.
After the first successful login, reruns use `./e2e/.auth/grid-prod.json` so
GRID should open directly without the full Cisco/Duo flow. Delete that file only
when you intentionally want to force a fresh SSO login.

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

## Team pre-merge workflow

For every PR, keep the normal mocked UI/Playwright checks as the required
automated signal. The live GRID prod suite creates real conversations and can
create real downstream resources, so run it as a trusted manual pre-merge check
only when the PR changes GRID chat, workflows, agents, credentials, MCP, Skills,
or deployment flows.

Local pre-merge run:

```bash
git checkout <pr-branch>
cd ui
npm ci
npm run test:e2e:grid:execute
npm run test:e2e:grid:report
```

Before the first local run, create `e2e/.auth/grid-prod.json` by running
`npm run test:e2e:grid:ui`, completing Cisco/Duo SSO in the Playwright browser,
and waiting for GRID chat to load. Each teammate owns their own local auth file.
Never commit or share `e2e/.auth/grid-prod.json`.

Optional GitHub pre-merge run:

1. Configure a protected GitHub Environment named `grid-prod-live`.
2. Add `GRID_PROD_STORAGE_STATE_B64` to that environment using a trusted CI or
   shared test account, not a personal account:

   ```bash
   base64 -i ui/e2e/.auth/grid-prod.json | pbcopy
   ```

3. Open **Actions > [E2E] GRID Prod Live > Run workflow**.
4. Set `target_ref` to the PR branch or commit SHA.
5. Download the `grid-prod-live-*` artifact or read the log section from
   `npm run test:e2e:grid:report`.

The GitHub workflow does not perform interactive SSO. If the stored GRID session
expires, refresh the environment secret with a new storage-state file and rerun.
