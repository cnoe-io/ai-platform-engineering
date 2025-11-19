---
sidebar_position: 2
---

# 🚀 Quick Start

Get started with CAIPE quickly using Docker Compose on your laptop or VM.

<div style={{paddingBottom: '50%', position: 'relative', display: 'block', width: '100%'}}>
	<iframe src="https://app.vidcast.io/share/embed/3f890fa0-8d33-41ef-934e-f2fc5968b573?mute=1&autoplay=1" width="100%" height="100%" title="CAIPE Getting Started with Docker Compose Demo" loading="lazy" allow="fullscreen *;autoplay *;" style={{position: 'absolute', top: 0, left: 0, border: 'solid', borderRadius: '12px'}}></iframe>
</div>

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

   Update `.env` with your configuration. For detailed `.env` examples and LLM provider setup, see:
   - [Setup LLM Providers](docker-compose/configure-llms.md) for LLM configuration
   - [Configure Agent Secrets](docker-compose/configure-agent-secrets.md) for agent-specific configurations

   Here's a sample configuration:
   _Note:_ More info on setting up LLM Provider is here : https://github.com/cnoe-io/cnoe-agent-utils

```
########### CAIPE Agent Configuration ###########

# Enable the agents you want to deploy
ENABLE_GITHUB=true

# A2A transport configuration (p2p or slim)
A2A_TRANSPORT=p2p

# MCP mode configuration (http or stdio)
MCP_MODE=http

# LLM provider configuration
LLM_PROVIDER=<azure-openai or aws-bedrock or openai.>

## Example Azure OpenAI Configuration
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_VERSION=
AZURE_OPENAI_DEPLOYMENT=


## Example AWS Bedrock Configuration
AWS_BEDROCK_ENABLE_PROMPT_CACHE=true
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_DEFAULT_REGION=
AWS_BEDROCK_MODEL_ID=<AWS_BEDROCK_MODEL_ID>
BEDROCK_TEMPERATURE=

########### GitHub Agent Configuration ###########
GITHUB_PERSONAL_ACCESS_TOKEN=<GITHUB_PERSONAL_ACCESS_TOKEN>
```

## 🚀 Start CAIPE with Docker Compose Profiles

Use Docker Compose profiles to enable specific agents. Profiles allow you to selectively start only the agents you need.

**Available Agent Profiles:**
- `argocd` - ArgoCD GitOps for Kubernetes deployments
- `aws` - AWS cloud operations and resource management
- `backstage` - Backstage developer portal integration
- `confluence` - Confluence documentation management
- `github` - GitHub source code management and pull requests
- `jira` - Jira issue tracking and project management
- `komodor` - Komodor Kubernetes troubleshooting
- `pagerduty` - PagerDuty incident management
- `petstore` - Petstore API example agent
- `rag` - RAG (Retrieval-Augmented Generation) agent for knowledge base queries
- `slack` - Slack team communication
- `splunk` - Splunk observability and logging
- `weather` - Weather API example agent
- `webex` - Webex video communication

**Special Profiles:**
- `agentforge` - Agent Forge Backstage Plugin web UI (can be combined with any agent profile)
- `slim` - AGNTCY Slim dataplane service for centralized agent communication (alternative to p2p)

**RAG Profile (`rag`):**
- **Purpose**: Provides knowledge base queries using Retrieval-Augmented Generation (RAG) and GraphRAG
- **Services Included**: RAG server, RAG agent, RAG web UI, Neo4j (knowledge graph), Milvus (vector database), Redis
- **Use Cases**: Answer questions from knowledge base, query entity relationships, search documentation
- **Web UI**: Accessible at `http://localhost:9447` when running
- **Configuration**: Set `ENABLE_GRAPH_RAG=true` in `.env` to enable GraphRAG capabilities
- **Note**: This profile starts multiple supporting services (databases, vector stores) and may take longer to initialize

**Tracing Profile (`tracing`):**
- **Purpose**: Enables distributed tracing and observability using Langfuse v3
- **Services Included**: Langfuse web UI, worker, ClickHouse, PostgreSQL, Redis, MinIO
- **Use Cases**: Monitor agent interactions, trace request flows across agents, evaluate agent performance
- **Web UI**: Accessible at `http://localhost:3000` when running
- **Configuration Required**: Add to your `.env` file:
  ```bash
  ENABLE_TRACING=true
  LANGFUSE_PUBLIC_KEY=your-public-key
  LANGFUSE_SECRET_KEY=your-secret-key
  LANGFUSE_HOST=http://langfuse-web:3000
  ```
