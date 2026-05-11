---
sidebar_position: 3
---

# Use-case: Product Owner

## Tools and Agents

### Jira Agent
The Jira agent assists Product Owners in creating and managing:
- **Stories**: Break down features into smaller, actionable items.
- **Epics**: Group related stories under a larger initiative.
- **Tasks**: Define specific work items required to complete stories or epics.

### Confluence Agent
The Confluence agent helps Product Owners draft and maintain:
- **Product Requirement Documents (PRD)**: Outline the objectives, features, and specifications for the product.
- **Documentation**: Collaborate on detailed plans, roadmaps, and other supporting materials.

These tools streamline the workflow for Product Owners, ensuring efficient planning and communication.

## Getting Started

Run the Product Owner persona with both Jira and Confluence agents:

```bash
# Using the generated docker-compose file
cd docker-compose
docker compose -f docker-compose.product-owner.yaml --profile a2a-p2p up

# Or with SLIM transport
docker compose -f docker-compose.product-owner.yaml --profile a2a-over-slim up

# Generate fresh compose file
make generate-docker-compose PERSONAS="product-owner"

# Or in dev mode with local code
make generate-docker-compose PERSONAS="product-owner" DEV=true
```

### What's Included

The Product Owner persona includes:
- **Jira Agent**: Create and manage stories, epics, and tasks
- **Confluence Agent**: Draft PRDs and maintain documentation
- **CAIPE Orchestrator**: Coordinates between agents for seamless workflows

### Individual Agents

You can also run individual agents separately:

```bash
# Run only Jira agent
docker compose -f docker-compose.jira.yaml --profile a2a-p2p up

# Run only Confluence agent
docker compose -f docker-compose.confluence.yaml --profile a2a-p2p up
```

See the [docker-compose README](https://github.com/cnoe-io/ai-platform-engineering/blob/main/docker-compose/README.md) for all available personas and agents.