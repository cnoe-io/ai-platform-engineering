---
sidebar_position: 1
---

# Custom Agents

Build your own agents with custom system prompts, tool access, and personas — deploy via the no-code Agent Builder UI or the `dynamic-agents` Helm chart with full MCP server support.

**Quick links**: [Helm Chart Docs](../installation/helm-charts/ai-platform-engineering/dynamic-agents-chart) · [Developer Guide](../development/creating-an-agent)

---

## Dynamic Agents Service

Standalone agent-builder service — deploy independently of the main supervisor.

- Each custom agent gets its own system prompt, tool access, and persona
- Built-in MCP tool support: mount any MCP server into your agent at deploy time
- REST + SSE API compatible with A2A and AG-UI protocols
- Deploy via Helm: `oci://ghcr.io/cnoe-io/charts/dynamic-agents`

## Agent Builder UI

No-code agent creation directly from the CAIPE web UI.

- Configure system prompt, model, temperature, and allowed tools interactively
- Attach MCP servers to agents from the Skills Gateway catalog
- Instantly test agents in the chat UI without redeployment
- Share agents across teams with RBAC-controlled access

## Seed Config — Pre-wire Agents & MCP Servers

Bootstrap agents and MCP servers at chart install time using `seedConfig`.

| Key | Purpose |
|-----|---------|
| `seedConfig.enabled` | Enable bootstrapping on chart install |
| `seedConfig.agents` | List of agent definitions (name, system prompt, model, tools) |
| `seedConfig.mcp_servers` | MCP server endpoints to register at startup |
| `seedConfig.models` | Available LLM endpoints for agent selection |

Idempotent: safe to apply on upgrades without duplicating entries.

## Customizable System Prompts

- Per-agent system prompts — different personas for Platform Engineer, SRE, Developer
- Prompt library: curated, evaluated prompts for common platform workflows
- Override prompts at runtime via UI without redeploying the chart
- Prompt versioning tied to Helm chart version for reproducibility

## Multi-Model Support per Agent

Each custom agent can target a different LLM — Claude, GPT-4o, Gemini, or any OpenAI-compatible endpoint.

- Model selection per agent in `seedConfig.models`
- Switch models at runtime from the Agent Builder UI
- LLM secrets managed via Kubernetes Secrets or ExternalSecrets Operator

## Production Deployment

- Kubernetes Helm chart with configurable replicas, resources, and HPA
- `AGENT_RUNTIME_TTL_SECONDS` — auto-expire idle agent runtimes
- MongoDB-backed persistence for agent state and conversation history
- ExternalSecrets integration for secrets management in GitOps workflows
- Prometheus metrics endpoint at `/metrics` for observability