- **Note**: Can be combined with any agent profile to add observability to your setup

**Examples:**

```bash
# Start only the GitHub agent
COMPOSE_PROFILES="github" docker compose up
```

```bash
# Start multiple agents: ArgoCD, AWS, Backstage, and RAG
COMPOSE_PROFILES="argocd,aws,backstage,rag" docker compose up
```

```bash
# Start RAG agent with tracing enabled
# This enables knowledge base queries with full observability
COMPOSE_PROFILES="rag,tracing" docker compose up
```

```bash
# Start GitHub and RAG agents with tracing enabled
# Combines source code management, knowledge base, and observability
COMPOSE_PROFILES="github,rag,tracing" docker compose up
```

```bash
# Start GitHub, Petstore, Weather agents with Agent Forge UI and tracing enabled
# Complete development setup with example agents, web UI, and observability
COMPOSE_PROFILES="github,petstore,weather,agentforge,tracing" docker compose up
```

```bash
# Start agents with SLIM dataplane for centralized communication
# Enables AGNTCY Slim dataplane and control plane services
COMPOSE_PROFILES="slim,github,aws" docker compose up
```

**Combining Profiles:**
- The `rag` and `tracing` profiles work well together for knowledge base operations with full observability
- The `agentforge` profile provides a web UI and can be combined with any agent profiles
- The `slim` profile enables centralized communication via AGNTCY Slim dataplane (set `A2A_TRANSPORT=slim` in `.env` when using this profile)
- When using `tracing`, ensure your `.env` has `ENABLE_TRACING=true` and Langfuse credentials configured
- Access RAG web UI at `http://localhost:9447`, Langfuse dashboard at `http://localhost:3000`, and Agent Forge at `http://localhost:13000`

**Note:**
- If no docker compose profiles are specified, only the CAIPE supervisor agent is started
- Multiple profiles can be combined by separating them with commas
- The `tracing` and `agentforge` profiles can be added to any combination of agents

### Connect to the Agent

Once your agents are running, connect using one of these methods:

**Option A: Using Docker (host network)**
```bash
docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
```

**Option B: Using uvx**
```bash
uvx https://github.com/cnoe-io/agent-chat-cli.git <a2a|mcp>
```

**Option C: Using Agent Forge Backstage Plugin**

Run the Agent Forge plugin with Docker:

```bash
docker run -d \
  --name backstage-agent-forge \
  -p 13000:3000 \
  -e NODE_ENV=development \
  ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
```

**Or with Docker Compose:**

```bash
COMPOSE_PROFILES="agentforge" docker compose up
```

Once the container is started, open agent-forge in your browser:
```
http://localhost:13000
```

> 💡 Learn more about [Agent Forge Backstage Plugin](user-interfaces.md#agent-forge-backstage-plugin) and other user interfaces.

## 📊 Run Agents for Tracing & Evaluation

Enable observability and evaluation with Langfuse v3:

1. **In .env file**
   ```bash
   ENABLE_TRACING=true
   ```

2. **Start with tracing enabled**
   ```bash
   docker compose down
   ```

   ```bash
   COMPOSE_PROFILES="github,tracing" docker compose up
   ```

3. **Access Langfuse dashboard** at `http://localhost:3000` and create an account and apply for API key

4. **Configure Langfuse keys in `.env`**
   ```bash
   LANGFUSE_PUBLIC_KEY=your-public-key
   LANGFUSE_SECRET_KEY=your-secret-key
   LANGFUSE_HOST=http://langfuse-web:3000 # If used as docker-compose host
   ```

<div style={{paddingBottom: '56.25%', position: 'relative', display: 'block', width: '100%'}}>
	<iframe src="https://app.vidcast.io/share/embed/4882e719-fdc4-4a85-ae7e-8984e3491a53?mute=1&autoplay=1&disableCopyDropdown=1" width="100%" height="100%" title="CAIPE Getting Started Tracing using Docker Compose" loading="lazy" allow="fullscreen *;autoplay *;" style={{position: 'absolute', top: 0, left: 0, border: 'solid', borderRadius: '12px'}}></iframe>
</div>

## Next Steps

- **Configure Authentication**: See [Docker Compose Setup](docker-compose/setup.md) for A2A authentication options
- **User Interfaces**: Learn about [Agent Chat CLI](user-interfaces.md#agent-chat-cli) and [Agent Forge Backstage Plugin](user-interfaces.md#agent-forge-backstage-plugin)
- **Deploy to Kubernetes**: Check out [Helm Setup](helm/setup.md) or [EKS Setup](eks/setup.md) for production deployments

