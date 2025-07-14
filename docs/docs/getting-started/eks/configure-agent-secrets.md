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

🚧 This section is still under construction 🚧

For production environments, consider using external secret management solutions like:
- AWS Secrets Manager with External Secrets Operator
- HashiCorp Vault
- Azure Key Vault
- Google Secret Manager

Refer to the [External Secrets Operator documentation](https://external-secrets.io/) for more information on setting up external secret management.