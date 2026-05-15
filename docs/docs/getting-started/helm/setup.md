---
sidebar_position: 1
---

# Deploy CAIPE with Helm

Use the Helm chart when you already have a Kubernetes cluster and want to run
CAIPE from released images or from a checked-out chart.

## Prerequisites

- Kubernetes 1.28+
- `kubectl`
- Helm 3
- LLM credentials
- Credentials for any MCP servers you enable

## Install From OCI

Set the chart version you want to install:

```bash
export CAIPE_VERSION=<release-version>
```

Install the UI, Dynamic Agents, MongoDB, RBAC runtime, and a starter MCP server:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version "${CAIPE_VERSION}" \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.caipe-ui=true \
  --set-string tags.dynamic-agents=true \
  --set-string tags.mcp-netutils=true
```

Add RAG or more MCP servers with tags:

```bash
helm upgrade --install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version "${CAIPE_VERSION}" \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.caipe-ui=true \
  --set-string tags.dynamic-agents=true \
  --set-string tags.mcp-github=true \
  --set-string tags.mcp-argocd=true \
  --set-string tags.rag-stack=true
```

## Values File

```yaml
tags:
  caipe-ui: true
  dynamic-agents: true
  mcp-github: true
  rag-stack: true

global:
  llmSecrets:
    secretName: llm-secret

mcp-github:
  agentSecrets:
    secretName: github-secret
```

```bash
helm upgrade --install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version "${CAIPE_VERSION}" \
  --namespace ai-platform-engineering \
  --create-namespace \
  --values values.yaml
```

## Verify

```bash
helm list -n ai-platform-engineering
kubectl get pods -n ai-platform-engineering
kubectl logs -n ai-platform-engineering -l app.kubernetes.io/name=dynamic-agents
kubectl logs -n ai-platform-engineering -l app.kubernetes.io/name=mcp-server
```

---

## Node autoscaling with Karpenter

For production clusters, Karpenter provisions right-sized nodes on demand and consolidates them when idle, no pre-created node groups required. CAIPE ships with two custom `NodePool` tiers:

| NodePool | Workloads | Instance strategy |
|---|---|---|
| `agents` | All `agent-*` subcharts | Spot-preferred, compute-optimised |
| `rag` | `rag-server`, `agent-ontology`, `neo4j`, `milvus` | On-demand, memory-optimised |

Workloads not matching either tier (supervisor, UI, Redis) will land on the cluster's default pool.

### EKS (supported)

EKS Auto Mode runs Karpenter as a managed service, so no separate install is needed.

1. Apply the NodePool manifests (requires a cloned repo):

   ```bash
   kubectl apply -f deploy/eks/karpenter/
   ```

2. Add the Karpenter values overlay when deploying the chart:

   ```bash
   helm upgrade --install ai-platform-engineering \
     oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
     --namespace ai-platform-engineering \
     --create-namespace \
     --set-string tags.complete=true \
     -f charts/ai-platform-engineering/values-karpenter.yaml
   ```

See [`deploy/eks/karpenter/README.md`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/deploy/eks/karpenter/README.md) for verification and troubleshooting steps, and the [EKS getting-started guide](../eks/setup) for full cluster setup.

### kind / local clusters

Karpenter requires a provider that can provision new VMs and does not apply to kind clusters. For local development, size your kind cluster nodes statically. If you need per-workload resource right-sizing, consider [VPA (Vertical Pod Autoscaler)](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler) against the fixed node pool.

---

## Chart Components

| Component | Enable with | Purpose |
|-----------|-------------|---------|
| CAIPE UI | `tags.caipe-ui=true` | Web UI and BFF API |
| Dynamic Agents | `tags.dynamic-agents=true` | Chat, custom agents, workflows, and checkpointed agent state |
| MCP servers | `tags.mcp-<name>=true` | Tool integrations exposed to Dynamic Agents |
| RAG stack | `tags.rag-stack=true` | Knowledge base and embeddings services |
| Slack bot | `tags.slack-bot=true` | Slack integration surface |
| Webex bot | `tags.webex-bot=true` | Webex integration surface |

Common MCP tags include `mcp-argocd`, `mcp-aws`, `mcp-backstage`,
`mcp-confluence`, `mcp-github`, `mcp-gitlab`, `mcp-jira`, `mcp-komodor`,
`mcp-pagerduty`, `mcp-slack`, `mcp-splunk`, `mcp-victorops`, `mcp-webex`, and
`mcp-netutils`.

## Secrets

Create the LLM secret and any MCP credentials before enabling dependent
workloads. See [Configure Agent Secrets](../eks/configure-agent-secrets.md) and
[Configure LLMs](../eks/configure-llms.md).

## Troubleshooting

- Check pod events: `kubectl describe pod <pod> -n ai-platform-engineering`
- Check generated manifests: `helm template ai-platform-engineering charts/ai-platform-engineering --values values.yaml`
- Confirm tags use `mcp-*` names and `tags.dynamic-agents=true`
- Confirm `tags.dynamic-agents=true` when Dynamic Agents should run in the cluster
