---
sidebar_position: 2
---

# Configure Agent Secrets for EKS Cluster

The ai-platform-engineering helm chart supports two approaches for managing agent secrets:

- **[Manual Secret Creation](#manual-secret-creation)** - Create Kubernetes secrets directly on the cluster
- **[External Secrets Management](#external-secrets-management)** - Use external secret management solutions for production environments

## Manual Secret Creation

### Step 1: Copy Secret Examples

Copy the secret example files from the `secrets-examples` directory to `data` directory, removing the `.example` extension:

```bash
# Copy all example files without the .example extension
for file in ai-platform-engineering/deploy/secrets-examples/*.yaml.example; do
  cp "$file" "ai-platform-engineering/deploy/data/$(basename "$file" .example)"
done
```

### Step 2: Configure Your Secrets

Edit the secret files in the `data` directory and fill in the plain text values for the secrets you want to use e.g.

```bash
# Edit global secrets for LLM provider configuration
vim ai-platform-engineering/deploy/data/llm-secret.yaml

# Example: Edit GitHub token
vim ai-platform-engineering/deploy/data/github-secret.yaml
# ... edit other secret files as needed
```

**Note**: The `llm-secret` is required and shared by all agents. Configure additional secrets only for the agents you want to deploy.

### Step 3: Apply the Secrets

Before applying the secrets, ensure the namespace exists:

```bash
kubectl create namespace ai-platform-engineering
```

Create the secret resources on your cluster:

```bash
# Apply all configured secrets
kubectl apply -f ai-platform-engineering/deploy/data/

# Or apply individual secrets as needed:
kubectl apply -f ai-platform-engineering/deploy/data/llm-secret.yaml
kubectl apply -f ai-platform-engineering/deploy/data/github-secret.yaml
# ... apply other secrets as needed
```

### Step 4: Verify Secrets

Verify that your secrets were created successfully:

```bash
# List all secrets in the namespace
kubectl get secrets -n ai-platform-engineering

# Check a specific secret
kubectl describe secret llm-secret -n ai-platform-engineering
```

## External Secrets Management

For production environments, it's recommended to use external secret management solutions instead of storing secrets directly in Kubernetes. The ai-platform-engineering helm chart integrates with the [External Secrets Operator](https://external-secrets.io/) to sync secrets from external providers like:

- **HashiCorp Vault**
- **AWS Secrets Manager**
- **Azure Key Vault**
- **Google Secret Manager**

### Prerequisites

1. **Install External Secrets Operator** in your cluster:
   ```bash
   helm repo add external-secrets https://charts.external-secrets.io
   helm install external-secrets external-secrets/external-secrets -n external-secrets-system --create-namespace
   ```

2. **Configure a SecretStore or ClusterSecretStore** that connects to your secret backend (e.g., Vault, AWS Secrets Manager). Refer to the [External Secrets Operator documentation](https://external-secrets.io/latest/provider/aws-secrets-manager/) for provider-specific setup.

### Global Configuration

Enable external secrets globally in your `values.yaml`:

```yaml
global:
  externalSecrets:
    enabled: true
    secretStoreRef:            # this is the secret store used for all sub-agent secrets
      name: "vault-store"      # Name of your SecretStore or ClusterSecretStore
      kind: ClusterSecretStore # Or SecretStore for namespace-scoped

    agentSecrets:
      create: true             # enable sub-agent secrets creation globally using external secrets
```

### Configuring LLM Secrets with External Secrets

The LLM secret is required by all agents and should be configured globally:

```yaml
global:                          # Put this under the same global section as above
  llmSecrets:
    create: false                # Only create LLM secret in the parent chart and use the same secret in subcharts
    secretName: "llm-secret"
    externalSecrets:
      secretStoreRef:
        name: "vault-store"      # this is the secret store used for the LLM secret
        kind: ClusterSecretStore # Or SecretStore for namespace-scoped
      data:
      - secretKey: LLM_PROVIDER
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: projects/your-project/llm-provider
          property: LLM_PROVIDER

      # Azure OpenAI configuration
      - secretKey: AZURE_OPENAI_API_KEY
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AZURE_OPENAI_API_KEY
      - secretKey: AZURE_OPENAI_ENDPOINT
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AZURE_OPENAI_ENDPOINT
      - secretKey: AZURE_OPENAI_API_VERSION
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AZURE_OPENAI_API_VERSION
      - secretKey: OPENAI_API_VERSION
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AZURE_OPENAI_API_VERSION
      - secretKey: AZURE_OPENAI_DEPLOYMENT
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AZURE_OPENAI_DEPLOYMENT
      # OpenAI configuration
      - secretKey: OPENAI_API_KEY
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: OPENAI_API_KEY
      - secretKey: OPENAI_ENDPOINT
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: OPENAI_ENDPOINT
      - secretKey: OPENAI_MODEL_NAME
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: OPENAI_MODEL_NAME
      # AWS Bedrock configuration
      - secretKey: AWS_ACCESS_KEY_ID
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AWS_ACCESS_KEY_ID
      - secretKey: AWS_SECRET_ACCESS_KEY
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AWS_SECRET_ACCESS_KEY
      - secretKey: AWS_REGION
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AWS_REGION
      - secretKey: AWS_BEDROCK_MODEL_ID
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AWS_BEDROCK_MODEL_ID
      - secretKey: AWS_BEDROCK_PROVIDER
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: secret/ai-platform-engineering/global
          property: AWS_BEDROCK_PROVIDER
```

**NOTE**: You can delete the keys of the providers you don't need. Supported `LLM_PROVIDER` values are: `azure-openai`, `openai`, `aws-bedrock`.

#### External Secret Configuration Fields

- `secretKey`: The key name in the Kubernetes secret
- `remoteRef.key`: Path to the secret in your external secret store
- `remoteRef.property`: Specific property/field within the secret
- `conversionStrategy`: How to convert the secret value (Default, Unicode, Base64, etc.)
- `decodingStrategy`: How to decode the secret value (None, Base64, Auto, etc.)

### Configuring Agent-Specific Secrets

Now configure external secrets for individual agents:

#### Example: ArgoCD Agent

```yaml
agent-argocd:
  agentSecrets:
    secretName: "agent-argocd-secret"
    externalSecrets:
      data:
      - secretKey: ARGOCD_TOKEN
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: projects/your-project/argocd
          property: ARGOCD_TOKEN

      - secretKey: ARGOCD_API_URL
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: projects/your-project/argocd
          property: ARGOCD_API_URL

      - secretKey: ARGOCD_VERIFY_SSL
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: projects/your-project/argocd
          property: ARGOCD_VERIFY_SSL
```

#### Example: GitHub Agent

```yaml
agent-github:
  agentSecrets:
    secretName: "agent-github-secret"
    externalSecrets:
      data:
      - secretKey: GITHUB_PERSONAL_ACCESS_TOKEN
        remoteRef:
          conversionStrategy: Default
          decodingStrategy: None
          key: projects/your-project/github
          property: GITHUB_PERSONAL_ACCESS_TOKEN
```

You can find the required secret keys for each agent in the [repo's .env.example file](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.env.example).

### Organizing Secrets in Your Secret Store

It's recommended to organize your secrets hierarchically in your external secret store:

```
projects/
  └── your-project/
      ├── llm-provider          # LLM configuration
      ├── azure-openai          # Azure OpenAI credentials
      ├── argocd                # ArgoCD credentials
      ├── github                # GitHub credentials
      ├── slack                 # Slack credentials
      ├── aws                   # AWS credentials
      ├── atlassian             # Shared for Jira & Confluence
      ├── pagerduty             # PagerDuty credentials
      └── ...                   # Other agent credentials
```

### Troubleshooting

If secrets are not syncing properly:

1. **Check ExternalSecret status**:
   ```bash
   kubectl get externalsecret -n ai-platform-engineering
   ```

2. **Check ExternalSecret events**:
   ```bash
   kubectl describe externalsecret <secret-name> -n ai-platform-engineering
   ```

3. **Verify SecretStore connectivity**:
   ```bash
   kubectl get secretstore -n ai-platform-engineering
   kubectl get clustersecretstore
   ```

4. **Check External Secrets Operator logs**:
   ```bash
   kubectl logs -n external-secrets-system -l app.kubernetes.io/name=external-secrets
   ```
