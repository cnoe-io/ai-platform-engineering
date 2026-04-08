# Quickstart: Per-Agent Distribution Control

**Date**: 2026-04-08  
**Spec**: `098-unify-single-distributed-binding`

## Usage

### All agents in-process (default)

```bash
# No env vars needed — this is the default
docker compose -f docker-compose.dev.yaml up caipe-supervisor
```

### Specific agents distributed

```bash
# Only ArgoCD and AWS run as remote A2A containers
DISTRIBUTED_AGENTS=argocd,aws docker compose -f docker-compose.dev.yaml \
  --profile argocd --profile aws up
```

### All agents distributed (legacy-compatible)

```bash
# Either of these produces identical behavior
DISTRIBUTED_AGENTS=all docker compose -f docker-compose.dev.yaml up
DISTRIBUTED_MODE=true  docker compose -f docker-compose.dev.yaml up
```

### Mixed mode with agent disable

```bash
# ArgoCD distributed, Splunk disabled, everything else in-process
DISTRIBUTED_AGENTS=argocd ENABLE_SPLUNK=false docker compose -f docker-compose.dev.yaml \
  --profile argocd up
```

## Helm Values

```yaml
# charts/ai-platform-engineering/values.yaml
env:
  DISTRIBUTED_AGENTS: "argocd,aws"
  ENABLE_SPLUNK: "false"
```

## Verification

After the supervisor starts, check the logs for per-agent routing:

```
INFO - 📡 argocd → remote A2A subagent
INFO - 🏠 jira → in-process MCP tools
INFO - 🏠 github → in-process MCP tools
INFO - 📡 aws → remote A2A subagent
INFO - ⏭️ Disabled agents: ['splunk']
INFO - ✅ 4 subagents initialized (2 remote, 2 local)
```
