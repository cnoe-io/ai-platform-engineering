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

   Edit `.env` with your LLM configuration. The checked-in example is an OSS
   all-in-one profile set that starts the supervisor, MCP servers, production UI,
   dynamic agents, local Keycloak/RBAC, MongoDB, and RAG:

   ```bash
   IMAGE_TAG=0.5.14
   COMPOSE_PROFILES=mcp-servers,caipe-ui-prod,rbac,caipe-supervisor,dynamic-agents,rag,caipe-mongodb

   # All-in-one mode: agents run in-process and use MCP server containers.
   DISTRIBUTED_AGENTS=

   # Enable the tools you want the supervisor to expose.
   ENABLE_GITHUB=true

   # LLM provider (openai, azure-openai, aws-bedrock)
   LLM_PROVIDER=openai
   OPENAI_API_KEY=<token>

   # GitHub MCP server token, if GitHub tools are enabled.
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

Use Docker Compose **profiles** to select services. The default `.env.example`
starts the OSS all-in-one stack:

```bash
docker compose up
```

Open the UI at **http://localhost:3000** and the supervisor API at **http://localhost:8000**.

Add `web_ingestor` when you want the web ingestion worker. Add `slack-bot` or
`webex-bot` only when you want those bot integrations.

**Primary profiles:**

| Profile | Description |
|---------|-------------|
| `caipe-supervisor` | Supervisor API and all-in-one agent runtime |
| `mcp-servers` | MCP server containers used by all-in-one agents |
| `caipe-ui-prod` | Production CAIPE UI image |
| `caipe-mongodb` | MongoDB for UI, RBAC, dynamic agents, and checkpoint data |
| `rbac` | Local Keycloak, OpenFGA, AgentGateway, and config bridge |
| `dynamic-agents` | Dynamic agent runtime used by the UI |
| `rag` | Vector RAG services (Milvus, Redis, RAG server) |
| `web_ingestor` / `web-ingestor` | Web datasource ingestion worker |
| `slack-bot` | Slack bot integration service |
| `webex-bot` | Webex bot integration service |
| `slim` | AGNTCY Slim dataplane (set `A2A_TRANSPORT=slim`) |
| `tracing` | Langfuse distributed tracing (Clickhouse, Postgres) |

Domain profiles such as `github`, `argocd`, `jira`, `slack`, and `webex` are
kept as compatibility aliases for individual MCP services. In all-in-one mode,
prefer `mcp-servers` plus the matching `ENABLE_*` flags instead of starting
remote sub-agent containers.

**Examples:**

```bash
# Default OSS all-in-one stack from .env
docker compose up

# Render the selected services without starting them
docker compose config --services

# Add tracing
docker compose --profile tracing up

# Add graph RAG
docker compose --profile graph_rag up

# Add the web ingestion worker
docker compose --profile web_ingestor up

# Build from source with the same profile set
docker compose -f docker-compose.dev.yaml up --build
```

### Deployment modes

The supervisor mode is controlled by `DISTRIBUTED_AGENTS`:

| Value | Mode |
|-------|------|
| empty | All-in-one; agents run in-process and call MCP server containers |
| `all` | Fully distributed; all agents run as remote A2A containers |
| comma-separated agent names | Hybrid; only listed agents run remotely |

```bash
# All-in-one, the default in .env.example
DISTRIBUTED_AGENTS= docker compose up

# Fully distributed in the dev compose file
DISTRIBUTED_AGENTS=all docker compose -f docker-compose.dev.yaml --profile all-agents up --build

# Hybrid example
DISTRIBUTED_AGENTS=argocd,github docker compose -f docker-compose.dev.yaml --profile argocd --profile github up --build
```

---

## Connect to the agent

Once services are running, connect with the agent chat CLI:

**Using Docker (host network):**
```bash
docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
```

**Using uvx:**
```bash
uvx --no-cache git+https://github.com/cnoe-io/agent-chat-cli.git a2a
```

---

## Tracing with Langfuse

The `tracing` profile starts Langfuse v3 (web UI, worker, ClickHouse, Postgres, MinIO).

1. Start with tracing:
   ```bash
   docker compose --profile tracing up
   ```

2. Open Langfuse at **http://localhost:3001**, create an account, and copy the API keys.

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
