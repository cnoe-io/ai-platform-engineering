---
sidebar_position: 1
---

# Deploy CAIPE with Helm

This guide helps you deploy **CAIPE** (Community AI Platform Engineering) on any Kubernetes cluster using **Helm**. No prior experience with CAIPE is required.

**What is CAIPE?** CAIPE is an open-source platform for building and running **AI agents** that use tools, LLMs (e.g. Claude or GPT), and multi-agent orchestration. The Helm chart deploys the supervisor, UI, and optional agents (ArgoCD, GitHub, Backstage, RAG, etc.) on your cluster.

**When to use Helm:** Use this path when you already have a Kubernetes cluster (EKS, GKE, AKS, KinD, etc.) and want to install CAIPE from the official chart. For a one-command local setup, see [Run CAIPE with KinD](/getting-started/kind/setup) instead.

---

## Quickstart

No clone required. Run this in your terminal and follow the prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/setup-caipe.sh | bash
```

The interactive script will ask for your LLM provider, API key, optional components (RAG, tracing, persistence), and whether to create a Kind cluster or use an existing one. That's it.

> **Want to inspect the script first?** View it at [`setup-caipe.sh`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/setup-caipe.sh) before running.

---

## Step 1: Clone the repository (optional but recommended)

Cloning the repo gives you the chart source, examples, and EKS/config references:

```bash
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering
```

You can install the chart **directly from the OCI registry** (no clone required). Cloning is useful for customising values or using a values file from the repo.

---

## Step 2: Prerequisites

Before installing the chart, ensure you have:

| Requirement | Purpose |
|-------------|---------|
| **Kubernetes cluster** | Version 1.28 or higher (EKS, GKE, AKS, KinD, etc.) |
| **kubectl** | Configured to access your cluster (`kubectl get nodes` should work) |
| **Helm 3.x** | To install and upgrade the chart |
| **Credentials** | API keys and secrets for the agents you enable (see [Configure Agent Secrets](../eks/configure-agent-secrets)) |

You must **configure secrets before or right after** installing the chart so that agents can authenticate to external services. See [Configure Agent Secrets](../eks/configure-agent-secrets) for details.

---

## Step 3: Install the chart

The chart is published to **GitHub Container Registry (GHCR)**. You can install without cloning the repo.

**Chart version in this guide:** 0.2.32. For the **latest** chart version, see [GitHub Releases](https://github.com/cnoe-io/ai-platform-engineering/releases)—then replace `0.2.32` with the release tag (e.g. `0.2.33`) in the commands below.

### Basic installation (ArgoCD, Backstage, GitHub agents)

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.2.32 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.basic=true
```

### Complete profile (all agents)

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.2.32 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.complete=true
```

After installation, configure your [agent secrets](../eks/configure-agent-secrets) and LLM provider if you haven’t already. Then use `kubectl get pods -n ai-platform-engineering` to confirm pods are running.

---

## Step 4: Verify the deployment

```bash
# List Helm releases in the namespace
helm list -n ai-platform-engineering

# Check pod status
kubectl get pods -n ai-platform-engineering

# View logs for a specific agent (example: GitHub agent)
kubectl logs -n ai-platform-engineering -l app=agent-github
```

---

## Customising the deployment

The chart uses **tags** to enable or disable components. Two built-in profiles:

| Profile | Tag | What’s included |
|---------|-----|------------------|
| **Basic** | `tags.basic=true` | ArgoCD, Backstage, GitHub agents |
| **Complete** | `tags.complete=true` | All agents and RAG stack |

### Add specific agents

Combine the basic profile with extra agents:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.2.32 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.basic=true \
  --set-string tags.agent-pagerduty=true \
  --set-string tags.agent-aws=true
```

### Pick only the agents you need

Enable only the components you want (no basic/complete profile):

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.2.32 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.agent-backstage=true \
  --set-string tags.agent-slack=true \
  --set-string tags.rag-stack=true
