# caipe-ui Helm Chart

Deploys the CAIPE Next.js UI and BFF.

The UI talks to the dynamic-agent runtime server-side through
`DYNAMIC_AGENTS_URL` and proxies browser chat traffic through
`/api/v1/chat/stream/*`.

Common values:

- `image.repository`, `image.tag`, `image.pullPolicy`
- `config`: non-sensitive environment variables
- `existingSecret`: existing Secret mounted with `envFrom`
- `externalSecrets`: optional ExternalSecret integration
- `oauthConnectors`: arbitrary OAuth connectors bootstrapped into the credential store
- `appConfig.models`: model selector entries
- `appConfig.mcp_servers`: dynamic-agent MCP server bootstrap entries

See `values.yaml` for the complete value schema.

## Declarative OAuth connectors

Use `oauthConnectors` to provision the same connectors that an administrator can
create under **Credentials → Connected Apps**:

```yaml
caipe-ui:
  oauthConnectors:
    - provider: webex_secondary
      name: Webex Secondary
      clientIdEnv: WEBEX_SECONDARY_CLIENT_ID
      clientSecretEnv: WEBEX_SECONDARY_CLIENT_SECRET
      authorizationUrl: https://webexapis.com/v1/authorize
      tokenUrl: https://webexapis.com/v1/access_token
      scopes:
        - spark:mcp
        - meeting:schedules_read
      redirectUri: https://caipe.example.com/api/credentials/oauth/webex_secondary/callback
  existingSecret: caipe-ui-secrets
```

`clientIdEnv` and `clientSecretEnv` refer to keys mounted from `existingSecret`
or `externalSecrets`; secret values are never rendered into the ConfigMap. A
non-empty list is bootstrapped automatically and upserted by `provider` at every
UI startup. Declarative entries override legacy fixed-provider environment
bootstrap entries. Removing an entry does not delete or disable the connector
already stored in MongoDB.
