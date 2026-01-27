---
sidebar_position: 3
---

# Configuration Guide

This guide covers all configuration options for the CAIPE UI, including environment variables, authentication setup, storage configuration, and deployment scenarios.

## Environment Variables

### Core Configuration

#### CAIPE Connection

| Variable | Required | Default (Dev) | Default (Docker) | Description |
|----------|----------|---------------|------------------|-------------|
| `CAIPE_URL` | No | `http://localhost:8000` | `http://caipe-supervisor:8000` | CAIPE supervisor A2A endpoint URL |
| `NEXT_PUBLIC_CAIPE_URL` | No | Same as `CAIPE_URL` | Same as `CAIPE_URL` | Client-side accessible supervisor URL |

**Configuration Priority** (highest to lowest):
1. `NEXT_PUBLIC_CAIPE_URL` (client-side accessible)
2. `CAIPE_URL` (server-side)
3. `A2A_ENDPOINT` (legacy support)
4. Default based on `NODE_ENV`

**Examples**:

```bash
# Development - uses localhost
npm run dev

# Development - custom endpoint
CAIPE_URL=http://my-caipe:8000 npm run dev

# Docker - uses internal service name
COMPOSE_PROFILES=caipe-ui docker compose -f docker-compose.dev.yaml up

# Docker - custom endpoint
CAIPE_URL=http://custom-supervisor:8000 COMPOSE_PROFILES=caipe-ui docker compose -f docker-compose.dev.yaml up
```

#### Application Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment: `development`, `production`, or `test` |
| `PORT` | No | `3000` | Port for the Next.js server |
| `HOSTNAME` | No | `localhost` | Hostname to bind to |

### Authentication Configuration

#### NextAuth Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXTAUTH_URL` | Yes | `http://localhost:3000` | Base URL for NextAuth callbacks |
| `NEXTAUTH_SECRET` | Yes | - | Secret for encrypting session tokens (32+ chars) |
| `SKIP_AUTH` | No | `false` | Skip authentication (development only) |

**Generate a secret**:

```bash
# Generate a secure random secret
openssl rand -base64 32
```

**Set in environment**:

```bash
export NEXTAUTH_SECRET="your-generated-secret-here"
```

#### OAuth 2.0 Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OAUTH_CLIENT_ID` | No | - | OAuth 2.0 client ID |
| `OAUTH_CLIENT_SECRET` | No | - | OAuth 2.0 client secret |
| `OAUTH_ISSUER` | No | - | OAuth 2.0 issuer URL |
| `OAUTH_AUTHORIZATION_URL` | No | - | Authorization endpoint |
| `OAUTH_TOKEN_URL` | No | - | Token endpoint |
| `OAUTH_USERINFO_URL` | No | - | User info endpoint |

**Example OAuth Configuration** (Generic):

```bash
export OAUTH_CLIENT_ID="your-client-id"
export OAUTH_CLIENT_SECRET="your-client-secret"
export OAUTH_ISSUER="https://auth.example.com"
export OAUTH_AUTHORIZATION_URL="https://auth.example.com/authorize"
export OAUTH_TOKEN_URL="https://auth.example.com/token"
export OAUTH_USERINFO_URL="https://auth.example.com/userinfo"
```

**Example OAuth Configuration** (Keycloak):

```bash
export OAUTH_CLIENT_ID="caipe-ui"
export OAUTH_CLIENT_SECRET="your-keycloak-secret"
export OAUTH_ISSUER="https://keycloak.example.com/realms/caipe"
export OAUTH_AUTHORIZATION_URL="https://keycloak.example.com/realms/caipe/protocol/openid-connect/auth"
export OAUTH_TOKEN_URL="https://keycloak.example.com/realms/caipe/protocol/openid-connect/token"
export OAUTH_USERINFO_URL="https://keycloak.example.com/realms/caipe/protocol/openid-connect/userinfo"
```

### Use Case Storage Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `USECASE_STORAGE_TYPE` | No | `file` | Storage backend: `file` or `mongodb` |
| `USECASE_STORAGE_PATH` | No | `./data/usecases.json` | File path (file storage only) |
| `MONGODB_URI` | No | - | MongoDB connection string (MongoDB storage only) |

#### File-based Storage (Default)

Best for development and small deployments.

```bash
# Use default file storage (no configuration needed)
npm run dev
```

**Custom path**:

```bash
export USECASE_STORAGE_TYPE=file
export USECASE_STORAGE_PATH=/custom/path/usecases.json
npm run dev
```

**Pros**:
- ✅ No dependencies
- ✅ Easy backup (version control)
- ✅ Perfect for development

**Cons**:
- ❌ Not suitable for production with multiple instances
- ❌ Limited concurrency support

