# Grafana Agent Testing Guide

## Local Testing with Docker Compose

### Prerequisites

1. **Grafana Instance**: Access to a Grafana instance with API key
2. **Environment Variables**: Configure in `.env` file

### Setup

1. **Create `.env` file** from template:
   ```bash
   cp .env.example .env
   ```

2. **Configure Grafana credentials** in `.env`:
   ```bash
   # Grafana Configuration
   GRAFANA_URL=https://your-grafana-instance.com
   GRAFANA_API_KEY=your-api-key-here

   # LLM Provider (choose one)
   LLM_PROVIDER=aws-bedrock
   AWS_BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
   AWS_REGION=us-east-1
   ```

3. **Build the Grafana agent image** (optional, for local development):
   ```bash
   # From repository root
   docker build -t ghcr.io/cnoe-io/agent-grafana:local \
     -f ai_platform_engineering/agents/grafana/Dockerfile .
   ```

### Running with Docker Compose

#### Option 1: SLIM Profile (Recommended)

```bash
# Start with SLIM dataplane
docker-compose --profile slim up -d

# Verify services are running
docker-compose ps | grep grafana

# Check logs
docker-compose logs -f agent-grafana-slim
docker-compose logs -f mcp-grafana
```

#### Option 2: P2P Profile

```bash
# Start with P2P
docker-compose --profile p2p up -d

# Verify services
docker-compose ps | grep grafana

# Check logs
docker-compose logs -f agent-grafana-p2p
docker-compose logs -f mcp-grafana
```

### Testing the Agent

#### 1. Verify MCP Server is Running

```bash
# Check MCP server health
curl http://localhost:18012/health

# Or from another container
docker-compose exec agent-grafana-slim curl http://mcp-grafana:8000/health
```

#### 2. Test Agent Endpoint

```bash
# Agent is available on port 8012
curl http://localhost:8012/health
```

#### 3. Test with A2A Client

```bash
# Install A2A chat CLI
uvx https://github.com/cnoe-io/agent-chat-cli.git a2a \
  --host localhost --port 8012

# Test queries:
# - "show me my dashboards"
# - "what alerts are firing?"
# - "query prometheus for cpu usage"
```

### Troubleshooting

#### MCP Server Connection Issues

```bash
# Check MCP server logs
docker-compose logs mcp-grafana

# Verify MCP server can reach Grafana
docker-compose exec mcp-grafana curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  $GRAFANA_URL/api/health
```

#### Agent Cannot Connect to MCP

```bash
# Check agent logs
docker-compose logs agent-grafana-slim

# Verify DNS resolution
docker-compose exec agent-grafana-slim ping mcp-grafana

# Check environment variables
docker-compose exec agent-grafana-slim env | grep MCP
```

#### Invalid Grafana Credentials

```bash
# Test API key manually
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  $GRAFANA_URL/api/dashboards/home

# Should return dashboard data, not 401/403
```

### Cleanup

```bash
# Stop all services
docker-compose down

# Remove volumes
docker-compose down -v
```

## Kubernetes Testing

### Deploy with Helm

```bash
# From repository root
helm install ai-platform-engineering ./charts/ai-platform-engineering \
  --set tags.agent-grafana=true \
  --set agent-grafana.enabled=true \
  --set-file agent-grafana.secrets.GRAFANA_API_KEY=<(echo -n "your-api-key") \
  --set agent-grafana.env.GRAFANA_URL=https://your-grafana.com
```

### Verify Deployment

```bash
# Check pods
kubectl get pods -l app.kubernetes.io/name=agent-grafana

# Check MCP server
kubectl get pods -l app.kubernetes.io/name=mcp-grafana

# Check service
kubectl get svc mcp-grafana

# Test connectivity from agent to MCP
kubectl exec -it deployment/agent-grafana -- \
  curl http://mcp-grafana:8000/health
```

### View Logs

```bash
# Agent logs
kubectl logs -f deployment/agent-grafana

# MCP server logs
kubectl logs -f deployment/mcp-grafana

# Follow both
kubectl logs -f deployment/agent-grafana & \
kubectl logs -f deployment/mcp-grafana
```

## Integration Testing

### Test with Supervisor Agent

```bash
# Start full stack with supervisor
docker-compose --profile slim up -d

# Connect via supervisor (port 8000)
uvx https://github.com/cnoe-io/agent-chat-cli.git a2a \
  --host localhost --port 8000

# Test routing to Grafana agent:
# - "check grafana dashboards"
# - "show me firing alerts in grafana"
```

## Common Test Scenarios

### 1. Dashboard Search
```
Query: "show me all dashboards with 'kubernetes' in the name"
Expected: List of matching dashboards with links
```

### 2. Alert Status
```
Query: "what alerts are currently firing?"
Expected: List of active alerts with status and links
```

### 3. Prometheus Query
```
Query: "query prometheus for node_cpu_seconds_total"
Expected: Metric data from Prometheus datasource
```

### 4. Dashboard Details
```
Query: "get details for dashboard xyz123"
Expected: Dashboard metadata, panels, and variables
```

## Performance Testing

### Load Test MCP Server

```bash
# Simple load test
for i in {1..100}; do
  curl http://localhost:18012/health &
done
wait
```

### Monitor Resource Usage

```bash
# Container stats
docker stats agent-grafana-slim mcp-grafana

# In Kubernetes
kubectl top pods -l app.kubernetes.io/name=agent-grafana
kubectl top pods -l app.kubernetes.io/name=mcp-grafana
```

## Next Steps

- [ ] Add integration tests
- [ ] Create E2E test scenarios
- [ ] Set up CI/CD testing pipeline
- [ ] Add performance benchmarks
