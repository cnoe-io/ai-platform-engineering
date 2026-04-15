---
sidebar_position: 1
---

# Run with Docker Compose

Set up CAIPE on a laptop or VM (e.g. EC2) using Docker Compose.

## Prerequisites

1. **Clone the repository**

   ```bash
   git clone https://github.com/cnoe-io/ai-platform-engineering.git
   cd ai-platform-engineering
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your configuration. Minimal example:

   ```bash
   ########### CAIPE Agent Configuration ###########

   # Enable the agents you want to deploy
   ENABLE_GITHUB=true

   # A2A transport configuration (p2p or slim)
   A2A_TRANSPORT=p2p

   # MCP mode configuration (http or stdio)
   MCP_MODE=http

   # LLM provider (anthropic-claude, aws-bedrock, openai, azure-openai)
   LLM_PROVIDER=anthropic-claude
   ANTHROPIC_API_KEY=sk-ant-...

   ########### GitHub Agent Configuration ###########
   GITHUB_PERSONAL_ACCESS_TOKEN=<token>
   ```

   For full LLM provider options see [Configure LLMs](configure-llms.md).
   For agent-specific credentials see [Configure Agent Secrets](configure-agent-secrets.md).

3. **Configure A2A Authentication (optional)**

   **Option A: OAuth2 (recommended for production)**

   ```bash
   A2A_AUTH_OAUTH2=true
   JWKS_URI=https://your-idp.com/.well-known/jwks.json
   AUDIENCE=your-audience
   ISSUER=https://your-idp.com
   OAUTH2_CLIENT_ID=your-client-id
   ```

   Get a JWT token with:
   ```bash
   OAUTH2_CLIENT_SECRET=your-secret \
   TOKEN_ENDPOINT=https://your-idp.com/oauth/token \
   python ai_platform_engineering/utils/oauth/get_oauth_jwt_token.py
   ```

   **Local development with Keycloak:**

   ```bash
   cd deploy/keycloak && docker compose up
   ```

   Then set:
   ```bash
   A2A_AUTH_OAUTH2=true
   JWKS_URI=http://localhost:7080/realms/caipe/protocol/openid-connect/certs
   AUDIENCE=caipe
   ISSUER=http://localhost:7080/realms/caipe
   OAUTH2_CLIENT_ID=caipe-cli
   OAUTH2_CLIENT_SECRET=<from-keycloak>
   TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token
   ```

   Keycloak admin console: http://localhost:7080 (admin / admin). Switch to the `caipe` realm and create a `caipe-cli` client.

   **Option B: Shared key (development / testing)**

   ```bash
   A2A_AUTH_SHARED_KEY=your-secret-key
   ```

   > If neither option is set, the agent runs without authentication — not recommended for production.

---

## Start CAIPE

Use Docker Compose **profiles** to enable specific agents. If no profile is specified, only the supervisor starts.

**Available agent profiles:**

| Profile | Description |
|---------|-------------|
| `argocd` | ArgoCD GitOps for Kubernetes deployments |
| `aws` | AWS cloud operations |
| `backstage` | Backstage developer portal |
| `confluence` | Confluence documentation |
| `github` | GitHub repos and pull requests |
| `jira` | Jira issue tracking |
| `komodor` | Komodor Kubernetes troubleshooting |
| `pagerduty` | PagerDuty incident management |
| `rag` | RAG knowledge base (Milvus, Neo4j, Redis) |
| `slack` | Slack messaging |
| `splunk` | Splunk observability |
| `webex` | Webex collaboration |
| `slim` | AGNTCY Slim dataplane (set `A2A_TRANSPORT=slim`) |
| `tracing` | Langfuse distributed tracing (Clickhouse, Postgres) |

**Examples:**

```bash
# Supervisor only
docker compose up

# Single agent
COMPOSE_PROFILES="github" docker compose up

# Multiple agents
COMPOSE_PROFILES="argocd,aws,backstage" docker compose up

# With RAG knowledge base
COMPOSE_PROFILES="github,rag" docker compose up

# With tracing
COMPOSE_PROFILES="github,tracing" docker compose up

# Full stack: agents + RAG + tracing
COMPOSE_PROFILES="github,rag,tracing" docker compose up
```

---

## Connect to the agent

Once services are running, connect with the CAIPE CLI:

```bash
caipe config set server.url http://localhost:8000
caipe auth login
caipe
```

> **Install:** `curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh`

---

## Tracing with Langfuse

The `tracing` profile starts Langfuse v3 (web UI, worker, ClickHouse, Postgres, MinIO).

1. Start with tracing:
   ```bash
   COMPOSE_PROFILES="github,tracing" docker compose up
   ```

2. Open Langfuse at **http://localhost:3000**, create an account, and copy the API keys.

3. Add to `.env` and restart:
   ```bash
   ENABLE_TRACING=true
   LANGFUSE_PUBLIC_KEY=your-public-key
   LANGFUSE_SECRET_KEY=your-secret-key
   LANGFUSE_HOST=http://langfuse-web:3000
   ```

<div style={{paddingBottom: '56.25%', position: 'relative', display: 'block', width: '100%'}}>
  <iframe src="https://app.vidcast.io/share/embed/4882e719-fdc4-4a85-ae7e-8984e3491a53?mute=1&autoplay=1&disableCopyDropdown=1" width="100%" height="100%" title="CAIPE Getting Started Tracing using Docker Compose" loading="lazy" allow="fullscreen *;autoplay *;" style={{position: 'absolute', top: 0, left: 0, border: 'solid', borderRadius: '12px'}}></iframe>
</div>

---

## Next steps

- [Configure LLMs](configure-llms.md) — LLM provider and API key setup
- [Configure Agent Secrets](configure-agent-secrets.md) — Agent-specific credentials
- [Deploy to Kubernetes](../kind/setup.md) — KinD local cluster
- [Deploy with Helm](../helm/setup.md) — Production Kubernetes deployment
