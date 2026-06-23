---
sidebar_position: 3
---

# Configure LLMs for EKS

Dynamic Agents and RAG read provider credentials from Kubernetes Secrets. The
standard chart path uses a shared `llm-secret`.

## OpenAI

```bash
kubectl create secret generic llm-secret \
  -n ai-platform-engineering \
  --from-literal=LLM_PROVIDER=openai \
  --from-literal=OPENAI_API_KEY=<token> \
  --from-literal=OPENAI_MODEL_NAME=gpt-4o
```

```yaml
global:
  llmSecrets:
    secretName: llm-secret

dynamic-agents:
  llmSecret: llm-secret
```

## Azure OpenAI

```bash
kubectl create secret generic llm-secret \
  -n ai-platform-engineering \
  --from-literal=LLM_PROVIDER=azure-openai \
  --from-literal=AZURE_OPENAI_API_KEY=<token> \
  --from-literal=AZURE_OPENAI_ENDPOINT=https://example.openai.azure.com \
  --from-literal=AZURE_OPENAI_API_VERSION=2025-03-01-preview \
  --from-literal=AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

## AWS Bedrock

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

## Seed Models in the UI

Use `caipe-ui.appConfig.models` when you want model options to be available
without manual admin setup:

```yaml
caipe-ui:
  appConfig:
    models:
      - model_id: gpt-4o
        name: GPT-4o
        provider: openai
        enabled: true
```

## RAG Embeddings

If RAG uses a different provider than chat, add the embedding keys to the same
secret or to the RAG chart's configured secret. Keep the provider-specific key
names unchanged so the workload can read them directly.

## Verify

```bash
kubectl get secret llm-secret -n ai-platform-engineering
kubectl logs -n ai-platform-engineering -l app.kubernetes.io/name=dynamic-agents
```
