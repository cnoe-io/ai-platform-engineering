# LangGraph Persistence Quick Start

## 🚀 Quick Commands

### Switch Backend
```bash
# Redis (fast, in-memory)
./skills/persistence/switch_backend.sh redis

# PostgreSQL (durable, SQL)
./skills/persistence/switch_backend.sh postgres

# MongoDB (flexible, document-based)
./skills/persistence/switch_backend.sh mongodb
```

### Test Current Backend
```bash
# Shell script (detailed output)
./skills/persistence/test_persistence_all_backends.sh redis

# Python script (programmatic)
python skills/persistence/test_langgraph_persistence.py redis
```

### Monitor Fact Extraction
```bash
# Real-time logs
docker logs -f caipe-supervisor 2>&1 | grep -i "fact extraction"

# Check extracted facts
docker exec langgraph-redis redis-cli --scan --pattern "*memories*"
```

## 📊 Current Status

Check what's running:
```bash
# See active containers
docker ps | grep langgraph

# Check current backend config
grep "^LANGGRAPH_CHECKPOINT_TYPE=" .env
grep "^LANGGRAPH_STORE_TYPE=" .env

# Verify fact extraction is enabled
grep "^ENABLE_FACT_EXTRACTION=" .env
```

## 🔍 View Extracted Facts

### Redis
```bash
# Count facts
docker exec langgraph-redis redis-cli DBSIZE

# View all fact keys
docker exec langgraph-redis redis-cli --scan --pattern "store:*" | head -10

# View specific fact (pretty printed)
docker exec langgraph-redis redis-cli JSON.GET "store:01KK1VSWAPFXQHCHAAWDGFQCKS" | jq
```

### PostgreSQL
```bash
# Count facts
docker exec langgraph-postgres psql -U langgraph -d langgraph -c "SELECT COUNT(*) FROM store;"

# View facts
docker exec langgraph-postgres psql -U langgraph -d langgraph -c \
  "SELECT namespace[2] as user, value->>'content' as content FROM store WHERE namespace[1] = 'memories' LIMIT 5;"
```

### MongoDB
```bash
# Count facts
docker exec langgraph-mongodb mongosh --quiet langgraph --eval "db.store.countDocuments()"

# View facts
docker exec langgraph-mongodb mongosh --quiet langgraph --eval \
  "db.store.find({'namespace.0': 'memories'}).limit(5).pretty()"
```

## 🧪 Testing Fact Extraction

1. **Open CAIPE UI**: http://localhost:3000

2. **Start a conversation** and share facts:
   ```
   "I work on the DevOps team at Acme Corp.
   My primary cluster is eks-prod-us-east-1.
   I prefer JSON output format and concise responses."
   ```

3. **Check if facts were extracted**:
   ```bash
   ./skills/persistence/test_persistence_all_backends.sh redis
   ```

4. **View your facts**:
   ```bash
   # Replace with your email
   docker exec langgraph-redis redis-cli --scan --pattern "*memories*your_email*"
   ```

## 🔧 Troubleshooting

### Container won't start
```bash
# Check logs
docker logs langgraph-redis
docker logs langgraph-postgres
docker logs langgraph-mongodb

# Restart with fresh data
docker compose -f docker-compose.dev.yaml down -v
./skills/persistence/switch_backend.sh redis
```

### No facts being extracted
```bash
# 1. Check if enabled
docker exec caipe-supervisor env | grep ENABLE_FACT_EXTRACTION

# 2. Check supervisor logs for errors
docker logs caipe-supervisor 2>&1 | tail -50

# 3. Verify store is configured
docker exec caipe-supervisor env | grep LANGGRAPH_STORE
```

### Can't connect to backend
```bash
# Check network
docker network ls | grep ai-platform

# Test connection manually
docker exec caipe-supervisor ping langgraph-redis -c 2
docker exec caipe-supervisor ping langgraph-postgres -c 2
docker exec caipe-supervisor ping langgraph-mongodb -c 2
```

## 📈 Performance Comparison

| Backend    | Speed | Durability | Complexity | Best For |
|------------|-------|------------|------------|----------|
| Redis      | ⚡⚡⚡ | ⚠️          | ✅          | Dev/Testing, Fast iterations |
| PostgreSQL | ⚡⚡   | ✅✅✅       | ⚡⚡         | Production, ACID requirements |
| MongoDB    | ⚡⚡   | ✅✅         | ⚡          | Flexible schemas, Document queries |
| **Mixed**  | ⚡⚡   | ✅✅         | ⚡          | **Recommended**: share UI MongoDB for checkpoints, dedicated Redis for semantic search |

### Mixed Backend: MongoDB Checkpointer + Redis Store

The recommended production configuration uses MongoDB for the checkpointer (conversation state) and Redis for the store (fact extraction with semantic search). This avoids deploying a separate database for checkpoints when the UI already uses MongoDB.

```bash
# Test mixed backend
./skills/persistence/test_persistence_all_backends.sh mixed

# Start with mixed backend
COMPOSE_PROFILES="caipe-supervisor,...,caipe-mongodb,langgraph-redis" \
  docker compose -f docker-compose.dev.yaml up -d
```

**.env configuration:**
```bash
# Checkpointer: MongoDB (shared with UI)
LANGGRAPH_CHECKPOINT_TYPE=mongodb
LANGGRAPH_CHECKPOINT_MONGODB_URI=mongodb://admin:changeme@caipe-mongodb:27017/caipe?authSource=admin
LANGGRAPH_CHECKPOINT_MONGODB_DB_NAME=caipe
LANGGRAPH_CHECKPOINT_MONGODB_COLLECTION=conversation_checkpoints
LANGGRAPH_CHECKPOINT_MONGODB_WRITES_COLLECTION=conversation_checkpoint_writes

# Store: Redis (dedicated, supports semantic search)
LANGGRAPH_STORE_TYPE=redis
LANGGRAPH_STORE_REDIS_URL=redis://langgraph-redis:6379
```

**Benchmark results (2026-03-19):**

| Metric | Value |
|--------|-------|
| Checkpoints (MongoDB) | 117 |
| Checkpoint writes (MongoDB) | 235 |
| Conversation threads | 4 |
| Extracted facts (Redis) | 27 |
| Users with facts | 1 |
| Fact extraction latency | ~3s per turn |

## 🎯 Common Workflows

### Development
```bash
# Use Redis for fast iteration
./skills/persistence/switch_backend.sh redis

# Test fact extraction
# (have conversations via UI)

# Verify facts
./skills/persistence/test_persistence_all_backends.sh redis
```

### Pre-Production Testing (Mixed Backend)
```bash
# Use MongoDB checkpointer + Redis store
./skills/persistence/test_persistence_all_backends.sh mixed
```

### Production Deployment
```bash
# Update .env with production credentials
# Use external managed services (Atlas MongoDB, ElastiCache Redis)

# Test connection
./skills/persistence/test_persistence_all_backends.sh mixed
```

## 📚 More Information

See [README.md](./README.md) for detailed documentation.
