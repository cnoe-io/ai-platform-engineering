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
