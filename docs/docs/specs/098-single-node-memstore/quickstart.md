# Quickstart: Single-Node Persistent Memory Store

**Feature**: 098-single-node-memstore

## Enabling Persistent Checkpointing

Set environment variables before starting the single-node agent:

```bash
# MongoDB checkpoint persistence
export LANGGRAPH_CHECKPOINT_TYPE=mongodb
export MONGODB_URI=mongodb://localhost:27017

# Or Redis checkpoint persistence
export LANGGRAPH_CHECKPOINT_TYPE=redis
export LANGGRAPH_CHECKPOINT_REDIS_URL=redis://localhost:6379
```

No code changes required. The agent automatically uses the configured backend.

## Enabling Cross-Thread Memory Store

```bash
# Redis store for cross-thread memory (recommended — supports semantic search)
export LANGGRAPH_STORE_TYPE=redis
export REDIS_URL=redis://localhost:6379

# Enable fact extraction
export ENABLE_FACT_EXTRACTION=true

# Optional: configure embeddings for semantic memory search
export EMBEDDINGS_PROVIDER=openai
export EMBEDDINGS_MODEL=text-embedding-3-small
```

## Verifying Configuration

After starting the agent, check logs for:

```
LangGraph Checkpointer: <backend> configured (...)
LangGraph Store: <backend> store configured (...)
Cross-thread store attached to deep agent
```

## Default Behavior (No Configuration)

When no persistence environment variables are set:
- Checkpointer: `InMemorySaver` (state lost on restart)
- Store: `InMemoryStore` (facts lost on restart)
- Fact extraction: Disabled unless `ENABLE_FACT_EXTRACTION=true`

This matches the pre-change behavior exactly.

## Testing Locally

```bash
# Start MongoDB for checkpointing
docker compose -f docker-compose.dev.yaml up -d mongodb

# Start Redis for memory store
docker compose -f docker-compose.dev.yaml up -d redis

# Run tests
make test
```
