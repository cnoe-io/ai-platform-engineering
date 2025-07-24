# Run with IDPBuilder 🏗️ 💻

[IDPBuilder](https://cnoe.io/docs/intro/idpbuilder) is a tool for creating local Internal Developer Platform environments using KIND clusters. It provides a fast way to deploy and test platform components including ArgoCD, Vault, Backstage, and AI Platform Engineering agents.

## Prerequisites

- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed
- [IDPBuilder](https://cnoe.io/docs/reference-implementation/idpbuilder) binary installed

## Section Outline

1. Create KIND Cluster with IDPBuilder
2. Access ArgoCD and Monitor Deployments
3. Configure Vault Secrets
4. Access Backstage Portal
5. Use AI Platform Engineering Agent

## Create KIND Cluster with IDPBuilder

### Step 1: Create the Platform

```bash
# Create cluster with reference implementation + lightweight AI stack
idpbuilder create \
  --use-path-routing \
  --package https://github.com/cnoe-io/stacks//ref-implementation \
  --package https://github.com/suwhang-cisco/stacks//ai-platform-engineering
```

This command will:
* Create a KIND cluster
* Install core platform components
* Deploy ArgoCD, Vault, and Backstage
* Configure ingress with path-based routing

This takes around 5-10 minutes. Feel free to grab a coffee while it's deploying :coffee:

### Step 2: Verify Cluster

```bash
# Check cluster status
kubectl get nodes

# Verify all pods are running
kubectl get pods --all-namespaces

# Check ingress configuration
kubectl get ingress --all-namespaces
```

## Access ArgoCD and Monitor Deployments

Once the cluster is created, IDPBuilder outputs the ArgoCD URL.

### Step 1: Get ArgoCD Credentials

```bash
# Get admin password
idpbuilder get secrets -p argocd
```

### Step 2: Access ArgoCD

Open https://cnoe.localtest.me:8443/argocd/ and login with:
- Username: `admin`
- Password: From the command above

Monitor application sync status. Initial synchronization takes 3-5 minutes.

## Configure Vault Secrets

After Vault application syncs on ArgoCD successfully:

### Step 1: Get Vault Token

```bash
# Extract root token
kubectl get secret vault-root-token -n vault -o jsonpath="{.data}" | \
  jq -r 'to_entries[] | "\(.key): \(.value | @base64d)"'
```

### Step 2: Access Vault

Open https://vault.cnoe.localtest.me:8443/. When you are asked to log in to the Vault UI, use the root token from the previous step.


### Step 3: Update Secrets

1. Navigate to `secrets/ai-platform-engineering` in Vault UI: https://vault.cnoe.localtest.me:8443/ui/vault/secrets/secret/kv/list/ai-platform-engineering/
2. Populate the secrets for the agents you're using. You are required to fill in `global` secret as this contains the LLM secrets that are shared across all agents.
3. Force secret refresh:

```bash
# Refresh secrets
kubectl delete secret --all -n ai-platform-engineering
# Once new secrets are created, delete pods to pick up new secrets
kubectl delete pod --all -n ai-platform-engineering
```

## Access Backstage Portal

### Step 1: Get Backstage Credentials

```bash
# Get user1 password
idpbuilder get secrets | grep USER_PASSWORD | sed 's/.*USER_PASSWORD=\([^,]*\).*/\1/'
```

### Step 2: Login to Backstage

Open https://cnoe.localtest.me:8443/ and login with:
- Username: `user1`
- Password: From Step 1 above

## Use AI Platform Engineering Agent

Once logged into Backstage:

1. Look for the agent icon in the bottom-right corner
2. Click to open the AI assistant
3. Start chatting with the platform engineering agent

## Cleanup

```bash
# Destroy the cluster and all resources
kind delete cluster --name localdev
```