#### MongoDB Storage

Best for production deployments with multiple instances.

```bash
# Install MongoDB driver
npm install mongodb

# Configure MongoDB
export USECASE_STORAGE_TYPE=mongodb
export MONGODB_URI="mongodb://localhost:27017/caipe"
npm run dev
```

**MongoDB URI Examples**:

```bash
# Local MongoDB
MONGODB_URI=mongodb://localhost:27017/caipe

# With authentication
MONGODB_URI=mongodb://username:password@localhost:27017/caipe?authSource=admin

# MongoDB Atlas (cloud)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/caipe?retryWrites=true&w=majority

# Replica set
MONGODB_URI=mongodb://mongo1:27017,mongo2:27017,mongo3:27017/caipe?replicaSet=rs0
```

**Pros**:
- ✅ Production-ready
- ✅ Supports multiple instances
- ✅ Better concurrency
- ✅ Scalable

**Cons**:
- ❌ Requires MongoDB installation
- ❌ Additional dependency

See [Use Case Storage Documentation](../../../ui/USECASE_STORAGE.md) for migration and troubleshooting.

### Logging and Debugging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `DEBUG` | No | - | Enable debug mode for specific modules (e.g., `a2a:*`) |

**Enable debug logging**:

```bash
export LOG_LEVEL=debug
export DEBUG="a2a:*,chat:*"
npm run dev
```

## Configuration Files

### .env.local

Create a `.env.local` file in the `ui/` directory for local development:

```bash
# ui/.env.local

# CAIPE Connection
CAIPE_URL=http://localhost:8000

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here

# OAuth (optional for development)
# OAUTH_CLIENT_ID=your-client-id
# OAUTH_CLIENT_SECRET=your-client-secret

# Storage
USECASE_STORAGE_TYPE=file

# Debugging
LOG_LEVEL=debug

# Skip auth for development
SKIP_AUTH=true
```

### .env.production

For production deployments:

```bash
# ui/.env.production

# CAIPE Connection
CAIPE_URL=https://caipe.example.com
NEXT_PUBLIC_CAIPE_URL=https://caipe.example.com

# NextAuth
NEXTAUTH_URL=https://ui.example.com
NEXTAUTH_SECRET=secure-random-secret

# OAuth
OAUTH_CLIENT_ID=production-client-id
OAUTH_CLIENT_SECRET=production-client-secret
OAUTH_ISSUER=https://auth.example.com

# Storage
USECASE_STORAGE_TYPE=mongodb
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/caipe

# Logging
LOG_LEVEL=info

# NEVER skip auth in production
SKIP_AUTH=false
```

## Docker Configuration

### Docker Compose

The UI is included in `docker-compose.dev.yaml` under the `caipe-ui` profile:

```yaml
services:
  caipe-ui:
    build:
      context: .
      dockerfile: build/Dockerfile.caipe-ui
    container_name: caipe-ui
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - CAIPE_URL=${CAIPE_URL:-http://caipe-supervisor:8000}
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - SKIP_AUTH=${SKIP_AUTH:-false}
      - USECASE_STORAGE_TYPE=${USECASE_STORAGE_TYPE:-file}
    profiles:
      - caipe-ui
    depends_on:
      - caipe-supervisor
```

**Start with Make** (Recommended):

```bash
# Run UI with Docker Compose (includes supervisor)
make caipe-ui-docker-compose
```

**Or with Docker Compose directly**:

```bash
# Using environment variable (recommended)
COMPOSE_PROFILES=caipe-ui docker compose -f docker-compose.dev.yaml up

# Or using --profile flag
docker compose -f docker-compose.dev.yaml --profile caipe-ui up

# Start everything (all agents + UI)
COMPOSE_PROFILES="all-agents,caipe-ui" docker compose -f docker-compose.dev.yaml up
```

### Standalone Docker

**Build the image**:

```bash
cd ui
docker build -t caipe-ui:latest .
```

**Run the container**:

```bash
docker run -d \
  --name caipe-ui \
  -p 3001:3000 \
  -e CAIPE_URL=http://caipe-supervisor:8000 \
  -e NEXTAUTH_SECRET=your-secret \
  -e SKIP_AUTH=false \
  caipe-ui:latest
```

## Kubernetes Configuration

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: caipe-ui
  namespace: caipe