```

**Note:** For the RAG stack use `tags.rag-stack=true`. For other agents use `tags.agent-<name>=true` (e.g. `tags.agent-github=true`). See [Chart components](#chart-components) for the full list.

### Use a values file

If you cloned the repo, you can create a `values.yaml` and install from it:

```yaml
# values.yaml
tags:
  basic: true
  agent-aws: true
```

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.2.32 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --values values.yaml
```

---

## Chart components

### Core components

| Component | Version | Description |
|-----------|---------|-------------|
| **supervisor-agent** | 0.1.1 | Multi-agent orchestration and coordination |
| **slim** | v0.1.8 | AGNTCY Slim dataplane service |
| **slim-control-plane** | v0.1.3 | AGNTCY Slim control plane |
| **rag-stack** | 0.0.1 | RAG (Retrieval-Augmented Generation) stack |
### Agent components

All agent subcharts use version **0.2.2**. Enable with `tags.agent-<name>=true` (or `tags.rag-stack=true` for RAG).

| Agent | Tag | Profiles | Description |
|-------|-----|----------|-------------|
| **agent-argocd** | `agent-argocd` | basic, complete | ArgoCD GitOps integration |
| **agent-aws** | `agent-aws` | complete | AWS cloud resource management |
| **agent-backstage** | `agent-backstage` | basic, complete | Backstage developer portal |
| **agent-confluence** | `agent-confluence` | complete | Confluence documentation |
| **agent-github** | `agent-github` | basic, complete | GitHub repos and workflows |
| **agent-jira** | `agent-jira` | complete | Jira issue tracking |
| **agent-komodor** | `agent-komodor` | complete | Komodor Kubernetes troubleshooting |
| **agent-pagerduty** | `agent-pagerduty` | complete | PagerDuty incidents |
| **agent-slack** | `agent-slack` | complete | Slack messaging |
| **agent-splunk** | `agent-splunk` | complete | Splunk log analytics |
| **agent-webex** | `agent-webex` | complete | Webex collaboration |
| **rag-stack** | `rag-stack` | complete | RAG knowledge base and embeddings |

---

## Other installation options

### Install from a local chart (after clone)

```bash
# From repo root
helm pull oci://ghcr.io/cnoe-io/charts/ai-platform-engineering --version 0.2.32

helm install ai-platform-engineering ai-platform-engineering-0.2.32.tgz \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.basic=true
```

### ArgoCD

To deploy the chart via ArgoCD, use an Application manifest. Example:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ai-platform-engineering
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  sources:
    - chart: ai-platform-engineering
      repoURL: ghcr.io/cnoe-io/charts
      targetRevision: 0.2.32
      helm:
        parameters:
          - name: tags.basic
            value: "true"
          - name: tags.agent-aws
            value: "true"
```

### Enable RAG stack only

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.2.32 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.rag-stack=true
```

---

## Troubleshooting

### Pods not starting

- Check resources: `kubectl describe pod <pod-name> -n ai-platform-engineering`
- Verify [secrets](../eks/configure-agent-secrets) are created and correct
- Confirm image pull permissions and cluster resource quotas

### Agent authentication failures

- Ensure required [agent secrets](../eks/configure-agent-secrets) exist for the agents you enabled
- Verify credentials are valid and have the right permissions

### Chart install or upgrade fails

- Ensure Kubernetes version is 1.28+
- Confirm namespace and RBAC allow the chart to create resources
- For local development, run `helm dependency update` in the chart directory if you are building from source

---

## Next steps

- [Configure Agent Secrets](../eks/configure-agent-secrets) — Create secrets for GitHub, ArgoCD, LLMs, etc.
- [Configure LLMs for EKS](../eks/configure-llms) — LLM provider and API keys
- [Run with KinD](/getting-started/kind/setup) — One-command local setup with `setup-caipe.sh`
- [Run with EKS](/getting-started/eks/setup) — Create an EKS cluster and deploy CAIPE
