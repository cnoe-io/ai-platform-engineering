---
sidebar_position: 3
---

# Deploy CAIPE on EKS

This guide shows how to deploy the ai-platform-engineering helm chart to your EKS cluster using ArgoCD.

**Prerequisites**: Ensure you have completed the previous sections:
- ArgoCD is deployed on your cluster
- Agent secrets are configured

## Step 1: Create ArgoCD Application

Copy the ArgoCD application template:

```bash
cp deploy/eks/argocd-application.yaml.example argocd-application.yaml
```

## Step 2: Configure Your Deployment

Create a new branch to customize your deployment configuration. You can see an example at [example-argocd-deploy-values branch](https://github.com/cnoe-io/ai-platform-engineering/compare/main...example-argocd-deploy-values).

### Enable Desired Agents

Edit `helm/values.yaml` to enable the agents you want to deploy:

```diff
# Agent configurations
agent-argocd:
-  enabled: false
+  enabled: true
   nameOverride: "agent-argocd"
   image:
     repository: "ghcr.io/cnoe-io/agent-argocd"

agent-pagerduty:
-  enabled: false
+  enabled: true
   nameOverride: "agent-pagerduty"
   image:
     repository: "ghcr.io/cnoe-io/agent-pagerduty"

agent-github:
   enabled: false  # Only enable what you need

# ... configure other agents as needed
```

### Configure Agent Communication Transport

:::note
This section is optional and the chart is configured to use peer-to-peer communication by default. Skip if you do not want to use SLIM.
:::

Choose between peer-to-peer (default) or centralized communication via [AGNTCY Secure Low-Latency Interactive Messaging (SLIM)](https://docs.agntcy.org/messaging/slim-core/). This configuration affects how agents communicate with each other during multi-agent workflows.

#### Option 1: Peer-to-Peer Communication (Default)

Direct agent-to-agent communication using the a2a (agent-to-agent) protocol:

```yaml
# Default configuration in helm/values.yaml
global:
  slim:
    enabled: false  # Peer-to-peer is default

ai-platform-engineering:
  multiAgentConfig:
    protocol: "a2a"
```

**Characteristics:**
- **Latency**: Lower latency for direct agent interactions
- **Architecture**: Distributed, no central coordination point
- **Network**: Requires mesh connectivity between agents

#### Option 2: Centralized Communication via Agntcy Slim

Centralized communication through the agntcy slim transport layer:

```yaml
# Enable slim transport in helm/values.yaml
global:
  slim:
    enabled: true
    endpoint: "http://ai-platform-engineering-slim:46357"
    transport: "slim"

ai-platform-engineering:
  multiAgentConfig:
    protocol: "a2a"  # Still uses a2a but routes through slim
```

**Characteristics:**
- **Coordination**: Centralized message routing and coordination
- **Network**: Simplified network topology (hub-and-spoke)
- **Overhead**: Additional hop introduces minimal latency

## Step 3: Configure Secret Management

Choose one of the following approaches based on how you've set up your secrets in the [Configure Agent Secrets](./configure-agent-secrets.md) section.

### Option A: Using Manual Secrets

If you created secrets manually in the previous step, edit `helm/values-existing-secrets.yaml` to reference your secret names:

```diff
# Secret for your global LLM provider
global:
  secrets:
-    secretName: ""
+    secretName: "llm-secret"

# Agent specific secrets
agent-argocd:
  secrets:
-    secretName: ""
+    secretName: "argocd-secret"

agent-pagerduty:
  secrets:
-    secretName: ""
+    secretName: "pagerduty-secret"

# ... configure other agent secrets as needed
```

### Option B: Using External Secrets

If you're using external secret management (e.g., AWS Secrets Manager, HashiCorp Vault):

```bash
cp helm/values-external-secrets.yaml.example helm/values-external-secrets.yaml
```

Then edit the file to configure your external secret management solution with the appropriate providers and secret references.

## Step 3: Update ArgoCD Application

Edit your `argocd-application.yaml` file:

### Set Target Branch
```yaml
    - repoURL: https://github.com/cnoe-io/ai-platform-engineering.git
      targetRevision: <YOUR BRANCH NAME>  # Replace with your branch name
      ref: values
```

### Set Chart Version
Find the current chart version in `helm/Chart.yaml` and update:
```yaml
  sources:
    # Main chart from GHCR
    - chart: ai-platform-engineering
      repoURL: ghcr.io/cnoe-io/helm-charts
      targetRevision: <CHART VERSION>  # Replace with your chart version
```

## Step 4: Commit and Push Changes

```bash
git add .
git commit -m "Configure ai-platform-engineering deployment"
git push origin your-branch-name
```

## Step 5: Deploy with ArgoCD

Apply the ArgoCD application:

```bash
kubectl apply -f argocd-application.yaml
```

## Step 6: Verify Deployment

Check the ArgoCD UI or use kubectl to verify your deployment:

```bash
# Check ArgoCD applications
kubectl get applications -n argocd

# Check deployed pods
kubectl get pods -n ai-platform-engineering

# Check application sync status
kubectl describe application ai-platform-engineering -n argocd
```

## Troubleshooting

- **Application not syncing**: Check that your branch name and chart version are correct in the ArgoCD application
- **Pods not starting**: Verify that all required secrets are created and contain valid values
- **Agent connection issues**: Check the logs of individual agent pods for authentication or configuration errors