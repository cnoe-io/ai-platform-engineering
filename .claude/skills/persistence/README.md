# LangGraph Persistence & Fact Extraction Testing

This directory contains scripts for testing LangGraph persistence backends (Redis, PostgreSQL, MongoDB) and fact extraction functionality.

## Scripts

### 1. `validate_agent_checkpoints.sh`

Validates per-agent MongoDB checkpoint isolation for all 15 agents + supervisor.

**Usage:**
```bash
# Validate all agents
./skills/persistence/validate_agent_checkpoints.sh

# Validate specific agents
./skills/persistence/validate_agent_checkpoints.sh aws jira argocd
```

**What it checks:**
- Each agent container is running
- Auto-prefix log present (per-agent collection names)
- MongoDB collections exist with checkpoint documents
- InMemorySaver fallback detection
- Cross-contamination: shared `thread_id` values across agent collections
- Pass/fail/warn summary with exit code

### 2. `test_persistence_all_backends.sh`

Shell script to test persistence backends and verify data storage.

**Usage:**
```bash
# Test Redis
./skills/persistence/test_persistence_all_backends.sh redis

# Test PostgreSQL
./skills/persistence/test_persistence_all_backends.sh postgres

# Test MongoDB
./skills/persistence/test_persistence_all_backends.sh mongodb
```

**What it checks:**
- Container health and connectivity
- Total stored items (checkpoints + facts)
- Sample checkpoint keys
- Sample extracted facts with content
- Supervisor configuration

### 3. `switch_backend.sh`

Automates switching between persistence backends by updating `.env` and restarting containers.

**Usage:**
```bash
# Switch to Redis
./skills/persistence/switch_backend.sh redis

# Switch to PostgreSQL
./skills/persistence/switch_backend.sh postgres

# Switch to MongoDB
./skills/persistence/switch_backend.sh mongodb
```

**What it does:**
1. Stops current docker-compose stack
2. Updates `.env` file with new backend configuration
3. Starts containers with the appropriate profile
4. Runs tests to verify the new backend

### 4. `test_langgraph_persistence.py`

Python script for programmatic testing of persistence backends.

**Usage:**
```bash
# Test Redis
python skills/persistence/test_langgraph_persistence.py redis

# Test PostgreSQL (requires asyncpg)
python skills/persistence/test_langgraph_persistence.py postgres

# Test MongoDB (requires motor)
python skills/persistence/test_langgraph_persistence.py mongodb
```

**Requirements:**
```bash
# For Redis testing
pip install redis

# For PostgreSQL testing
pip install asyncpg

# For MongoDB testing
pip install motor
```

**Features:**
- Async/await architecture
- Detailed connection testing
- Fact extraction verification
- User-specific fact queries
- Summary statistics

## Configuration

### Environment Variables (`.env`)

The scripts expect one of the following backend configurations:

#### Redis
```bash
LANGGRAPH_CHECKPOINT_TYPE=redis
LANGGRAPH_CHECKPOINT_REDIS_URL=redis://langgraph-redis:6379
LANGGRAPH_STORE_TYPE=redis
LANGGRAPH_STORE_REDIS_URL=redis://langgraph-redis:6379
```

#### PostgreSQL
```bash
LANGGRAPH_CHECKPOINT_TYPE=postgres
LANGGRAPH_CHECKPOINT_POSTGRES_DSN=postgresql://langgraph:langgraph@langgraph-postgres:5432/langgraph
LANGGRAPH_STORE_TYPE=postgres
LANGGRAPH_STORE_POSTGRES_DSN=postgresql://langgraph:langgraph@langgraph-postgres:5432/langgraph
```

#### MongoDB
```bash
LANGGRAPH_CHECKPOINT_TYPE=mongodb
LANGGRAPH_CHECKPOINT_MONGODB_URI=mongodb://langgraph-mongodb:27017
LANGGRAPH_STORE_TYPE=mongodb
LANGGRAPH_STORE_MONGODB_URI=mongodb://langgraph-mongodb:27017
```

