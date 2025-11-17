# RAG Ingestors

This directory contains ingestors. A ingestor is a script that ingests data from a specific source into the RAG system. Ingestors can be scheduled to run at regular intervals to keep data up-to-date.

## Current Ingestors

### Web Loader

This is a default web page ingestor that can crawl sitemaps and ingest web pages. This is included by default when you set up the RAG system. Since its triggered via Web UI, it is more tightly integrated with the Server and Redis job management system.

### Dummy Graph Ingestor

This is a sample ingestor that creates dummy graph entities for testing purposes. It demonstrates how to create graph nodes in the RAG system.

### Backstage Ingestor

Ingests entities from a Backstage catalog into the RAG system as graph entities. Fetches all catalog entities with pagination support and converts them to searchable entities with proper metadata.

**Required Environment Variables:**
- `BACKSTAGE_URL` - Base URL of your Backstage API (e.g., `https://backstage.example.com`)
- `BACKSTAGE_API_TOKEN` - Authentication token for Backstage API access
- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)

**Optional Environment Variables:**
- `IGNORE_TYPES` - Comma-separated list of entity kinds to skip (default: `template,api,resource`)
- `SYNC_INTERVAL` - Sync interval in seconds (default: `900` = 15 minutes)
- `INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

**Run using docker compose (make sure server is up and running):**
```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export BACKSTAGE_URL=<your-backstage-url>
export BACKSTAGE_API_TOKEN=<your-backstage-token> 
docker compose --profile backstage up --build backstage_ingestor
```

### AWS Ingestor

Ingests AWS resources as graph entities into the RAG system. Discovers and ingests various AWS resources across all regions including EC2 instances, S3 buckets, RDS databases, Lambda functions, and more.

**Supported Resource Types:**
- `iam:user` - IAM Users
- `ec2:instance` - EC2 Instances
- `ec2:volume` - EBS Volumes
- `ec2:natgateway` - NAT Gateways
- `ec2:vpc` - VPCs
- `ec2:subnet` - Subnets
- `ec2:security-group` - Security Groups
- `eks:cluster` - EKS Clusters
- `s3:bucket` - S3 Buckets
- `elasticloadbalancing:loadbalancer` - Load Balancers (ALB/NLB/CLB)
- `route53:hostedzone` - Route53 Hosted Zones
- `rds:db` - RDS Database Instances
- `lambda:function` - Lambda Functions
- `dynamodb:table` - DynamoDB Tables

**Required Environment Variables:**
- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)

**AWS Authentication (choose one method):**

*Option 1: Use existing AWS CLI configuration (recommended)*
- Ensure `~/.aws/config` and `~/.aws/credentials` are configured
- Optionally set `AWS_PROFILE` to use a specific profile

*Option 2: Use explicit credentials*
- `AWS_ACCESS_KEY_ID` - AWS access key ID for authentication
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key for authentication
- `AWS_SESSION_TOKEN` - AWS session token (for temporary credentials, optional)

**Optional Environment Variables:**
- `AWS_PROFILE` - AWS profile to use from ~/.aws/credentials (if using config files)
- `AWS_REGION` or `AWS_DEFAULT_REGION` - Default AWS region (default: `us-east-2`)
- `AWS_RESOURCE_TYPES` - Comma-separated list of resource types to ingest (default: all supported types)
- `AWS_SYNC_INTERVAL` - Sync interval in seconds (default: `900` = 15 minutes)
- `AWS_INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

**Run using docker compose (make sure server is up and running):**

*Using existing AWS configuration:*
```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
# Optional: export AWS_PROFILE=my-profile
docker compose --profile aws up --build aws_ingestor
```

*Using explicit credentials:*
```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export AWS_ACCESS_KEY_ID=<your-aws-access-key-id>
export AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key>
# Optional: export AWS_SESSION_TOKEN=<your-session-token>
# Optional: export AWS_RESOURCE_TYPES="ec2:instance,s3:bucket,rds:db"
docker compose --profile aws up --build aws_ingestor
```

