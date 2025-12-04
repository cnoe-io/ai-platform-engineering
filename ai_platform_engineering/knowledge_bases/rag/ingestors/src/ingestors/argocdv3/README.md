# ArgoCD v3 Ingestor

Ingests entities from ArgoCD into the RAG system as graph entities. Fetches applications, projects, clusters, repositories, applicationsets, and RBAC roles from your ArgoCD instance.

## Supported Entity Types

- `ArgoCDInstance` - The ArgoCD instance itself with base URL
- `ArgoCDApplication` - Applications and their sync/health status
- `ArgoCDProject` - Projects with access controls and policies
- `ArgoCDCluster` - Kubernetes clusters registered in ArgoCD
- `ArgoCDRepository` - Git/Helm/OCI repositories
- `ArgoCDApplicationSet` - ApplicationSets for generating applications
- `ArgoCDProjectRole` - RBAC roles with policies and group mappings

## Required Environment Variables

- `SERVER_URL` - Base URL of your ArgoCD server (e.g., `https://argocd.example.com`)
- `ARGOCD_AUTH_TOKEN` - ArgoCD API authentication token
- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)

## Optional Environment Variables

- `ARGOCD_VERIFY_SSL` - Verify SSL certificates (default: `true`)
- `ARGOCD_FILTER_PROJECTS` - Comma-separated list of projects to ingest (default: all projects)
- `SYNC_INTERVAL` - Sync interval in seconds (default: `900` = 15 minutes)
- `INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

## Getting an ArgoCD API Token

### 1. Using ArgoCD CLI

```bash
argocd login <ARGOCD_SERVER>
argocd account generate-token --account <account-name>
```

### 2. Using the UI

- Navigate to User Info → Generate New Token

### 3. For automation accounts

Create a project-specific service account token via API:

```bash
curl -X POST https://argocd.example.com/api/v1/projects/{project}/roles/{role}/token \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"expiresIn": 0}'
```

## Running with Docker Compose

Make sure the RAG server is up and running before starting the ingestor.

### Basic usage

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export SERVER_URL=https://argocd.example.com
export ARGOCD_AUTH_TOKEN=<your-argocd-token>
docker compose --profile argocdv3 up --build argocdv3_ingestor
```

### With project filtering

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export SERVER_URL=https://argocd.example.com
export ARGOCD_AUTH_TOKEN=<your-argocd-token>
export ARGOCD_FILTER_PROJECTS=production,staging
docker compose --profile argocdv3 up --build argocdv3_ingestor
```

## API Version

This ingestor uses ArgoCD API v1 endpoints as specified in the OpenAPI/Swagger specification. All endpoints follow the pattern `/api/v1/{resource}`.

## Notes

The ArgoCD ingestor:
- Extracts RBAC roles and Casbin policies from projects
- Includes application sync status and health information
- Maps OIDC groups to project roles
- Does not extract sensitive information (passwords, tokens, certificates)
- Requires read access to applications, projects, clusters, and repositories
- Can filter by specific projects to reduce data volume
- Creates an `ArgoCDInstance` entity representing the ArgoCD server itself


