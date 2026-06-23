# Prebuild Flow

Prebuild branches let CI publish branch-scoped images before a PR is merged.

## Branch Naming

Use the `prebuild/` prefix:

```text
prebuild/feat/example-change
```

## Image Families

| Area | Workflow |
|---|---|
| UI/BFF | `prebuild-caipe-ui.yml` |
| Dynamic Agents | `prebuild-dynamic-agents.yml` |
| MCP servers | `prebuild-mcp-agent.yml` |
| RAG | `prebuild-rag.yml` |
| Slack bot | `prebuild-slack-bot.yml` |
| Audit service | `prebuild-audit-service.yml` |
| Helm chart | `prebuild-helm.yml` |

## Use In Helm

Set the chart image channel or per-component image tag to consume prebuilt
images from a branch.
