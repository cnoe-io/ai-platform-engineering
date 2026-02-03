# MongoDB Chart for CAIPE UI

This Helm chart deploys MongoDB as a persistent storage backend for the CAIPE UI chat history and workflow data.

## Overview

MongoDB provides:
- Persistent chat history storage
- Shareable conversations across team members
- Admin features for workflow management
- Reliable data persistence with PVC support

## Installation

### Option 1: Enable with Parent Chart

Enable MongoDB via the parent chart values:

```yaml
# values.yaml
mongodb:
  enabled: true
  persistence:
    enabled: true
    size: 10Gi
    storageClass: "gp3"  # or your storage class
  auth:
    rootUsername: "admin"
    rootPassword: "changeme"  # Change this!
    database: "caipe"
```

Install the chart:

```bash
helm install ai-platform-engineering ./charts/ai-platform-engineering \
  --set mongodb.enabled=true \
  --set tags.caipe-ui=true
```

### Option 2: Use Example Values File

```bash
helm install ai-platform-engineering ./charts/ai-platform-engineering \
  -f charts/ai-platform-engineering/values-mongodb.yaml.example
```

### Option 3: Standalone Installation

```bash
helm install mongodb ./charts/ai-platform-engineering/charts/mongodb \
  --set persistence.enabled=true \
  --set persistence.size=10Gi \
  --set auth.rootPassword=secure-password
```

## Configuration

### Persistence

MongoDB uses a StatefulSet with volumeClaimTemplates for reliable storage:

```yaml
persistence:
  enabled: true
  storageClass: ""  # Use default or specify: "gp3", "standard", etc.
  accessModes:
    - ReadWriteOnce
  size: 10Gi
```

### Authentication

**Development/Testing:**

```yaml
auth:
  rootUsername: "admin"
  rootPassword: "changeme"
  database: "caipe"
```

**Production (External Secrets):**

```yaml
externalSecrets:
  enabled: true
  apiVersion: "v1beta1"
  secretStoreRef:
    name: "vault"
    kind: "ClusterSecretStore"
  data:
    - secretKey: MONGO_INITDB_ROOT_USERNAME
      remoteRef:
        key: dev/mongodb
        property: username
    - secretKey: MONGO_INITDB_ROOT_PASSWORD
      remoteRef:
        key: dev/mongodb
        property: password
```

See `values-external-secrets.yaml` for complete examples.

### Resource Limits

```yaml
resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi
```

## Connecting CAIPE UI to MongoDB

The CAIPE UI needs the MongoDB connection URI as a secret:

### Option 1: Using External Secrets (Recommended)

Store in your secret manager:

```json
{
  "MONGODB_URI": "mongodb://admin:password@ai-platform-engineering-mongodb:27017"
}
```

Configure CAIPE UI:

```yaml
caipe-ui:
  config:
    NEXT_PUBLIC_MONGODB_ENABLED: "true"
    MONGODB_DATABASE: "caipe"
  externalSecrets:
    enabled: true
    data:
      - secretKey: MONGODB_URI
        remoteRef:
          key: dev/caipe-ui
          property: MONGODB_URI
```

### Option 2: Manual Secret (Development)

```bash
kubectl create secret generic ai-platform-engineering-caipe-ui-secret \
  --from-literal=MONGODB_URI="mongodb://admin:changeme@ai-platform-engineering-mongodb:27017" \
  -n your-namespace
```

## Health Checks

MongoDB includes liveness and readiness probes using `mongosh`:

```yaml
livenessProbe:
  exec:
    command:
      - mongosh
      - --eval
      - "db.adminCommand('ping')"
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  exec:
    command:
      - mongosh
      - --eval
      - "db.adminCommand('ping')"
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Service

MongoDB is exposed via a headless service for StatefulSet:

```yaml
service:
  type: ClusterIP
  port: 27017
