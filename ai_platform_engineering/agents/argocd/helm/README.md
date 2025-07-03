# ArgoCD Agent Helm Chart

This Helm chart deploys the ArgoCD Agent powered by LangGraph and LangChain MCP Adapters on Kubernetes.

## Prerequisites

- [Minikube](https://minikube.sigs.k8s.io/docs/start/) installed
- [Helm](https://helm.sh/docs/intro/install/) installed
- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed

## Getting Started

### Step 1: Start Minikube

```bash
minikube start
```

Verify minikube is running:
```bash
minikube status
kubectl get nodes
```

### Step 2: Configure Secrets

Create a `values-secrets.yaml` file with your API keys and configuration. You can use the provided example as a template:

```bash
# Copy the example file
cp values-secrets.yaml.example values-secrets.yaml

# Edit with your actual values
vim values-secrets.yaml
```

Example `values-secrets.yaml` structure:

```yaml
# Values file with secrets for agent-argocd
# WARNING: This file contains sensitive information - do not commit to version control

secrets:
  llmProvider: "azure-openai"  # Options: azure-openai, openai, anthropic-claude
  
  # Azure OpenAI Configuration (if using Azure OpenAI)
  azureOpenaiApiKey: "your-azure-openai-api-key"
  azureOpenaiEndpoint: "https://your-resource.openai.azure.com/"
  azureOpenaiApiVersion: "2023-12-01-preview"
  azureOpenaiDeployment: "gpt-4"
  
  # OpenAI Configuration (if using OpenAI)
  # openaiApiKey: "your-openai-api-key"
  # openaiEndpoint: "https://api.openai.com/v1"
  # openaiModelName: "gpt-4"
  
  # Anthropic Configuration (if using Anthropic)
  # anthropicApiKey: "your-anthropic-api-key"
  # anthropicModelName: "claude-3-5-sonnet-20241022"
  
  # AWS/Bedrock Configuration (if using AWS Bedrock)
  # awsProfile: "default"
  # awsRegion: "us-east-1"
  # awsBedrockModelId: "anthropic.claude-3-sonnet-20240229-v1:0"
  # awsBedrockProvider: "anthropic"
  
  # Google/Vertex AI Configuration (if using Google)
  # googleApiKey: "your-google-api-key"
  # googleApplicationCredentials: "/path/to/service-account.json"
  # vertexaiModelName: "gemini-pro"
  
  # ArgoCD Configuration (Required)
  argocdToken: "your-argocd-jwt-token"
  argocdApiUrl: "https://your-argocd-instance.com"
  argocdVerifySsl: "true"

# Non-sensitive environment variables
env: {}
```

**⚠️ Important**: Never commit `values-secrets.yaml` to version control! It's already in `.gitignore`.

## Deployment Options

### Option 1: Simple Deployment (Port-Forward Access)

This is the simplest way to deploy and access your ArgoCD agent.

#### Deploy the Chart

```bash
# Ensure you're inside the chart dir
cd helm/agent-argocd
helm install agent-argocd . --values values-secrets.yaml
```

#### Check Deployment Status

```bash
kubectl get pods
kubectl get services
```

Wait for the pod to be in `Running` state and `1/1` ready.

#### Access the Application

Set up port forwarding:
```bash
kubectl port-forward service/agent-argocd 8080:8000
```

Your ArgoCD agent will be available at: `http://localhost:8080`

#### Using with Agent Chat CLI

```bash
# Install and use the agent chat CLI
uvx https://github.com/cnoe-io/agent-chat-cli.git a2a --host localhost --port 8080
```

---

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
# Ensure you're inside the chart dir
cd helm/agent-argocd
helm install agent-argocd . --values values-secrets.yaml
```

Or upgrade if already deployed:
```bash
helm upgrade agent-argocd . --values values-secrets.yaml
```

#### Configure Local DNS

Add the minikube IP to your `/etc/hosts` file:

```bash
# Get minikube IP
minikube ip

# Add to /etc/hosts (replace with your minikube IP)
echo "$(minikube ip) agent-argocd.local" | sudo tee -a /etc/hosts
```

#### Verify Ingress

```bash
kubectl get ingress
curl -i http://agent-argocd.local
```

You should see a `405 Method Not Allowed` response, which is expected (the agent only accepts POST requests).

#### Using with Agent Chat CLI

```bash
# Use the domain name instead of localhost
uvx https://github.com/cnoe-io/agent-chat-cli.git a2a --host agent-argocd.local --port 80
```

## Management Commands

### View Logs
```bash
kubectl logs -l app.kubernetes.io/name=agent-argocd
```

### Check Pod Status
```bash
kubectl get pods -l app.kubernetes.io/name=agent-argocd
```

### Update Secrets
1. Edit your `values-secrets.yaml` file
2. Upgrade the deployment:
   ```bash
   helm upgrade agent-argocd ./agent-argocd --values values-secrets.yaml
   ```

### Uninstall
```bash
helm uninstall agent-argocd
```

### Clean up /etc/hosts (if using ingress)
```bash
sudo sed -i '/agent-argocd.local/d' /etc/hosts
```

## Configuration

### Required Environment Variables
- `ARGOCD_TOKEN`: ArgoCD JWT token for API access
- `ARGOCD_API_URL`: ArgoCD API endpoint
- `ARGOCD_VERIFY_SSL`: SSL verification setting
- `LLM_PROVIDER`: The LLM provider to use
- Provider-specific API keys and configuration (see examples in `values-secrets.yaml.example`)

## Security Notes

- Always use Kubernetes secrets for sensitive data
- Never commit `values-secrets.yaml` to version control
- Rotate API keys regularly
- Use HTTPS in production environments
- Consider using external secret management solutions for production