**Note:** The AWS ingestor automatically uses your AWS configuration from `~/.aws/` or environment variables. It requires appropriate IAM permissions to describe/list resources. Recommended permissions include:
- Read access to Resource Groups Tagging API (`tag:GetResources`)
- Describe permissions for all resource types you want to ingest (EC2, S3, RDS, Lambda, DynamoDB, etc.)
- IAM read permissions for user listing (`iam:ListUsers`)
- Route53 read permissions for hosted zones (`route53:GetHostedZone`, `route53:ListHostedZones`)
- STS permissions to get account ID (`sts:GetCallerIdentity`)

### Kubernetes (K8s) Ingestor

Ingests Kubernetes resources as graph entities into the RAG system. Discovers and ingests both standard Kubernetes resources and Custom Resource Definitions (CRDs) from your cluster.

**Supported Resource Types (configurable):**
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

**Required Environment Variables:**
- `CLUSTER_NAME` - Name of your Kubernetes cluster (used for entity identification)
- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)

**Kubernetes Authentication (choose one method):**

*Option 1: In-Cluster Configuration (running inside a Kubernetes pod)*
- Set `IN_CLUSTER=true`
- Uses ServiceAccount credentials automatically
- No kubeconfig file needed

*Option 2: Custom Kubeconfig File*
- Set `KUBECONFIG=/path/to/kubeconfig` to specify a custom kubeconfig file
- Optionally set `KUBE_CONTEXT=my-context` to use a specific context
- If `KUBE_CONTEXT` is not set, the current context from the kubeconfig will be used

*Option 3: Default Kubeconfig (~/.kube/config)*
- Don't set `KUBECONFIG` or `IN_CLUSTER`
- Optionally set `KUBE_CONTEXT=my-context` to use a specific context
- Uses `~/.kube/config` by default

**Optional Environment Variables:**
- `KUBE_CONTEXT` - Specific kubeconfig context to use (works with any kubeconfig source)
- `K8S_RESOURCE_LIST` - Comma-separated list of Kubernetes resource kinds to ingest 
- `K8S_IGNORE_FIELD_LIST` - Comma-separated list of field prefixes to exclude from ingested entities
- `K8S_SYNC_INTERVAL` - Sync interval in seconds (default: `900` = 15 minutes)
- `K8S_INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

**Run using docker compose (make sure server is up and running):**

*Using default kubeconfig:*
```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export K8S_CLUSTER_NAME=my-cluster
docker compose --profile k8s up --build k8s_ingestor
```

*Using specific context:*
```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export K8S_CLUSTER_NAME=my-cluster
export KUBE_CONTEXT=prod-cluster
docker compose --profile k8s up --build k8s_ingestor
```

*Using custom kubeconfig:*
```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export K8S_CLUSTER_NAME=my-cluster
export KUBECONFIG=/path/to/my/kubeconfig
# Optional: export KUBE_CONTEXT=my-context
docker compose --profile k8s up --build k8s_ingestor
```

*Running with EKS clusters (requires AWS authentication):*

EKS clusters use AWS IAM for authentication, which requires the AWS CLI to be available in the container. To run the K8s ingestor with EKS:

1. Create a `docker-compose.override.yaml` file:
   ```yaml
    services:
    k8s_ingestor:
        volumes:
        # Mount AWS credentials for EKS authentication
        - ~/.aws:/home/app/.aws:ro
        # Mount AWS CLI if you want to use host's installation
        - /usr/local/aws-cli:/usr/local/aws-cli:ro
        environment:
        # Add AWS CLI to PATH if mounting from host
        - PATH=/usr/local/aws-cli/v2/current/bin:/app/ingestors/.venv/bin:/usr/local/bin:/usr/bin:/bin
   ```

2. Run the ingestor:
   ```bash
   export RAG_SERVER_URL=http://host.docker.internal:9446
   export K8S_CLUSTER_NAME=my-eks-cluster
   export KUBE_CONTEXT=my-eks-context  # The context that uses AWS authentication
   docker compose --profile k8s up --build k8s_ingestor
   ```

**Important for EKS users:** The container needs access to your AWS credentials (`~/.aws/` directory) because EKS kubeconfig files use `aws eks get-token` commands for authentication. Make sure your AWS profile has the necessary EKS permissions.

*Running in-cluster (deploy as a Kubernetes pod):*
```bash
# In your Kubernetes deployment manifest, set:
# - IN_CLUSTER: "true"
# - CLUSTER_NAME: "your-cluster-name"
# - RAG_SERVER_URL: "http://rag-server:9446"
# No kubeconfig needed - uses ServiceAccount
```

**Note:** The K8s ingestor requires:
- Read access to your Kubernetes cluster (via kubeconfig, specific context, or in-cluster ServiceAccount)
- RBAC permissions to list and describe the resource types you want to ingest
- The `CLUSTER_NAME` environment variable must be set to identify your cluster
- Entity types are created in Pascal case format (e.g., `K8sDeployment`, `K8sService`, `K8sCustomResource`)
- When running in-cluster, ensure the ServiceAccount has proper RBAC permissions
- **For EKS clusters:** AWS credentials must be available in the container (see EKS-specific instructions above)

### Slack Ingestor

Ingests conversations from Slack channels as documents into the RAG system. Each channel becomes a datasource, and each thread (or standalone message) becomes a document. This allows the RAG system to search and retrieve relevant Slack conversations.

**Supported Features:**
- Incremental syncing (only fetches new messages since last sync)
- Thread support (messages with replies are grouped as single documents)
- Standalone message support (messages without threads)
- Configurable lookback period for initial sync
- Bot message filtering (optional)
- Slack message URLs for easy navigation back to source

**Required Environment Variables:**
- `SLACK_BOT_TOKEN` - Slack Bot User OAuth Token (starts with `xoxb-`)
- `SLACK_BOT_NAME` - Name of your Slack bot (used for ingestor identification, e.g., `mybot`)
- `SLACK_WORKSPACE_URL` - Your Slack workspace URL (e.g., `https://mycompany.slack.com`)
- `SLACK_CHANNELS` - JSON object mapping channel IDs to configuration
- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)

