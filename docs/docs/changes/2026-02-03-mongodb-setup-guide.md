# MongoDB Setup for CAIPE UI

## Summary

This setup adds MongoDB as a persistent storage backend for CAIPE UI, enabling:
- Persistent chat history storage
- Shareable conversations across team members
- Admin features for workflow management
- Team collaboration features

## What's Included

### 1. MongoDB Subchart (`charts/caipe-ui-mongodb/`)

A complete Helm chart for deploying MongoDB with:
- **StatefulSet** for reliable persistent storage
- **PVC/PV** support with configurable storage class
- **External Secrets** integration for production
- Health checks (liveness/readiness probes)
- Security context (runs as non-root user)
- Automatic TLS secret provisioning

**Files**:
- `Chart.yaml` - Chart metadata
- `values.yaml` - Default configuration
- `values-external-secrets.yaml` - External secrets example
- `templates/` - Kubernetes manifests
  - `_helpers.tpl` - Template helpers
  - `statefulset.yaml` - MongoDB deployment
  - `service.yaml` - Headless service
  - `secret.yaml` - Auth credentials secret
  - `external-secret.yaml` - External secrets integration
  - `serviceaccount.yaml` - Service account
- `README.md` - Comprehensive documentation

### 2. CAIPE UI Configuration Updates

Updated `charts/caipe-ui/` with:
- MongoDB connection configuration
- All environment variables from `ui/.env.local` added to ConfigMap
- External secrets support for MongoDB URI
- Langfuse configuration for feedback tracking
- Branding configuration (tagline, description, logo)
- OIDC configuration (required groups, admin groups)

**Modified Files**:
- `values.yaml` - Added all config from .env.local
- `values-external-secrets.yaml` - Added MongoDB URI and Langfuse secrets
- `templates/ingress-redirect.yaml` - NEW: Redirect ingress support

### 3. Parent Chart Integration

Updated `charts/ai-platform-engineering/`:
- Added MongoDB subchart dependency (`caipe-ui-mongodb`)
- Added MongoDB configuration section in values.yaml
- Updated CAIPE UI configuration with MongoDB support

**Modified Files**:
- `Chart.yaml` - Added mongodb dependency
- `values.yaml` - Added mongodb and updated caipe-ui config sections

### 4. Example Configuration Files

**MongoDB Examples**:
- `values-mongodb.yaml.example` - Complete MongoDB setup example with both dev and prod configurations

**Ingress Examples**:
- `charts/caipe-ui/values-ingress-redirect.yaml.example` - Generic domain redirect example
- [CAIPE UI Ingress Configuration Guide](2026-02-03-caipe-ui-ingress-configuration-guide.md) - Complete ingress configuration guide

## Quick Start

### Development/Testing (Local Storage)

```bash
# Deploy with MongoDB (using default credentials)
helm install ai-platform-engineering ./charts/ai-platform-engineering \
  -f charts/ai-platform-engineering/values-mongodb.yaml.example \
  --set mongodb.auth.rootPassword=your-secure-password
```

### Production (External Secrets)

```bash
# 1. Store secrets in your secret manager (Vault, AWS Secrets Manager, etc.)
# MongoDB credentials at: dev/mongodb
# CAIPE UI secrets at: dev/caipe-ui (including MONGODB_URI)

# 2. Deploy with external secrets
helm install ai-platform-engineering ./charts/ai-platform-engineering \
  -f charts/ai-platform-engineering/values-mongodb.yaml.example \
  --set mongodb.externalSecrets.enabled=true \
  --set caipe-ui.externalSecrets.enabled=true \
  --set mongodb.externalSecrets.secretStoreRef.name=your-secret-store \
  --set caipe-ui.externalSecrets.secretStoreRef.name=your-secret-store
```

### With Custom Ingress

```bash
# Copy and customize the ingress example
cp charts/ai-platform-engineering/charts/caipe-ui/values-ingress-redirect.yaml.example \
   my-ingress-config.yaml

# Edit my-ingress-config.yaml with your domains, then deploy:
helm install ai-platform-engineering ./charts/ai-platform-engineering \
  -f charts/ai-platform-engineering/values-mongodb.yaml.example \
  -f my-ingress-config.yaml
```

## Configuration

### MongoDB URI Format

The CAIPE UI needs the MongoDB connection URI in this format:

```
mongodb://username:password@host:port
```

**For Kubernetes deployment**:
```
mongodb://admin:changeme@ai-platform-engineering-mongodb:27017
```

**For external MongoDB**:
```
mongodb://admin:password@external-mongodb.example.com:27017
```

### Storage Classes

Specify storage class based on your cloud provider:

