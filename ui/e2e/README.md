# CAIPE Playwright scenarios

These specs cover the UI journeys that exist in this repository today:

- Scenario grid tracking for each requested test area.
- Chat with the SRE agent through A2A JSON-RPC streaming mocks.
- Outshift SRE triage across GitHub, ArgoCD, AWS, PagerDuty, and Splunk.
- Launch chat from the use-case gallery.
- GitHub pull request review from the use-case grid.
- Create a custom use case.
- Spot check settings and integration health indicators.

Several requested areas are tracked as `test.fixme` because this UI tree does not currently expose those pages:

- Workflows replacing Task Builder.
- Agent, MCP server, and Skill creation/sharing/RBAC screens.
- Dedicated Webex integration and admin settings pages.

Run locally with:

```bash
npm run test:e2e
```

The specs mock `http://localhost:8000` A2A traffic, so they do not require live ArgoCD, GitHub, AWS, PagerDuty, Splunk, or Webex credentials.

## GRID prod chat scenarios

The prod smoke spec is opt-in because it talks to the live GRID chat app:

```bash
RUN_GRID_PROD=true \
GRID_CHAT_URL="https://grid.outshift.io/chat/0e5a25f1-56ff-4004-a608-4c0ad8fe6b5e" \
GRID_SCENARIOS_PATH="./e2e/fixtures/grid-prod-scenarios.example.json" \
npm run test:e2e:grid
```

Use `GRID_SCENARIOS_PATH` for scenarios exported from the Confluence deployment testing page, or set `GRID_SCENARIOS_JSON` to an inline JSON array with the same shape.