**SLACK_CHANNELS Format:**
```json
{
  "C1234567890": {
    "name": "general",
    "lookback_days": 30,
    "include_bots": false
  },
  "C0987654321": {
    "name": "engineering",
    "lookback_days": 90,
    "include_bots": true
  }
}
```

**Channel Configuration Options:**
- `name` - Human-readable channel name (used in document metadata)
- `lookback_days` - Number of days to look back on first sync (0 = all history)
- `include_bots` - Whether to include bot messages (default: `false`)

**Optional Environment Variables:**
- `SLACK_SYNC_INTERVAL` - Sync interval in seconds (default: `900` = 15 minutes)
- `SLACK_INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

**Setup Instructions:**

1. **Create a Slack App:**
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Name your app and select your workspace

2. **Configure OAuth & Permissions:**
   - Navigate to "OAuth & Permissions"
   - Add the following Bot Token Scopes:
     - `channels:history` - View messages in public channels
     - `channels:read` - View basic channel information
     - `groups:history` - View messages in private channels (if needed)
     - `groups:read` - View basic private channel information (if needed)
   - Install the app to your workspace
   - Copy the "Bot User OAuth Token" (starts with `xoxb-`)

3. **Invite Bot to Channels:**
   - In each channel you want to ingest, type: `/invite @YourBotName`
   - The bot must be a member of the channel to read messages

4. **Get Channel IDs:**
   - Right-click on channel name → "View channel details"
   - Scroll down to find the Channel ID
   - Or use Slack API (requires Admin/Oversight API access): `https://slack.com/api/conversations.list?token=YOUR_TOKEN`

