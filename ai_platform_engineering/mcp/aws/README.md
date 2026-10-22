# mcp-aws

AWS MCP Server that exposes `aws_cli_execute` and `eks_kubectl_execute` as
[Model Context Protocol](https://modelcontextprotocol.io) tools over HTTP/SSE.

## Tools

| Tool | Description |
|------|-------------|
| `aws_cli_execute` | Execute read-only AWS CLI commands (`describe-*`, `list-*`, `get-*`). Also supports one scoped write action: stopping a single EC2 instance in a configured account and region. IAM policies authorize the action using the session identity tag and deployment-specific resource tags. All other write/destructive operations remain blocked. |
| `eks_kubectl_execute` | Execute kubectl commands against an EKS cluster. Handles `aws eks update-kubeconfig` automatically. Secret data is redacted from output before returning to the LLM. |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_MODE` | `STDIO` | Transport mode: `stdio`, `sse`, or `http` |
| `MCP_HOST` | `localhost` | Bind host (HTTP/SSE mode) |
| `MCP_PORT` | `8000` | Bind port (HTTP/SSE mode) |
| `MCP_AUTH_MODE` | `none` | Set to `oauth2` in HTTP deployments to validate the user bearer token before any tool call. |
| `JWKS_URI` | — | OpenID Connect JWKS URL used when `MCP_AUTH_MODE=oauth2`. |
| `AUDIENCE` | — | Required JWT audience when `MCP_AUTH_MODE=oauth2`. |
| `ISSUER` | — | Required JWT issuer when `MCP_AUTH_MODE=oauth2`. |
| `MCP_AUTH_USERNAME_CLAIM` | `preferred_username` | JWT claim to use as the trusted identity session tag. Configure this to match the identity claim used by your identity provider and IAM resource tags. |
| `AWS_ACCOUNT_LIST` | — | Comma-separated `name:account_id` pairs for cross-account profiles |
| `CROSS_ACCOUNT_ROLE_NAME` | `caipe-read-only` | IAM role to assume in each account |
| `AWS_CLI_MAX_EXECUTION_TIME` | `30` | Timeout (seconds) for AWS CLI commands |
| `KUBECTL_MAX_EXECUTION_TIME` | `45` | Timeout (seconds) for kubectl commands |
| `AWS_CLI_MAX_OUTPUT_SIZE` | `20000` | Maximum output size (bytes) before truncation |
| `RESTRICT_KUBECTL_SECRETS` | `true` | Block `kubectl get/describe secret(s)` |
| `RESTRICT_KUBECTL_PROXY` | `true` | Block `kubectl proxy` |
| `RESTRICT_KUBECTL_EXEC` | `false` | Block `kubectl exec` |

The stop action reads the configured identity claim from the JWT validated by
`MCPAuthMiddleware` and passes it as the `username` STS session tag. The target
role must be listed in `AWS_ACCOUNT_LIST`, and its trust policy must allow the
session tag. Scope `ec2:StopInstances` in IAM to the accounts, regions, and
resource tags appropriate for your deployment; for owner-based access, compare
the instance `username` tag with the caller session `username` tag and add any
administrator exceptions in the target IAM policy. Other write actions remain
denied by the MCP tool.

## Running locally

```bash
cd ai_platform_engineering/agents/aws/mcp
uv run mcp-aws
```

## Docker

Built via the shared `build/agents/Dockerfile.mcp` with `AGENT_NAME=aws`,
`INSTALL_AWS_CLI=true`, and `INSTALL_KUBECTL=true`:

```bash
docker build \
  --build-arg AGENT_NAME=aws \
  --build-arg INSTALL_AWS_CLI=true \
  --build-arg INSTALL_KUBECTL=true \
  -f build/agents/Dockerfile.mcp \
  -t mcp-aws .
```
