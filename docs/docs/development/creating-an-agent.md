# Creating An Agent

CAIPE agents are Dynamic Agents backed by prompts, model settings, skills, and
MCP tool access.

## Create From The UI

1. Open the Agent Builder.
2. Create a new agent.
3. Choose a model.
4. Add a system prompt.
5. Attach MCP tools and skills.
6. Test the agent in chat.
7. Share it with the right users or teams.

## Seed With Helm

Use chart seed config for repeatable environments:

```yaml
caipe-ui:
  appConfig:
    agents:
      - id: platform-engineer
        name: Platform Engineer
        description: Helps with platform engineering workflows.
        model: claude-sonnet
        tools:
          - mcp-argocd
          - mcp-github
```

## Add New Tools

When an agent needs a new integration, create or register an MCP server:

- [Creating an MCP Server](./creating-mcp-server.md)
- [MCP Servers overview](../agents/README.md)

Dynamic Agents call MCP servers directly or through AgentGateway, depending on
the deployment's routing and RBAC configuration.