**Run using docker compose:**

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export SLACK_BOT_TOKEN=xoxb-your-bot-token
export SLACK_BOT_NAME=mybot
export SLACK_WORKSPACE_URL=https://yourworkspace.slack.com
export SLACK_CHANNELS='{"C09TFMCA8HY":{"name":"general","lookback_days":30,"include_bots":false}}'
docker compose --profile slack up --build slack_ingestor
```

**Document Structure:**

*For threaded conversations:*
- Document ID: `slack-thread-{channel_id}-{thread_ts}`
- Title: "Thread: {first 100 chars of parent message}"
- Content: Formatted thread with all replies, timestamps, and Slack URLs
- Metadata: channel name, channel ID, thread timestamp, message count

*For standalone messages:*
- Document ID: `slack-message-{channel_id}-{ts}`
- Title: "Message: {first 100 chars of message}"
- Content: Formatted message with timestamp and Slack URL
- Metadata: channel name, channel ID, timestamp

**Note:** The Slack ingestor:
- Creates one datasource per channel (ID format: `slack-channel-{channel_id}`)
- Stores the last sync timestamp in datasource metadata for incremental updates
- Uses the workspace URL in the ingestor name for easy identification
- Automatically groups messages into threads when possible
- Requires the bot to be a member of each channel you want to ingest
- Respects Slack rate limits with automatic retry and exponential backoff

## Running Ingestors

Set environment and run:

```bash
uv sync
source ./.venv/bin/activate 
export RAG_SERVER_URL="http://localhost:9446" 
python3 src/ingestors/simple_ingestor/ingestor.py
```

## Creating a Simple Ingestor

Here's a basic ingestor that ingests some strings and manages job state:

### Prerequisites

- uv
- Python 3.8+ installed with necessary dependencies.
- Ensure you have the RAG server running and accessible.


### Setup the folder structure

```
# Replace the simple_ingestor with your ingestor name
mkdir -p src/ingestors/simple_ingestor
touch src/ingestors/simple_ingestor/ingestor.py
```

### Then add the following code to `ingestor.py`

```python
import time
import asyncio
from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.job_manager import JobStatus
from langchain_core.documents import Document

async def sync_data(client: Client):
    """Simple sync function that creates documents and ingests them"""
    
    # 1. Create datasource first
    
    # Create a unique but deterministic datasource ID based on what is being ingested e.g. sitemap URL, folder name etc.
    datasource_id = "simple-datasource"
    datasource = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description="Simple test datasource",
        source_type="documents",
        last_updated=int(time.time())
    )
    await client.upsert_datasource(datasource)
    
    # 2. Create some sample documents from simple strings
    document_texts = [
        "This is the first sample document with some interesting content about AI.",
        "Here's another document discussing machine learning and data processing.",
        "A third document containing information about natural language processing."
    ]
    
    # Convert strings to Document objects with proper metadata
    documents = []
    for i, text in enumerate(document_texts):
        # Create DocumentMetadata with proper structure
        doc_metadata = DocumentMetadata(
            document_id=f"doc_{i+1}", # Define a unique but deterministic document ID - e.g. url, file path, etc.
            document_type="text",
            datasource_id=datasource_id,
            ingestor_id=client.ingestor_id or "",
            title=f"Sample Document {i+1}",
            description=f"Simple test document {i+1}",
            fresh_until=None,  # Use default freshness
            metadata={"source": "simple_ingestor"}
        )
        
        doc = Document(
            page_content=text,
            metadata=doc_metadata.model_dump()
        )
        documents.append(doc)
    
    # 3. Create a new job for this ingestion
    job_response = await client.create_job(
        datasource_id=datasource_id,
        job_status=JobStatus.IN_PROGRESS,
        message="Starting simple document ingestion",
        total=len(documents)
    )
    job_id = job_response["job_id"]
    
    try:
        # 4. Ingest documents (automatic batching)
        await client.ingest_documents(job_id, datasource_id, documents)
        
        # 5. Mark job as completed
        await client.update_job(
            job_id=job_id,
            job_status=JobStatus.COMPLETED,
            message=f"Successfully ingested {len(documents)} documents"
        )
        
    except Exception as e:
        # Handle failure - add error messages and mark as failed
        await client.add_job_error(job_id, [str(e)])
        await client.update_job(
            job_id=job_id,
            job_status=JobStatus.FAILED,
            message=f"Ingestion failed: {e}"
        )
        raise

# Run the ingestor
if __name__ == "__main__":
    IngestorBuilder()\
        .name("simple-ingestor")\
        .type("example")\
        .sync_with_fn(sync_data)\
        .every(300)\
        .run()
```