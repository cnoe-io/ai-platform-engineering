---
sidebar_position: 1
---

# Custom Agents

Build your own team-owned agents with custom system prompts, model selection, tool access, skills, subagents, and workflows. Use the no-code Agent Builder UI for day-to-day authoring, or bootstrap config-driven agents with the CAIPE UI chart.

**Quick links**: [Helm Chart Docs](../installation/helm-charts/ai-platform-engineering/dynamic-agents-chart) · [Developer Guide](../development/creating-an-agent)

---

## Dynamic Agents Service

Dynamic Agents is the chat runtime and agent-builder service.

- Each custom agent gets its own system prompt, model, tool access, and persona
- MCP tool support: connect registered MCP servers over `stdio` or streamable `http`
- Built-in tools include URL fetch, current datetime, user info, wait, and approved workflow execution
- REST + SSE API for browser, bot, workflow, and service callers
- Deploy via Helm: `oci://ghcr.io/cnoe-io/charts/dynamic-agents`

## Agent Builder UI

No-code agent creation directly from the CAIPE web UI.

- Configure owner team, visibility, system prompt, model, and allowed tools interactively
- Attach registered MCP server tools and built-in tools to each agent
- Add skills, subagents, middleware settings, human approval rules, and workflow access
- Instantly test agents in the chat UI without redeployment
- Use `team` or `global` visibility with RBAC-controlled access

## App Config — Pre-wire Models, MCP Servers, Agents, and Workflows

Bootstrap CAIPE resources at chart install time using `appConfig` in the `caipe-ui` chart. Bootstrapped resources are marked `config_driven` and cannot be edited through the UI.

| Key | Purpose |
|-----|---------|
| `appConfig.models` | Available LLM endpoints for agent selection |
| `appConfig.mcp_servers` | MCP server endpoints to register at startup |
| `appConfig.agents` | Agent definitions: name, system prompt, model, tools, skills, subagents, and visibility |
| `appConfig.workflow_configs` | Workflow definitions that agents can trigger when granted access |

Idempotent: safe to apply on upgrades without duplicating entries. Removed config-driven entries are cleaned up on the next startup.

## Customizable System Prompts

- Per-agent system prompts for Platform Engineer, SRE, Developer, or service-specific personas
- Ready-to-use SRE agent included out of the box — customize prompts, tools, and workflows for your team
- Prompt changes are saved in MongoDB for UI-managed agents; config-driven agents keep prompts in Helm values for GitOps review
- Workflow-enabled agents receive an automatic prompt addendum listing approved workflows

## Multi-Model Support per Agent

Each custom agent can target a different configured model/provider entry.

- Define available models in `appConfig.models`
- Select or change an agent's model in the Agent Builder UI
- Use OpenAI-compatible provider entries, including LiteLLM-backed endpoints
- LLM secrets managed via Kubernetes Secrets or ExternalSecrets Operator

## Production Deployment

- Kubernetes Helm chart with configurable replicas, resources, and HPA
- `AGENT_RUNTIME_TTL_SECONDS` — auto-expire idle agent runtimes
- MongoDB-backed persistence for agent state and conversation history
- ExternalSecrets integration for secrets management in GitOps workflows
- Prometheus metrics endpoint at `/metrics` for observability