```yaml
mongodb:
  persistence:
    storageClass: "gp3"  # AWS EBS gp3
    # storageClass: "pd-ssd"  # GCP Persistent Disk SSD
    # storageClass: "managed-premium"  # Azure Premium Disk
    # storageClass: ""  # Use cluster default
```

### Resource Limits

Adjust based on your workload:

```yaml
mongodb:
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 250m
      memory: 256Mi
```

## Environment Variables from ui/.env.local

All environment variables from `ui/.env.local` have been mapped to the Helm chart:

### ConfigMap (Non-Sensitive)
- `NEXT_PUBLIC_A2A_BASE_URL` - Supervisor agent URL
- `NEXT_PUBLIC_RAG_URL` - RAG server URL
- `NEXT_PUBLIC_SSO_ENABLED` - Enable SSO
- `NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS` - Enable subagent cards
- `NEXT_PUBLIC_MONGODB_ENABLED` - Enable MongoDB mode
- `MONGODB_DATABASE` - Database name
- `NEXTAUTH_URL` - NextAuth callback URL
- `OIDC_REQUIRED_GROUP` - Required group for access
- `OIDC_REQUIRED_ADMIN_GROUP` - Admin group
- `OIDC_ENABLE_REFRESH_TOKEN` - Enable refresh tokens
- `NEXT_PUBLIC_SUPPORT_EMAIL` - Support contact email
- `NEXT_PUBLIC_TAGLINE` - Application tagline
- `NEXT_PUBLIC_DESCRIPTION` - Application description
- `NEXT_PUBLIC_APP_NAME` - Application name
- `NEXT_PUBLIC_LOGO_URL` - Logo URL
- `NEXT_PUBLIC_LOGO_STYLE` - Logo style
- `NEXT_PUBLIC_SPINNER_COLOR` - Spinner color
- `NEXT_PUBLIC_SHOW_POWERED_BY` - Show "powered by" footer
- `NEXT_PUBLIC_PREVIEW_MODE` - Enable preview mode

### External Secrets (Sensitive)
- `NEXTAUTH_SECRET` - Session encryption secret
- `OIDC_ISSUER` - OIDC provider URL
- `OIDC_CLIENT_ID` - OIDC client ID
- `OIDC_CLIENT_SECRET` - OIDC client secret
- `MONGODB_URI` - MongoDB connection string
- `LANGFUSE_SECRET_KEY` - Langfuse secret key
- `LANGFUSE_PUBLIC_KEY` - Langfuse public key
- `LANGFUSE_HOST` - Langfuse host URL

## Ingress Configuration

The CAIPE UI ingress now supports:

### Multiple Hostnames
```yaml
caipe-ui:
  ingress:
    hosts:
      - host: caipe.example.com
        paths:
          - path: /
            pathType: Prefix
      - host: api.example.com
        paths:
          - path: /caipe
            pathType: Prefix
```

### Annotations
```yaml
caipe-ui:
  ingress:
    annotations:
      cert-manager.io/cluster-issuer: "letsencrypt-prod"
      nginx.ingress.kubernetes.io/ssl-redirect: "true"
      nginx.ingress.kubernetes.io/proxy-body-size: "100m"
```

### Automatic Redirects
```yaml
caipe-ui:
  ingress:
    redirectFrom:
      - host: old-domain.example.com
        redirectTo: "https://new-domain.example.com"
        tls:
          secretName: old-domain-example-com-tls
```

See [CAIPE UI Ingress Configuration Guide](2026-02-03-caipe-ui-ingress-configuration-guide.md) for complete configuration guide.

## External Secrets Setup

### Prerequisites
1. External Secrets Operator installed
2. SecretStore or ClusterSecretStore configured
3. Secrets stored in your secret manager

### Vault Example

Store secrets in Vault:

```bash
# MongoDB credentials
vault kv put dev/mongodb \
  username=admin \
  password=secure-password \
  database=caipe

# CAIPE UI secrets
vault kv put dev/caipe-ui \
  NEXTAUTH_SECRET=$(openssl rand -base64 32) \
  OIDC_ISSUER=https://sso.example.com \
  OIDC_CLIENT_ID=your-client-id \
  OIDC_CLIENT_SECRET=your-client-secret \
  MONGODB_URI=mongodb://admin:secure-password@ai-platform-engineering-mongodb:27017 \
  LANGFUSE_SECRET_KEY=sk-lf-xxx \
  LANGFUSE_PUBLIC_KEY=pk-lf-xxx \
  LANGFUSE_HOST=https://langfuse.example.com
```

Deploy with external secrets:

```bash
helm install ai-platform-engineering ./charts/ai-platform-engineering \
  --set mongodb.externalSecrets.enabled=true \
  --set mongodb.externalSecrets.secretStoreRef.name=vault \
  --set caipe-ui.externalSecrets.enabled=true \
  --set caipe-ui.externalSecrets.secretStoreRef.name=vault
```

