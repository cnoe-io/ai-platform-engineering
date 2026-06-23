# Run with IDPBuilder

[IDPBuilder](https://cnoe.io/docs/idpbuilder) creates local Internal Developer
Platform environments on Kind clusters. Use this path when you want CAIPE
alongside platform components such as ArgoCD, Backstage, Vault, and Keycloak.

## Prerequisites

- Docker
- `kubectl`
- `idpbuilder`

## Current CAIPE Runtime

The current CAIPE stack centers on:

- CAIPE UI / BFF
- Dynamic Agents
- MCP servers
- MongoDB
- Keycloak and OpenFGA for local RBAC
- Optional RAG and tracing services

## Install

Use the stack package maintained for your environment. The package should enable
the CAIPE Helm chart with `tags.caipe-ui=true`, `tags.dynamic-agents=true`, and
the `tags.mcp-*` entries for the MCP servers you need.

Example shape:

```bash
idpbuilder create \
  --use-path-routing \
  --package stacks/ref-implementation \
  --package stacks/caipe/base \
  --package stacks/caipe/complete
```

After the cluster is ready:

```bash
kubectl get pods -n caipe
kubectl get applications -n argocd
```

## Configure Secrets

Provide the shared LLM secret and MCP-specific credentials through the stack's
secret management path, usually External Secrets:

```yaml
global:
  llmSecrets:
    secretName: llm-secret

mcp-github:
  agentSecrets:
    secretName: github-secret
```

See [Configure Agent Secrets](../eks/configure-agent-secrets.md) and
[Configure LLMs](../eks/configure-llms.md) for the Kubernetes secret contract.

## Access

Use the hostnames and path-routing rules printed by IDPBuilder. When debugging,
check:

```bash
kubectl get ingress -A
kubectl logs -n caipe -l app.kubernetes.io/name=caipe-ui
kubectl logs -n caipe -l app.kubernetes.io/name=dynamic-agents
```
