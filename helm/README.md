# AI Platform Engineering Helm Chart

This Helm chart deploys AI Platform Engineering agents powered by LangGraph and LangChain MCP Adapters on Kubernetes.

## Prerequisites

- [Helm](https://helm.sh/docs/intro/install/) installed
- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed

**Recommended:**

- [Minikube](https://minikube.sigs.k8s.io/docs/start/) installed
- Or an existing Kubernetes cluster ready for deployment

## Getting Started

We'll walk through the steps to deploy on a Minikube cluster locally, but you can also follow these steps to deploy on your existing cluster. If using an existing cluster, skip to Step 2.

### Step 1: Start Minikube

```bash
minikube start
```

Verify Minikube is running:
```bash
minikube status
kubectl get nodes
```

### Step 2: Configure Secrets

#### Option 1: Directly Configure Secrets

| 💡 **Tip** |
|:---|
| For production deployments, we strongly recommend using external secrets management. |

Create a `values-secrets.yaml` file with your API keys and configuration. You can use the provided example as a template:

```bash
# Copy the example file
cp values-secrets.yaml.example values-secrets.yaml

# Edit with your actual values
vim values-secrets.yaml
```

Fill in the file with your preferred LLM provider configuration and add details for the agents you want to enable.

**⚠️ Important**: Never commit `values-secrets.yaml` to version control! It's already in `.gitignore`.

#### Option 2: Use Existing Secrets

If you already have existing Kubernetes secrets that contains required secrets (you can check this in `values-secrets.yaml.example`), add the secrets names in `values.yaml` for each agent e.g.
```yaml
agent-argocd:
  enabled: true
  nameOverride: "agent-argocd"
  image:
    repository: "ghcr.io/cnoe-io/agent-argocd"
  secrets:
    secretName: "<YOUR EXISTING SECRET NAME>" <- fill this in
```

#### Option 3 [Recommended]: Use External Secrets Management

You can use our `external-secrets-configuration` included in this chart. You can use the provided example as a template:
```bash
cp values-external-secrets.yaml.example values-external-secrets.yaml
```
and modify to work with your preferred secret store.

## Deployment Options

### Option 1: Simple Deployment (Port-Forward Access)

This is the simplest way to deploy and access your ArgoCD agent.

#### Deploy the Chart

```bash
# Option 1: Using directly configured secrets
helm install ai-platform-engineering . --values values-secrets.yaml
# Option 2: Using existing kubernetes secrets (only requires default values.yaml)
helm install ai-platform-engineering .
# Option 3: Using external secrets management
helm install ai-platform-engineering . --values values-external-secrets.yaml
```

#### Check Deployment Status

```bash
kubectl get pods
kubectl get services
```

Wait for the pod to be in `Running` state and `1/1` ready.

#### Access the Application

Set up port forwarding for each running agents:
```bash
kubectl port-forward service/ai-platform-engineering-agent-<agent-type> <your local port>:8000
```

Your agents will be available at: `http://localhost:<your local port>`

#### Using with Agent Chat CLI

```bash
# Install and use the agent chat CLI
uvx https://github.com/cnoe-io/agent-chat-cli.git a2a --host localhost --port <your local port>
```

### Option 2: Ingress Deployment (Domain Access)

This option sets up ingress for cleaner access via a domain name.

#### Enable Minikube Ingress

```bash
minikube addons enable ingress
```

Wait for the ingress controller to be ready:
```bash
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=300s
```

#### Create Ingress Values File

Enable ingress in `values.yaml`:

```yaml
ingress:
  enabled: true
```

#### Deploy with Ingress

```bash
helm install ai-platform-engineering . --values <existing values file for your secret> --values values-ingress.yaml
```

Or upgrade if already deployed:
```bash
helm upgrade ai-platform-engineering . --values <existing values file for your secret> --values values-ingress.yaml
```

#### Configure Local DNS

Add the minikube IP to your `/etc/hosts` file:

```bash
# Get minikube IP
minikube ip

# Add to /etc/hosts (replace with your minikube IP)
echo "$(minikube ip) agent-<your agent>.local" | sudo tee -a /etc/hosts
```

#### Verify Ingress

```bash
kubectl get ingress
curl -i http://agent-<your agent>.local
```

You should see a `405 Method Not Allowed` response, which is expected (the agent only accepts POST requests).

#### Using with Agent Chat CLI

```bash
# Use the domain name instead of localhost
uvx https://github.com/cnoe-io/agent-chat-cli.git a2a --host agent-pagerduty.local --port 80
```

### Uninstall
```bash
helm uninstall ai-platform-engineering
```

### Clean up /etc/hosts (if using ingress)
```bash
sudo sed -i '/agent-<your agent>.local/d' /etc/hosts
```

## Security Notes

- Always use Kubernetes secrets for sensitive data
- Never commit `values-secrets.yaml` to version control
- Rotate API keys regularly
- Use HTTPS in production environments
- Consider using external secret management solutions for production
