# Helm Setup Guide

This guide will help you deploy the AI Platform Engineering system using Helm charts.

## Overview

The [`ai-platform-engineering` Helm chart](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/ai-platform-engineering) is a parent chart that orchestrates the deployment of multiple agent subcharts, each representing different platform integrations. The chart supports flexible deployment configurations through tags, allowing you to deploy either a basic setup or a complete multi-agent system.

**Chart Version:** 0.3.0

## Prerequisites

Before installing the chart, ensure you have:

- Kubernetes cluster (version 1.28+)
- Helm 3.x installed
- `kubectl` configured to access your cluster
- Sufficient cluster resources for the agents you plan to deploy
- Required credentials for the integrations you plan to use (see [Configure Agent Secrets](../eks/configure-agent-secrets.md))

## Quick Start

**NOTE**: You need to configure your secrets before installing the chart. Refer to the [Configure Agent Secrets](../eks/configure-agent-secrets.md) guide for more details.

### Basic Installation

The basic installation includes the following sub-agents:
- ArgoCD
- Backstage
- GitHub

You can install directly from the OCI registry:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.basic=true
```

Or pull the chart first and install from the local file:

```bash
# Pull the chart
helm pull oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering --version 0.3.0

# Install from the downloaded file
helm install ai-platform-engineering ai-platform-engineering-0.3.0.tgz \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.basic=true
```

## Customise the deployment

The chart supports deployment profiles via tags and we have two default profiles currently available: basic and complete. You can customise the deployment by adding the tags you need.

### Basic Profile (ArgoCD, Backstage, GitHub sub-agents)

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.basic=true
```

### Complete Profile (All agents)

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.complete=true
```

### Customise the deployment

You can customise the sub-agents by adding the tags you need. For example, to install the basic profile as well as the PagerDuty and AWS sub-agents, you can run:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.basic=true \
  --set-string tags.agent-pagerduty=true \
  --set-string tags.agent-aws=true
```

Or if you prefer to entirely customise the deployment, you can do so by adding the tags you need in the format `tags.<agent-name>=true` (*Note*: for rag agent, use `tags.rag-stack=true`) e.g. if you only want to deploy Backstage, Slack and RAG sub-agents, you can run:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.agent-backstage=true \
  --set-string tags.agent-slack=true \
  --set-string tags.rag-stack=true
```

**Note:** Any sub-agent can be customised by adding the tags you need in the format `tags.agent-<agent-name>=true`. All available sub-agents are listed in the [Chart Components](#chart-components) section.

## Chart Components

The chart includes the following components:

### Core Components

| Component | Version | Description |
|-----------|---------|-------------|
| **supervisor-agent** | 0.1.1 | Multi-agent orchestration and coordination |
| **slim** | v0.1.8 | AGNTCY Slim dataplane service |
| **slim-control-plane** | v0.1.3 | AGNTCY Slim control plane |
| **rag-stack** | 0.0.1 | RAG (Retrieval-Augmented Generation) stack |
| **backstage-plugin-agent-forge** | 0.1.0 | Backstage plugin for agent management |

### Agent Components

All agent subcharts use version **0.2.2** and include:

| Agent | Tag | Profiles | Description |
|-------|-----|----------|-------------|
| **agent-argocd** | `agent-argocd` | basic, complete | ArgoCD integration for GitOps workflows |
| **agent-aws** | `agent-aws` | complete | AWS cloud resource management |
| **agent-backstage** | `agent-backstage` | basic, complete | Backstage developer portal integration |
| **agent-confluence** | `agent-confluence` | complete | Confluence documentation management |
| **agent-github** | `agent-github` | basic, complete | GitHub repository and workflow management |
| **agent-jira** | `agent-jira` | complete | Jira issue tracking integration |
| **agent-komodor** | `agent-komodor` | complete | Komodor Kubernetes troubleshooting |
| **agent-pagerduty** | `agent-pagerduty` | complete | PagerDuty incident management |
| **agent-slack** | `agent-slack` | complete | Slack messaging integration |
| **agent-splunk** | `agent-splunk` | complete | Splunk log analytics |
| **agent-webex** | `agent-webex` | complete | Webex collaboration |
| **rag-stack** | `rag-stack` | complete | RAG (Retrieval-Augmented Generation) stack |

## Other Installation Options

### ArgoCD

If you use ArgoCD to deploy the chart, you can also use the ArgoCD Application CRD to deploy the chart. Here is an example:

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
    # Main chart from GHCR
    - chart: ai-platform-engineering
      repoURL: ghcr.io/cnoe-io/helm-charts
      targetRevision: 0.3.0
      helm:
        parameters:
        - name: tags.basic # <--- enable basic agents
          value: "true"
        - name: tags.agent-aws # <--- enable AWS agent
          value: "true"
...
```

### Helm Values File

You can also use a Helm values file to deploy the chart instead of using the command line with `--set-string` flags. Here is an example:

```yaml
# values.yaml
tags:
  basic: true
  agent-aws: true
```

Then install with:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --values values.yaml
```

### Enable AGNTCY Slim

To enable the AGNTCY Slim dataplane service:

```bash
helm install ai-platform-engineering cnoe/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set global.slim.enabled=true
```

### Enable RAG Stack

To enable the RAG stack:

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.rag-stack=true
```

### Enable Backstage Agent Forge Plugin

Backstage Agent Forge plugin is a plugin for Backstage that allows you to manage your agents from Backstage. This includes the chatbot interface for the agents.

```bash
helm install ai-platform-engineering oci://ghcr.io/cnoe-io/helm-charts/ai-platform-engineering \
  --version 0.3.0 \
  --namespace ai-platform-engineering \
  --create-namespace \
  --set-string tags.backstage-agent-forge=true
```

## Troubleshooting

### Check Deployment Status

```bash
# List all releases
helm list -n ai-platform-engineering

# Check pod status
kubectl get pods -n ai-platform-engineering

# View logs for a specific agent
kubectl logs -n ai-platform-engineering -l app=agent-github
```

### Common Issues

**Pods not starting:**
- Check resource availability: `kubectl describe pod <pod-name> -n ai-platform-engineering`
- Verify secrets are configured correctly (see [Configure Agent Secrets](../eks/configure-agent-secrets.md))
- Check image pull permissions

**Agent authentication failures:**
- Ensure all required secrets are created (see [Configure Agent Secrets](../eks/configure-agent-secrets.md))
- Verify credentials are valid and have appropriate permissions

**Chart installation fails:**
- Run `helm dependency update` to ensure all dependencies are available
- Check Kubernetes version compatibility
- Verify namespace exists and has sufficient RBAC permissions
