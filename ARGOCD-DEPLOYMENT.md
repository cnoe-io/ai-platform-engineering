# ArgoCD Deployment Guide for AI Platform Engineering

## Overview
This guide shows you how to deploy AI Platform Engineering using ArgoCD with your existing values files.

## File Structure
Your deployment uses these values files:
- `helm/values.yaml` - Main agent configurations (already exists)
- `helm/values-secrets.yaml` - Your Azure OpenAI secrets (already exists)  
- `helm/values-eks.yaml` - EKS-specific settings (create this)

## Step 1: Create EKS Values File

The `values-eks.yaml` file has been created with ALB ingress configuration.

## Step 2: Update Your Repository

Since ArgoCD pulls from Git, make sure your values files are committed:

```bash
# Check current status
git status

# Add the new EKS values file
git add helm/values-eks.yaml

# Commit changes
git commit -m "Add EKS-specific values for ArgoCD deployment"

# Push to your repository
git push origin main
```

## Step 3: Deploy with ArgoCD

```bash
# Ensure you're connected to your EKS cluster
aws eks update-kubeconfig --region us-east-2 --name experiment-dev-use2-1

# Apply the ArgoCD application
kubectl apply -f argocd-application.yaml

# Check application status
kubectl get application ai-platform-engineering -n argocd

# Watch the sync progress
kubectl get application ai-platform-engineering -n argocd -w
```

## Step 4: Monitor in ArgoCD UI

```bash
# Get ArgoCD admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Port forward to ArgoCD UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Access https://localhost:8080
# Username: admin
# Password: (from command above)
```

## Step 5: Verify Deployment

```bash
# Check deployed resources
kubectl get all -n ai-platform-engineering

# Check agent pods specifically
kubectl get pods -n ai-platform-engineering

# Check agent logs
kubectl logs -n ai-platform-engineering deployment/ai-platform-engineering-agent-argocd
kubectl logs -n ai-platform-engineering deployment/ai-platform-engineering-agent-pagerduty
```

## Step 6: Access Your Agents

Based on your `values.yaml`, you have ArgoCD and PagerDuty agents enabled.

```bash
# Port forward to test agents locally
kubectl port-forward svc/ai-platform-engineering-agent-argocd -n ai-platform-engineering 8001:8000
kubectl port-forward svc/ai-platform-engineering-agent-pagerduty -n ai-platform-engineering 8002:8000

# Test the agents
curl -X POST http://localhost:8001/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What ArgoCD applications are running?"}'

curl -X POST http://localhost:8002/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me recent PagerDuty incidents"}'
```

## Enabling Additional Agents

To enable more agents (like GitHub), you have two options:

### Option 1: Update values.yaml and commit
```bash
# Edit helm/values.yaml
# Change agent-github enabled: false to enabled: true

# Commit and push
git add helm/values.yaml
git commit -m "Enable GitHub agent"
git push origin main

# ArgoCD will auto-sync the changes
```

### Option 2: Use ArgoCD App-of-Apps pattern
Create separate ArgoCD applications for different environments/configurations.

## Troubleshooting

```bash
# Check ArgoCD application events
kubectl describe application ai-platform-engineering -n argocd

# Check ArgoCD controller logs
kubectl logs -n argocd deployment/argocd-application-controller

# Check specific agent issues
kubectl describe pod -n ai-platform-engineering -l app.kubernetes.io/name=agent-argocd
```

## Current Configuration Summary

Based on your files:
- **Enabled Agents**: ArgoCD, PagerDuty
- **LLM Provider**: Azure OpenAI (GPT-4.1)
- **Secrets**: Configured via Kubernetes secrets
- **Ingress**: ALB-ready (configure domain in values-eks.yaml)
- **Namespace**: ai-platform-engineering

Your agents will automatically use the Azure OpenAI configuration from your values-secrets.yaml file!
