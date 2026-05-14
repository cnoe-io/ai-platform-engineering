# Manual Vault Secret Setup

If you prefer to configure secrets manually instead of using the automated script:

### Get Vault Token

```bash
# Extract root token
kubectl get secret vault-root-token -n vault -o jsonpath="{.data}" | \
  jq -r 'to_entries[] | "\(.key): \(.value | @base64d)"'
```

### Access Vault UI

Open https://vault.cnoe.localtest.me:8443/. When you are asked to log in to the Vault UI, use the root token from the previous step.

### Configure Global LLM Settings

Navigate to `secrets/ai-platform-engineering` in Vault UI: https://vault.cnoe.localtest.me:8443/ui/vault/secrets/secret/kv/list/ai-platform-engineering/

The `global` secret is required and contains LLM provider configuration shared across all agents:

**For Azure OpenAI (`azure-openai`):**
```yaml
LLM_PROVIDER: "azure-openai"
AZURE_OPENAI_API_KEY: <your-api-key>
AZURE_OPENAI_ENDPOINT: <your-endpoint>
AZURE_OPENAI_API_VERSION: <your-api-version>
AZURE_OPENAI_DEPLOYMENT: <your-deployment-name>
```

**For OpenAI (`openai`):**
```yaml
LLM_PROVIDER: "openai"
OPENAI_API_KEY: <your-api-key>
OPENAI_ENDPOINT: <your-endpoint>
OPENAI_MODEL_NAME: <your-model-name>
```

**For AWS Bedrock (`aws-bedrock`):**
```yaml
LLM_PROVIDER: "aws-bedrock"
AWS_ACCESS_KEY_ID: <your-access-key>
AWS_SECRET_ACCESS_KEY: <your-secret-key>
AWS_REGION: <your-region>
AWS_BEDROCK_MODEL_ID: <your-model-id>
AWS_BEDROCK_PROVIDER: <your-provider>
```

**For Google Gemini (`google-gemini`):**
```yaml
LLM_PROVIDER: "google-gemini"
GOOGLE_API_KEY: <your-api-key>
GOOGLE_MODEL_NAME: <your-model-name>
```

**For GCP Vertex (`gcp-vertex`):**
```yaml
LLM_PROVIDER: "gcp-vertex"
GCP_PROJECT_ID: <your-project-id>
GCP_LOCATION: <your-location>
GCP_MODEL_NAME: <your-model-name>
```

### Configure Agent-Specific Secrets

For each agent you plan to use, populate all required fields in their respective secrets (e.g., `github-secret`, `pagerduty-secret`, `jira-secret`). All fields are required for the agent to function properly.

