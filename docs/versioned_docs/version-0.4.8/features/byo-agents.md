---
sidebar_position: 2
---

# BYO A2A Agents & MCP Servers

CAIPE is the orchestration layer — plug in your own A2A-compatible agents and MCP servers via the supervisor agent registry, dynamic-agents seed config, or Docker Compose. Your protocols, your tools.

**Quick links**: [Supervisor Chart](../installation/helm-charts/ai-platform-engineering/supervisor-agent-chart) · [Dynamic Agents Chart](../installation/helm-charts/ai-platform-engineering/dynamic-agents-chart)

---

## A2A Agent Registry — Supervisor Helm Chart

Register external A2A agents with the supervisor via `multiAgentConfig`.

| Key | Purpose |
|-----|---------|
| `multiAgentConfig.agents` | Explicit list of external A2A agent endpoints to register |
| `multiAgentConfig.protocol` | `a2a` (peer-to-peer) or `slim` (hub-based) transport |
| `multiAgentConfig.port` | Port advertised to peer agents for inbound connections |

Auto-discovery mode: leave `agents` empty and the supervisor discovers peers on the network. Works with any A2A-compatible agent — CAIPE agents, custom FastAPI services, or third-party implementations.

## MCP Servers — Dynamic Agents Seed Config

Register external MCP server endpoints at chart install time using `seedConfig.mcp_servers`.

- Each entry specifies name, URL, and optional auth headers
- MCP servers are available to all custom agents in the dynamic-agents service
- Hot-register new MCP servers from the Skills Gateway UI without redeployment
- Supports HTTP/SSE MCP transport — compatible with FastMCP and any spec-compliant server

## Docker Compose — A2A Transport

| Env Var | Purpose |
|---------|---------|
| `A2A_TRANSPORT` | `p2p` for peer-to-peer or `slim` for hub-based routing |
| `NEXT_PUBLIC_A2A_BASE_URL` | Point the UI at your custom supervisor or gateway endpoint |

Add any external A2A agent as a new service in `docker-compose.yaml` with the shared network. Each agent service exposes its A2A endpoint; the supervisor discovers and routes to it automatically.

## Supported Protocols

| Protocol | Description |
|----------|-------------|
| **A2A** (Agent-to-Agent) | Google-led open protocol for agent interoperability |
| **MCP** (Model Context Protocol) | Anthropic-led standard for tool and resource exposure |
| **AG-UI / SSE** | Real-time event streaming across all agent types |
| **SLIM** | Hub-based routing for firewall-friendly deployments |
| **OpenAI-compatible** | Any agent exposing `/v1/chat/completions` works |

## Bring Your Own LLM

Any OpenAI-compatible endpoint works — Claude (via Anthropic), GPT-4o, Gemini, Llama, Mistral.

- Configure per-agent model endpoints in `llmSecrets` or `seedConfig.models`
- LiteLLM proxy support — route to any provider through a single unified endpoint
- Switch models without redeploying — update via Helm values or the UI

## Backstage & External Integrations

- **Agent Forge Backstage plugin** — surface CAIPE agents directly in your Internal Developer Portal
- **Slack Bot / Webex Bot** — expose the full supervisor as a conversational interface
- **CLI access** — invoke any agent from the terminal via the CAIPE CLI
- **REST API** — integrate agent execution into CI/CD pipelines or custom dashboards
