---
sidebar_position: 5
---

# Persistence

By default, the supervisor agent uses **in-memory** storage for both conversation checkpoints and cross-thread memory. State is lost when the pod or container restarts.

This page explains how to enable durable persistence and, optionally, automatic fact extraction.

## Concepts

| Concept | What it stores | Default |
|---|---|---|
| **Checkpoint** | In-thread conversation state (messages, tool calls) | In-memory |
| **Memory store** | Cross-thread facts and summaries about each user | In-memory |
| **Fact extraction** | Automatically extracts facts from conversations and saves them to the store | Disabled |

Supported backends: **Redis Stack** (recommended), **PostgreSQL**, **MongoDB**.

---

## Option 1 — In-memory (default, no action required)

State is stored in-process. No external service is needed. Everything resets on restart.

This is the default. No configuration is required.

---

## Option 2 — Redis persistence

Conversation checkpoints and cross-thread memories survive pod/container restarts.

### Helm

Add the following to your `values.yaml`:

```yaml
global:
  langgraphRedis:
    enabled: true          # deploy the bundled Redis Stack subchart

supervisor-agent:
  checkpointPersistence:
    type: redis
    redis:
      autoDiscoverService: langgraph-redis   # auto-builds redis://<release>-langgraph-redis:6379/0

  memoryPersistence:
    type: redis
    redis:
      autoDiscoverService: langgraph-redis
```

Or use the `--persistence` flag with `setup-caipe.sh`:

```bash
# Interactive — prompts "Enable Redis persistence?"
./setup-caipe.sh

# Non-interactive
./setup-caipe.sh --non-interactive --persistence

# With RAG stack
./setup-caipe.sh --non-interactive --rag --persistence
```

### Docker Compose

Add to your `.env`:

```bash
LANGGRAPH_CHECKPOINT_TYPE=redis
LANGGRAPH_CHECKPOINT_REDIS_URL=redis://langgraph-redis:6379
LANGGRAPH_STORE_TYPE=redis
LANGGRAPH_STORE_REDIS_URL=redis://langgraph-redis:6379
```

Then start with the `langgraph-redis` profile:

```bash
docker compose -f docker-compose.dev.yaml --profile langgraph-redis up
```

Or use the `switch_backend.sh` helper:

```bash
./skills/persistence/switch_backend.sh redis
```

---

## Option 3 — Redis persistence + fact extraction

Same as Option 2, plus the supervisor automatically extracts facts from every conversation turn and stores them for future cross-thread recall.

> **Note:** Fact extraction makes one additional LLM call per conversation turn. Ensure your LLM endpoint has sufficient capacity.

### Helm

```yaml
global:
  langgraphRedis:
    enabled: true

supervisor-agent:
  checkpointPersistence:
    type: redis
    redis:
      autoDiscoverService: langgraph-redis

  memoryPersistence:
    type: redis
    redis:
      autoDiscoverService: langgraph-redis
    enableFactExtraction: true   # extract facts from every conversation turn
    maxMemories: 50              # max facts recalled per cross-thread query (default: 50)
    maxSummaries: 10             # max summaries recalled per cross-thread query (default: 10)
```

### Docker Compose

Add to your `.env`:

```bash
LANGGRAPH_CHECKPOINT_TYPE=redis
LANGGRAPH_CHECKPOINT_REDIS_URL=redis://langgraph-redis:6379
LANGGRAPH_STORE_TYPE=redis
LANGGRAPH_STORE_REDIS_URL=redis://langgraph-redis:6379
ENABLE_FACT_EXTRACTION=true
```

Then start with the `langgraph-redis` profile:

```bash
docker compose -f docker-compose.dev.yaml --profile langgraph-redis up
```

---

## Bring your own Redis (BYO)

If you already have a Redis Stack instance (e.g. AWS ElastiCache for Redis, an existing in-cluster Redis), skip `global.langgraphRedis.enabled` and point directly at your instance.

> **Requirement:** Redis Stack with RedisJSON and RediSearch modules is required. Plain Redis without these modules will not work.

### Helm — direct URL

```yaml
supervisor-agent:
  checkpointPersistence:
    type: redis
    redis:
      url: "redis://my-redis.example.com:6379/0"

  memoryPersistence:
    type: redis
    redis:
      url: "redis://my-redis.example.com:6379/0"
```

### Helm — from a Kubernetes Secret (recommended for credentials)

```yaml
supervisor-agent:
  checkpointPersistence:
    type: redis
    redis:
      existingSecret:
        name: my-redis-secret
        key: REDIS_URL

  memoryPersistence:
    type: redis
    redis:
      existingSecret:
        name: my-redis-secret
        key: REDIS_URL
```

---

## Reusing the RAG Redis

The RAG stack includes its own Redis (`rag-redis`). You can reuse it for persistence by setting `autoDiscoverService: rag-redis` and using a separate DB index to avoid collision with RAG data.

> **Requirement:** The RAG Redis image must be `redis:8.0+` (includes RedisJSON and RediSearch natively). The default `redis:7.2-alpine` image does not include these modules.

```yaml
supervisor-agent:
  checkpointPersistence:
    type: redis
    redis:
      autoDiscoverService: rag-redis
      dbIndex: 1    # db 0 is used by RAG data

  memoryPersistence:
    type: redis
    redis:
      autoDiscoverService: rag-redis
      dbIndex: 1
```

---

## Full configuration reference

```yaml
supervisor-agent:
  memoryPersistence:
    type: "memory"            # memory | redis | postgres | mongodb
    redis:
      url: ""                 # direct URL
      existingSecret:         # pull URL from a Kubernetes Secret
        name: ""
        key: ""
      autoDiscoverService: "" # "langgraph-redis" or "rag-redis"
      dbIndex: 0
      keyPrefix: ""           # namespace prefix for shared Redis
    postgres:
      dsn: ""
      existingSecret:
        name: ""
        key: ""
    mongodb:
      uri: ""
      existingSecret:
        name: ""
        key: ""
    embeddings:
      provider: ""            # openai | azure-openai | litellm
      model: ""               # e.g. text-embedding-3-small
      dims: ""                # auto-detected for known models
    ttlMinutes: 10080         # 7 days; 0 = no expiry
    enableFactExtraction: false
    maxMemories: 50
    maxSummaries: 10

  checkpointPersistence:
    type: "memory"            # memory | redis | postgres | mongodb
    redis:
      url: ""
      existingSecret:
        name: ""
        key: ""
      autoDiscoverService: ""
      dbIndex: 0
    postgres:
      dsn: ""
      existingSecret:
        name: ""
        key: ""
    mongodb:
      uri: ""
      existingSecret:
        name: ""
        key: ""
    ttlMinutes: 0             # 0 = no expiry

global:
  langgraphRedis:
    enabled: false            # set true to deploy the bundled Redis Stack subchart
```
