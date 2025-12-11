# Kubernetes (K8s) Ingestor

Ingests Kubernetes resources as graph entities into the RAG system. Discovers and ingests both standard Kubernetes resources and Custom Resource Definitions (CRDs) from your cluster.

## Supported Resource Types (configurable)

- `Certificate` - cert-manager Certificates
- `ClusterIssuer` - cert-manager ClusterIssuers
- `CronJob` - Kubernetes CronJobs
- `DaemonSet` - Kubernetes DaemonSets
- `Deployment` - Kubernetes Deployments
- `Ingress` - Kubernetes Ingress resources
- `IngressClass` - Kubernetes IngressClasses
- `Issuer` - cert-manager Issuers
- `Job` - Kubernetes Jobs
- `Namespace` - Kubernetes Namespaces
- `Node` - Kubernetes Nodes
- `Service` - Kubernetes Services
- `StatefulSet` - Kubernetes StatefulSets
- `StorageClass` - Kubernetes StorageClasses
- ...and any other standard or custom resources you configure

## Required Environment Variables

- `CLUSTER_NAME` - Name of your Kubernetes cluster (used for entity identification)
- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)

## Kubernetes Authentication (choose one method)

### Option 1: In-Cluster Configuration (running inside a Kubernetes pod)

- Set `IN_CLUSTER=true`
- Uses ServiceAccount credentials automatically
- No kubeconfig file needed

### Option 2: Custom Kubeconfig File

- Set `KUBECONFIG=/path/to/kubeconfig` to specify a custom kubeconfig file
- Optionally set `KUBE_CONTEXT=my-context` to use a specific context
- If `KUBE_CONTEXT` is not set, the current context from the kubeconfig will be used

### Option 3: Default Kubeconfig (~/.kube/config)

- Don't set `KUBECONFIG` or `IN_CLUSTER`
- Optionally set `KUBE_CONTEXT=my-context` to use a specific context
- Uses `~/.kube/config` by default

## Optional Environment Variables

- `KUBE_CONTEXT` - Specific kubeconfig context to use (works with any kubeconfig source)
- `K8S_RESOURCE_LIST` - Comma-separated list of Kubernetes resource kinds to ingest 
- `K8S_IGNORE_FIELD_LIST` - Comma-separated list of field prefixes to exclude from ingested entities
- `SYNC_INTERVAL` - Sync interval in seconds (default: `900` = 15 minutes)
- `INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

## Running with Docker Compose

Make sure the RAG server is up and running before starting the ingestor.

### Using default kubeconfig

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export CLUSTER_NAME=my-cluster
docker compose --profile k8s up --build k8s_ingestor
```

### Using specific context

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export CLUSTER_NAME=my-cluster
export KUBE_CONTEXT=prod-cluster
docker compose --profile k8s up --build k8s_ingestor
```

### Using custom kubeconfig

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export CLUSTER_NAME=my-cluster
export KUBECONFIG=/path/to/my/kubeconfig
# Optional: export KUBE_CONTEXT=my-context
docker compose --profile k8s up --build k8s_ingestor
```

### Running with EKS clusters (requires AWS authentication)

EKS clusters use AWS IAM for authentication, which requires the AWS CLI to be available in the container. To run the K8s ingestor with EKS:

1. Create a `docker-compose.override.yaml` file:

```yaml
services:
  k8s_ingestor:
    volumes:
      # Mount AWS credentials for EKS authentication
      - ~/.aws:/home/app/.aws:ro
```

2. Run the ingestor:

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export CLUSTER_NAME=my-eks-cluster
export KUBE_CONTEXT=my-eks-context  # The context that uses AWS authentication
docker compose --profile k8s up --build k8s_ingestor
```

**Important for EKS users:** The container needs access to your AWS credentials (`~/.aws/` directory) because EKS kubeconfig files use `aws eks get-token` commands for authentication. Make sure your AWS profile has the necessary EKS permissions.

### Running in-cluster (deploy as a Kubernetes pod)

```bash
# In your Kubernetes deployment manifest, set:
# - IN_CLUSTER: "true"
# - CLUSTER_NAME: "your-cluster-name"
# - RAG_SERVER_URL: "http://rag-server:9446"
# No kubeconfig needed - uses ServiceAccount
```

## Requirements

The K8s ingestor requires:
- Read access to your Kubernetes cluster (via kubeconfig, specific context, or in-cluster ServiceAccount)
- RBAC permissions to list and describe the resource types you want to ingest
- The `CLUSTER_NAME` environment variable must be set to identify your cluster
- Entity types are created in Pascal case format (e.g., `K8sDeployment`, `K8sService`, `K8sCustomResource`)
- When running in-cluster, ensure the ServiceAccount has proper RBAC permissions
- **For EKS clusters:** AWS credentials must be available in the container (see EKS-specific instructions above)

