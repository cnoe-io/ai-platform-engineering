---
sidebar_position: 2
---

# Configure Agent Secrets for EKS

CAIPE needs one LLM secret and optional MCP server secrets. Use Kubernetes
Secrets for local or test clusters. Use External Secrets Operator for production
clusters.

## Manual Secrets

Create the namespace:

```bash
kubectl create namespace ai-platform-engineering
```

Create the shared LLM secret:

```bash
kubectl create secret generic llm-secret \
  -n ai-platform-engineering \
  --from-literal=LLM_PROVIDER=openai \
  --from-literal=OPENAI_API_KEY=<token> \
  --from-literal=OPENAI_MODEL_NAME=gpt-4o
```

Create only the MCP secrets you need:

```bash
kubectl create secret generic github-secret \
  -n ai-platform-engineering \
  --from-literal=GITHUB_PERSONAL_ACCESS_TOKEN=<token>

kubectl create secret generic argocd-secret \
  -n ai-platform-engineering \
  --from-literal=ARGOCD_TOKEN=<token> \
  --from-literal=ARGOCD_API_URL=https://argocd.example.com \
  --from-literal=ARGOCD_VERIFY_SSL=true
```

Reference those secrets in chart values:

```yaml
global:
  llmSecrets:
    secretName: llm-secret

mcp-github:
  agentSecrets:
    secretName: github-secret

mcp-argocd:
  agentSecrets:
    secretName: argocd-secret
```

Verify:

```bash
kubectl get secrets -n ai-platform-engineering
kubectl describe secret llm-secret -n ai-platform-engineering
```

## External Secrets

Install External Secrets Operator:

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets-system \
  --create-namespace
```

Configure the chart to read from your SecretStore or ClusterSecretStore:

```yaml
global:
  externalSecrets:
    enabled: true
    secretStoreRef:
      name: vault-store
      kind: ClusterSecretStore
  llmSecrets:
    create: false
    secretName: llm-secret
    externalSecrets:
      secretStoreRef:
        name: vault-store
        kind: ClusterSecretStore
      data:
        - secretKey: LLM_PROVIDER
          remoteRef:
            key: secret/ai-platform-engineering/global
            property: LLM_PROVIDER
        - secretKey: OPENAI_API_KEY
          remoteRef:
            key: secret/ai-platform-engineering/global
            property: OPENAI_API_KEY
        - secretKey: OPENAI_MODEL_NAME
          remoteRef:
            key: secret/ai-platform-engineering/global
            property: OPENAI_MODEL_NAME

mcp-github:
  agentSecrets:
    secretName: github-secret
    externalSecrets:
      data:
        - secretKey: GITHUB_PERSONAL_ACCESS_TOKEN
          remoteRef:
            key: secret/ai-platform-engineering/github
            property: GITHUB_PERSONAL_ACCESS_TOKEN
```

Use the provider fields your SecretStore supports. The chart passes the final
Kubernetes Secret keys through to the target workload.

## Secret Layout

Keep secrets grouped by service:

```text
secret/ai-platform-engineering/
  global
  github
  argocd
  slack
  webex
  pagerduty
```

## Troubleshooting

```bash
kubectl get externalsecret -n ai-platform-engineering
kubectl describe externalsecret <name> -n ai-platform-engineering
kubectl get secretstore -n ai-platform-engineering
kubectl get clustersecretstore
kubectl logs -n external-secrets-system -l app.kubernetes.io/name=external-secrets
```