spec:
  replicas: 3
  selector:
    matchLabels:
      app: caipe-ui
  template:
    metadata:
      labels:
        app: caipe-ui
    spec:
      containers:
      - name: caipe-ui
        image: ghcr.io/cnoe-io/caipe-ui:latest
        ports:
        - containerPort: 3000
        env:
        - name: CAIPE_URL
          value: "http://caipe-supervisor:8000"
        - name: NEXTAUTH_URL
          value: "https://ui.example.com"
        - name: NEXTAUTH_SECRET
          valueFrom:
            secretKeyRef:
              name: caipe-ui-secrets
              key: nextauth-secret
        - name: OAUTH_CLIENT_ID
          valueFrom:
            secretKeyRef:
              name: oauth-credentials
              key: client-id
        - name: OAUTH_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: oauth-credentials
              key: client-secret
        - name: USECASE_STORAGE_TYPE
          value: "mongodb"
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: mongodb-credentials
              key: uri
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: caipe-ui
  namespace: caipe
spec:
  selector:
    app: caipe-ui
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: ClusterIP
```

### Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: caipe-ui
  namespace: caipe
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - ui.example.com
    secretName: caipe-ui-tls
  rules:
  - host: ui.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: caipe-ui
            port:
              number: 80
```

### Secrets

```bash
# Create NextAuth secret
kubectl create secret generic caipe-ui-secrets \
  -n caipe \
  --from-literal=nextauth-secret=$(openssl rand -base64 32)

# Create OAuth credentials
kubectl create secret generic oauth-credentials \
  -n caipe \
  --from-literal=client-id=your-client-id \
  --from-literal=client-secret=your-client-secret

# Create MongoDB credentials
kubectl create secret generic mongodb-credentials \
  -n caipe \
  --from-literal=uri='mongodb+srv://user:pass@cluster.mongodb.net/caipe'
```

## Security Best Practices

### 1. Secrets Management

**❌ NEVER**:
- Commit secrets to version control
- Use default secrets in production
- Share secrets in plain text

**✅ ALWAYS**:
- Use environment variables or secret managers
- Rotate secrets regularly
- Use strong random secrets (32+ characters)

### 2. HTTPS/TLS

**Production deployments MUST use HTTPS**:

```bash
# In production, always use HTTPS
NEXTAUTH_URL=https://ui.example.com  # NOT http://
CAIPE_URL=https://caipe.example.com  # NOT http://
```

### 3. CORS Configuration

The UI handles CORS automatically, but ensure CAIPE supervisor allows requests:

```python
# CAIPE supervisor CORS configuration
allow_origins = [
    "https://ui.example.com",
    "http://localhost:3000",  # Development only
]
```

### 4. Content Security Policy

Configure CSP headers in production:

```typescript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; ..."
          },
        ],
      },
    ];
  },
};
```

## Performance Tuning

### 1. Build Optimizations

```bash
# Analyze bundle size
npm run build
npx @next/bundle-analyzer

# Enable SWC minification (default in Next.js 15)
# next.config.js
module.exports = {
  swcMinify: true,
};
```

### 2. Caching

```typescript
// next.config.js
module.exports = {
  headers: async () => [
    {
      source: '/static/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        },
      ],
    },
  ],
};
```

### 3. Resource Limits (Kubernetes)

```yaml
resources:
  requests:
    memory: "256Mi"  # Minimum required
    cpu: "250m"
  limits:
    memory: "512Mi"  # Maximum allowed
    cpu: "500m"
```

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to CAIPE supervisor

**Solution**:
```bash
# Verify supervisor is running
curl http://localhost:8000/.well-known/agent-card.json

# Check CAIPE_URL configuration
echo $CAIPE_URL

# Test from container (Docker)
docker exec caipe-ui curl http://caipe-supervisor:8000/.well-known/agent-card.json
```

### Authentication Issues

**Problem**: OAuth callback fails

**Solution**:
1. Verify `NEXTAUTH_URL` matches your domain
2. Check OAuth provider callback URL configuration
3. Ensure `NEXTAUTH_SECRET` is set and consistent
4. Review OAuth client ID/secret

**Problem**: Session expires immediately

**Solution**:
```bash
# Ensure secret is at least 32 characters
openssl rand -base64 32

# Check cookie settings (production requires HTTPS)
export NEXTAUTH_URL=https://ui.example.com  # NOT http://
```

### Storage Issues

**Problem**: MongoDB connection fails

**Solution**:
```bash
# Test MongoDB connection
mongosh "$MONGODB_URI" --eval "db.adminCommand('ping')"

# Check MongoDB URI format
echo $MONGODB_URI

# Verify network access
telnet mongo-host 27017
```

**Problem**: File storage permission denied

**Solution**:
```bash
# Ensure data directory exists and is writable
mkdir -p ui/data
chmod 755 ui/data

# Check file permissions
ls -la ui/data/usecases.json
```

## Next Steps

- [Development Guide](development.md) - Set up local development environment
- [Features Guide](features.md) - Explore all UI features
- [API Reference](api-reference.md) - REST API documentation
