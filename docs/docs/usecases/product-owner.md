---
sidebar_position: 3
---

# Use-case: Product Owner

## Tools and Integrations

### Jira
The Jira integration assists Product Owners in creating and managing:
- **Stories**: Break down features into smaller, actionable items.
- **Epics**: Group related stories under a larger initiative.
- **Tasks**: Define specific work items required to complete stories or epics.

### Confluence
The Confluence integration helps Product Owners draft and maintain:
- **Product Requirement Documents (PRD)**: Outline the objectives, features, and specifications for the product.
- **Documentation**: Collaborate on detailed plans, roadmaps, and other supporting materials.

These tools streamline the workflow for Product Owners, ensuring efficient planning and communication.

## Getting Started

Run CAIPE with the Jira and Confluence MCP integrations enabled:

```bash
docker compose --profile jira --profile confluence up
```

### What's Included

The Product Owner persona includes:
- **Jira MCP server**: Create and manage stories, epics, and tasks
- **Confluence MCP server**: Draft PRDs and maintain documentation
- **Dynamic Agents runtime**: Uses the enabled tools in chat and workflows

### Helm

For Kubernetes, enable the matching MCP chart tags:

```bash
helm install caipe charts/ai-platform-engineering \
  --set tags.caipe-ui=true \
  --set tags.dynamic-agents=true \
  --set tags.mcp-jira=true \
  --set tags.mcp-confluence=true
```