### Docker Compose Profiles

Start containers with the appropriate profile:

```bash
# Redis
IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-redis" docker compose -f docker-compose.dev.yaml up -d

# PostgreSQL
IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-postgres" docker compose -f docker-compose.dev.yaml up -d

# MongoDB
IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-mongodb" docker compose -f docker-compose.dev.yaml up -d
```

## Fact Extraction

Fact extraction is controlled by the `ENABLE_FACT_EXTRACTION` environment variable:

```bash
# Enable automatic fact extraction
ENABLE_FACT_EXTRACTION=true

# Optionally specify a different model for extraction
# FACT_EXTRACTION_MODEL=gpt-4o-mini
```

### What Facts Are Extracted?

The system automatically extracts and persists:
- **Infrastructure details**: Clusters, namespaces, tools in use
- **User preferences**: Response style, output format preferences
- **Team/project context**: Team names, project names, environments
- **Recurring patterns**: Frequently accessed resources, common tasks

### Viewing Extracted Facts

#### Redis
```bash
# List all fact keys
docker exec langgraph-redis redis-cli --scan --pattern "store:*"

# View a specific fact
docker exec langgraph-redis redis-cli JSON.GET "store:01KK1VSWAPFXQHCHAAWDGFQCKS" | jq
```

#### PostgreSQL
```bash
# Query facts
docker exec langgraph-postgres psql -U langgraph -d langgraph -c \
  "SELECT namespace, value->>'content' as content FROM store WHERE namespace[1] = 'memories' LIMIT 10;"
```

#### MongoDB
```bash
# Query facts
docker exec langgraph-mongodb mongosh --quiet langgraph --eval \
  "db.store.find({'namespace.0': 'memories'}).pretty()"
```

## Testing Workflow

### 1. Test Current Backend
```bash
# Check which backend is active
grep "^LANGGRAPH_CHECKPOINT_TYPE=" .env

# Run tests
./scripts/test_persistence_all_backends.sh redis  # or postgres/mongodb
```

### 2. Switch to Different Backend
```bash
# Switch and test automatically
./scripts/switch_backend.sh postgres
```

### 3. Monitor Fact Extraction in Real-Time
```bash
# Watch supervisor logs
docker logs -f caipe-supervisor 2>&1 | grep -i "fact extraction"
```

### 4. Verify Data Persistence
```bash
# Have a conversation via CAIPE UI (http://localhost:3000)
# Share some facts about yourself

# Run tests to see extracted facts
./scripts/test_persistence_all_backends.sh postgres
```

## Troubleshooting

### Container Not Running
```bash
# Check containers
docker ps | grep langgraph

# Start with correct profile
IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-redis" docker compose -f docker-compose.dev.yaml up -d
```

### No Facts Extracted
```bash
# Check if fact extraction is enabled
docker exec caipe-supervisor env | grep ENABLE_FACT_EXTRACTION

# Check supervisor logs for errors
docker logs caipe-supervisor 2>&1 | grep -i "fact\|memory\|error"
```

### Connection Errors
```bash
# Check network connectivity
docker network inspect ai-platform-engineering-langgraph-redis-persistence_default

# Verify environment variables
docker exec caipe-supervisor env | grep LANGGRAPH
```

## Integration with Tests

These scripts can be integrated into automated tests:

```python
# In your pytest test
import subprocess

def test_redis_persistence():
    result = subprocess.run(
        ["python", "scripts/test_langgraph_persistence.py", "redis"],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0
    assert "Checkpoints:" in result.stdout
```

## Additional Resources

- [LangGraph Persistence Documentation](https://langchain-ai.github.io/langgraph/concepts/persistence/)
- [LangMem (Fact Extraction)](https://github.com/langchain-ai/langmem)
- [Redis Stack JSON](https://redis.io/docs/stack/json/)
- [PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html)
- [MongoDB Documents](https://www.mongodb.com/docs/manual/core/document/)