```

Service name: `<release-name>-mongodb` (e.g., `ai-platform-engineering-mongodb`)

## Storage Class Support

Supports various storage classes:

- **AWS EBS**: `gp3`, `gp2`, `io1`, `io2`
- **GCP Persistent Disk**: `pd-standard`, `pd-ssd`
- **Azure Disk**: `managed-premium`, `managed-standard`
- **Minikube**: `standard`
- **Default**: Leave `storageClass: ""` to use cluster default

## Security

### Security Context

MongoDB runs as non-root user (UID 999):

```yaml
podSecurityContext:
  fsGroup: 999

securityContext:
  runAsNonRoot: true
  runAsUser: 999
```

### Secrets Management

- **Development**: Use `auth.rootPassword` in values (encrypt with SOPS/sealed-secrets)
- **Production**: Use External Secrets Operator with Vault/AWS Secrets Manager/GCP Secret Manager

## Backup and Restore

### Backup

```bash
# Export database
kubectl exec -it ai-platform-engineering-mongodb-0 -- \
  mongodump --username admin --password changeme --authenticationDatabase admin \
  --db caipe --archive=/tmp/caipe-backup.archive

# Copy to local
kubectl cp ai-platform-engineering-mongodb-0:/tmp/caipe-backup.archive ./caipe-backup.archive
```

### Restore

```bash
# Copy backup to pod
kubectl cp ./caipe-backup.archive ai-platform-engineering-mongodb-0:/tmp/caipe-backup.archive

# Restore database
kubectl exec -it ai-platform-engineering-mongodb-0 -- \
  mongorestore --username admin --password changeme --authenticationDatabase admin \
  --archive=/tmp/caipe-backup.archive
```

## Troubleshooting

### Check MongoDB Status

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=mongodb

# Check logs
kubectl logs -f ai-platform-engineering-mongodb-0

# Connect to MongoDB
kubectl exec -it ai-platform-engineering-mongodb-0 -- \
  mongosh --username admin --password changeme --authenticationDatabase admin
```

### Check PVC

```bash
# List PVCs
kubectl get pvc -l app.kubernetes.io/name=mongodb

# Describe PVC
kubectl describe pvc data-ai-platform-engineering-mongodb-0
```

### Common Issues

**PVC Pending:**
- Check if storage class exists: `kubectl get storageclass`
- Verify storage provisioner is running
- Check PVC events: `kubectl describe pvc data-ai-platform-engineering-mongodb-0`

**Connection Refused:**
- Verify MongoDB is running: `kubectl get pods`
- Check service: `kubectl get svc ai-platform-engineering-mongodb`
- Verify MONGODB_URI format: `mongodb://username:password@host:port`

**Authentication Failed:**
- Verify credentials in secret: `kubectl get secret ai-platform-engineering-mongodb-secret -o yaml`
- Check MongoDB logs for authentication errors

## Upgrading

When upgrading MongoDB:

1. **Backup data first** (see Backup section)
2. Update chart version in `Chart.yaml`
3. Run `helm upgrade` with `--wait` flag
4. Verify data integrity after upgrade

```bash
helm upgrade ai-platform-engineering ./charts/ai-platform-engineering \
  --set mongodb.enabled=true \
  --wait
```

## Uninstalling

**WARNING**: Uninstalling will NOT delete the PVC by default. Data persists until you manually delete the PVC.

```bash
# Uninstall chart
helm uninstall ai-platform-engineering

# Delete PVC (if desired)
kubectl delete pvc data-ai-platform-engineering-mongodb-0
```

## Values

See `values.yaml` for all available configuration options.

Key values:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `enabled` | Enable MongoDB deployment | `false` |
| `image.repository` | MongoDB image repository | `mongo` |
| `image.tag` | MongoDB image tag | `7.0` |
| `persistence.enabled` | Enable persistent storage | `true` |
| `persistence.size` | PVC size | `10Gi` |
| `auth.rootUsername` | MongoDB root username | `admin` |
| `auth.rootPassword` | MongoDB root password | `changeme` |
| `auth.database` | Default database | `caipe` |
| `externalSecrets.enabled` | Use External Secrets | `false` |

## References

- [MongoDB Documentation](https://docs.mongodb.com/)
- [Kubernetes StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [External Secrets Operator](https://external-secrets.io/)
