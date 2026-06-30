---
sidebar_position: 1
---

# Deploy CAIPE with Helm

Use the Helm chart to run CAIPE on any Kubernetes cluster — EKS, GKE, AKS, KinD, or self-managed.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Kubernetes 1.28+ | Any distribution |
| `kubectl` | Configured against your cluster |
| Helm 3 | `helm version` |
| LLM credentials | OpenAI, Azure OpenAI, or AWS Bedrock |

---

## Cloud provider prerequisites (example: AWS / EKS)

If you don't have a cluster yet, use your cloud provider's managed Kubernetes service. The steps below use **Amazon EKS** as an example — skip to [Install](#install-from-oci) if you already have a cluster.

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

---

## Configure Secrets

Create the namespace and secrets before running the Helm install.

```bash
kubectl create namespace ai-platform-engineering
```

### LLM credentials

Pick the provider you're using:

**OpenAI**
```bash
kubectl create secret generic llm-secret \
  -n ai-platform-engineering \
  --from-literal=LLM_PROVIDER=openai \
  --from-literal=OPENAI_API_KEY=<token> \
  --from-literal=OPENAI_MODEL_NAME=gpt-4o
```

**Azure OpenAI**
```bash
kubectl create secret generic llm-secret \
  -n ai-platform-engineering \
  --from-literal=LLM_PROVIDER=azure-openai \
  --from-literal=AZURE_OPENAI_API_KEY=<token> \
  --from-literal=AZURE_OPENAI_ENDPOINT=https://example.openai.azure.com \
  --from-literal=AZURE_OPENAI_API_VERSION=2025-03-01-preview \
  --from-literal=AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

**AWS Bedrock**
```bash
kubectl create secret generic llm-secret \
  -n ai-platform-engineering \
  --from-literal=LLM_PROVIDER=aws-bedrock \
  --from-literal=AWS_ACCESS_KEY_ID=<access-key> \
  --from-literal=AWS_SECRET_ACCESS_KEY=<secret-key> \
  --from-literal=AWS_REGION=us-east-1 \
  --from-literal=AWS_BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0 \
  --from-literal=AWS_BEDROCK_PROVIDER=amazon
```

### MCP server credentials

Create only the secrets for MCP servers you plan to enable:

```bash
kubectl create secret generic github-secret \
  -n ai-platform-engineering \
  --from-literal=GITHUB_PERSONAL_ACCESS_TOKEN=<token>

kubectl create secret generic argocd-secret \
  -n ai-platform-engineering \
  --from-literal=ARGOCD_TOKEN=<token> \
  --from-literal=ARGOCD_API_URL=https://argocd.example.com \
  --from-literal=ARGOCD_VERIFY_SSL=true
```

---

## Install from OCI

Set the chart version:

```bash
export CAIPE_VERSION=<release-version>
```

Minimal install — UI, Dynamic Agents, MongoDB, and a starter MCP server:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version "${CAIPE_VERSION}" \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.caipe-ui=true \
  --set-string tags.dynamic-agents=true \
  --set-string tags.mcp-netutils=true
```

With GitHub, ArgoCD, and RAG:

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

### Values file

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

# Optional: pre-seed model choices in the UI
caipe-ui:
  appConfig:
    models:
      - model_id: gpt-4o
        name: GPT-4o
        provider: openai
        enabled: true
```

```bash
helm upgrade --install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version "${CAIPE_VERSION}" \
  --namespace ai-platform-engineering \
  --create-namespace \
  --values values.yaml
```

---

## Chart Components

| Component | Tag | Purpose |
|-----------|-----|---------|
| CAIPE UI | `tags.caipe-ui=true` | Web UI and BFF API |
| Dynamic Agents | `tags.dynamic-agents=true` | Chat, custom agents, workflows, checkpointed state |
| MCP servers | `tags.mcp-<name>=true` | Tool integrations exposed to agents |
| RAG stack | `tags.rag-stack=true` | Knowledge base and embeddings |
| Slack bot | `tags.slack-bot=true` | Slack integration |
| Webex bot | `tags.webex-bot=true` | Webex integration |

Available MCP tags: `mcp-argocd`, `mcp-aws`, `mcp-backstage`, `mcp-confluence`, `mcp-github`, `mcp-gitlab`, `mcp-jira`, `mcp-komodor`, `mcp-pagerduty`, `mcp-slack`, `mcp-splunk`, `mcp-victorops`, `mcp-webex`, `mcp-netutils`.

---

## Verify

```bash
helm list -n ai-platform-engineering
kubectl get pods -n ai-platform-engineering
kubectl logs -n ai-platform-engineering -l app.kubernetes.io/name=dynamic-agents
```

---

## Troubleshooting

- **Pods not starting**: `kubectl describe pod <pod> -n ai-platform-engineering`
- **Check rendered manifests**: `helm template ai-platform-engineering charts/ai-platform-engineering --values values.yaml`
- Ensure `tags.dynamic-agents=true` is set when Dynamic Agents should run
- MCP tag names use `mcp-*` prefix (e.g. `tags.mcp-github=true`)
