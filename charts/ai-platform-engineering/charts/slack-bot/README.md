# slack-bot Helm Chart

Deploys the CAIPE Slack bot surface.

The Slack bot routes CAIPE requests through the UI/BFF using `CAIPE_API_URL`;
the BFF then applies authz and streams through dynamic agents.

Common values:

- `image.repository`, `image.tag`, `image.pullPolicy`
- `config.CAIPE_API_URL`
- `config.SLACK_BOT_MODE`
- `config.SLACK_AGENT_ROUTES_MODE`
- `config.SLACK_DEFAULT_AGENT_ID`
- `existingSecret`
- `serviceAccount`

See `values.yaml` for the complete value schema.
