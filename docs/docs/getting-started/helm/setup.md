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

## Cloud provider prerequisites (example: AWS / EKS)

If you don't have a cluster yet, use your cloud provider's managed Kubernetes service. The steps below use **Amazon EKS** as an example.

### Install tools

| Tool | Purpose |
|------|---------|
| **AWS CLI** | Authenticate to AWS ([install](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)) |
| **eksctl** | Create and manage EKS clusters ([install](https://eksctl.io/installation/)) |

### Configure AWS credentials

```bash
aws configure
aws sts get-caller-identity
export AWS_DEFAULT_REGION=us-east-2
```

### Create the cluster

```bash
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering
cp deploy/eks/dev-eks-cluster-config.yaml.example dev-eks-cluster-config.yaml

# Create the cluster (~10–15 minutes)
eksctl create cluster -f dev-eks-cluster-config.yaml

# Verify nodes are ready
kubectl get nodes
```

### (Recommended) Install AWS Load Balancer Controller

Required for LoadBalancer-type ingress on EKS:

```bash
eksctl create iamserviceaccount \
  --cluster=dev-eks-cluster \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --role-name AmazonEKSLoadBalancerControllerRole \
  --attach-policy-arn=arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess \
  --approve

helm repo add eks https://aws.github.io/eks-charts && helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=dev-eks-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

Once your cluster is ready, proceed with the Helm install below.

---

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
workloads. See [Configure Agent Secrets](../eks/configure-agent-secrets.md) and [Configure LLMs](../eks/configure-llms.md).

## Troubleshooting

- Check pod events: `kubectl describe pod <pod> -n ai-platform-engineering`
- Check generated manifests: `helm template ai-platform-engineering charts/ai-platform-engineering --values values.yaml`
- Confirm tags use `mcp-*` names and `tags.dynamic-agents=true`
- Confirm `tags.dynamic-agents=true` when Dynamic Agents should run in the cluster
