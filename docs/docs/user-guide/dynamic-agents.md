---
title: Dynamic Agents
description: Create and configure agents in CAIPE's released runtime.
---

# Dynamic Agents

Dynamic Agents is CAIPE's released agent runtime and agent-authoring surface.
It lets teams create agents without building and deploying a new service for
each configuration.

![Dynamic Agents management page](/img/features/dynamic-agents.svg)

## Agent Configuration

An agent can include:

- Name, description, owner team, and visibility
- System prompt and selected LLM model
- Registered MCP servers and permitted tools
- CAIPE built-in tools
- Skills
- Subagents
- Runtime middleware and human-approval behavior
- Approved workflows the agent can start or monitor

The creation form shows only models, tools, skills, workflows, and teams the
current user is allowed to use.

## Models and Tools

The **Agents** workspace contains separate sections for:

- **Agents** — create and edit agent blueprints
- **MCP Servers** — register and test tool providers
- **Model Providers** — configure provider credentials or endpoints
- **LLM Models** — register model entries available to agents
- **Conversations** — inspect runtime conversations when the admin gate permits it

MCP endpoints and credentials should be tested before assigning their tools to
an agent. A successful endpoint probe does not grant users permission to use
the resulting agent or tool.

## Persistence

UI-managed agent definitions are stored in the configured MongoDB-compatible
database. Dynamic Agents also persists checkpoints and conversation-related
runtime state when the backend storage is configured.

Config-driven agents can be bootstrapped from Helm application configuration.
They are reconciled by the platform and should be changed through the source
configuration rather than edited in the UI.

## Sharing and Authorization

Agent ownership and visibility are enforced independently from tool,
credential, workflow, and knowledge access. Granting `agent#use` allows the
subject to invoke the agent; it does not automatically grant access to every
resource referenced by the agent.

## Current and Future Runtime Direction

Dynamic Agents is the current supported runtime. It is also the functional
starting point for the future Harness Engine direction, but Harness Engine and
additional runtime providers are not released platform features.

## Related Documentation

- [Custom Agents](../features/custom-agents.md)
- [Creating an Agent](../development/creating-an-agent.md)
- [Dynamic Agents Helm chart](../installation/helm-charts/ai-platform-engineering/dynamic-agents-chart)