## Verification

### Check MongoDB Pod
```bash
kubectl get pods -l app.kubernetes.io/name=mongodb
kubectl logs -f ai-platform-engineering-mongodb-0
```

### Check PVC
```bash
kubectl get pvc -l app.kubernetes.io/name=mongodb
kubectl describe pvc data-ai-platform-engineering-mongodb-0
```

### Test MongoDB Connection
```bash
kubectl exec -it ai-platform-engineering-mongodb-0 -- \
  mongosh --username admin --password changeme --authenticationDatabase admin
```

### Check CAIPE UI
```bash
kubectl get pods -l app.kubernetes.io/name=caipe-ui
kubectl logs -f deployment/ai-platform-engineering-caipe-ui
```

### Test Ingress
```bash
curl -I https://your-domain.example.com
# Should return: HTTP/2 200
```

## Troubleshooting

### caipe-preview (or any env) still not using MongoDB

If the UI shows **LocalStorage (Browser-only)** or chat/conversations are not persisted, check the following.

1. **ConfigMap has `NEXT_PUBLIC_MONGODB_ENABLED`**
   - The client reads `window.__RUNTIME_ENV__.NEXT_PUBLIC_MONGODB_ENABLED` (injected by PublicEnvScript from server `process.env`).
   - If the ConfigMap is empty or missing this key, the UI will treat MongoDB as disabled.
   ```bash
   kubectl get configmap -n caipe-preview -l app.kubernetes.io/name=caipe-ui -o yaml
   # Look for data.NEXT_PUBLIC_MONGODB_ENABLED: "true"
   ```

2. **Secret has `MONGODB_URI`**
   - The server needs `MONGODB_URI` and `MONGODB_DATABASE` to connect. These come from the External Secret.
   - If `MONGODB_URI` is missing in Vault at the path used by the ExternalSecret (e.g. `projects/caipe/preview/caipe-ui` property `MONGODB_URI`), the synced Secret will not have it and the app will not use MongoDB.
   ```bash
   kubectl get secret -n caipe-preview <caipe-ui-secret-name> -o jsonpath='{.data}' | jq 'keys'
   # Should include MONGODB_URI (and NEXTAUTH_SECRET, OIDC_*, etc.)
   kubectl get externalsecret -n caipe-preview
   # Check status.conditions for Synced=True and no errors
   ```

3. **MongoDB service hostname in `MONGODB_URI`**
   - The connection string must use the in-cluster MongoDB service name. For the chart with `fullnameOverride: ai-platform-engineering-mongodb`, the host should be `ai-platform-engineering-mongodb` (same namespace as caipe-ui).
   - Example: `mongodb://<user>:<password>@ai-platform-engineering-mongodb:27017/caipe?authSource=admin`

4. **Image includes runtime env injection**
   - The UI must inject `NEXT_PUBLIC_*` at runtime via PublicEnvScript (in layout, at start of `<body>`). If the deployed image was built before that change, the client never gets `window.__RUNTIME_ENV__` and will show localStorage. Use an image that includes the runtime-env-vars work (e.g. 0.2.15-rc.2 or later with that merge).

5. **Pod env**
   - Confirm the caipe-ui pod actually has the vars:
   ```bash
   kubectl exec -n caipe-preview deploy/<caipe-ui-deployment-name> -- env | grep -E 'NEXT_PUBLIC_MONGODB|MONGODB_URI|MONGODB_DATABASE'
   ```

See also:
- `charts/caipe-ui-mongodb/README.md` - MongoDB troubleshooting
- `charts/caipe-ui/INGRESS.md` - Ingress troubleshooting

## Next Steps

1. **Enable MongoDB**: Set `mongodb.enabled=true`
2. **Configure Storage**: Choose appropriate storage class
3. **Set Credentials**: Use external secrets for production
4. **Configure Ingress**: Update hostnames and TLS
5. **Update OIDC**: Add new redirect URIs
6. **Deploy**: Run helm install/upgrade
7. **Verify**: Test authentication and data persistence

## References

- MongoDB Chart: `charts/ai-platform-engineering/charts/caipe-ui-mongodb/`
- CAIPE UI Chart: `charts/ai-platform-engineering/charts/caipe-ui/`
- MongoDB Examples: `charts/ai-platform-engineering/values-mongodb.yaml.example`
- Ingress Guide: [CAIPE UI Ingress Configuration Guide](2026-02-03-caipe-ui-ingress-configuration-guide.md)
- Ingress Example: `charts/ai-platform-engineering/charts/caipe-ui/values-ingress-redirect.yaml.example`
