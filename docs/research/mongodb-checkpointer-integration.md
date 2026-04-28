# MongoDBSaver Integration Plan

**Date:** 2026-03-11  
**Status:** Research Complete  
**Author:** AI Platform Engineering Team

## Overview

This document outlines the plan to replace `InMemorySaver` with `MongoDBSaver` for LangGraph checkpoint persistence. This change will enable conversation state to survive backend restarts.

## Problem Statement

Currently, both the **Dynamic Agents** and **Platform Engineer Supervisor** use `InMemorySaver` for LangGraph checkpoints:

- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py:169`
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py:385`

**Issue:** After a backend restart, the UI shows full chat history (stored in MongoDB), but the LLM has no context of previous messages because `InMemorySaver` state is lost.

## Solution: langgraph-checkpoint-mongodb

The `langgraph-checkpoint-mongodb` package (v0.3.1) provides an official MongoDB-backed checkpointer.

### Package Details

- **PyPI:** https://pypi.org/project/langgraph-checkpoint-mongodb/
- **Maintainers:** LangChain (official)
- **Python:** >=3.10
- **Dependencies:**
  - `langchain-mongodb>=0.8.0`
  - `langgraph-checkpoint>=3.0.0`
  - `pymongo>=4.12,<4.16`

### API Usage

```python
from langgraph.checkpoint.mongodb import MongoDBSaver
from pymongo import MongoClient

# Option 1: Direct instantiation (recommended for singleton pattern)
client = MongoClient("mongodb://localhost:27017")
checkpointer = MongoDBSaver(
    client=client,
    db_name="caipe",                          # Use existing database
    checkpoint_collection_name="checkpoints",  # New collection
    writes_collection_name="checkpoint_writes",# New collection  
    ttl=86400,                                 # Optional: auto-expire after 24hr
)

# Option 2: Context manager (auto-closes connection)
with MongoDBSaver.from_conn_string(MONGODB_URI, "caipe") as checkpointer:
    graph = builder.compile(checkpointer=checkpointer)
```

### Collections Created

MongoDBSaver automatically creates two collections with compound indexes:

| Collection | Purpose | Index |
|------------|---------|-------|
| `checkpoints` | Stores checkpoint state | `(thread_id, checkpoint_ns, checkpoint_id)` unique |
| `checkpoint_writes` | Stores intermediate writes | `(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)` unique |

## Integration Points

### 1. Dynamic Agents

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`

```python
# Line 169 - Current
self._graph = create_deep_agent(
    ...
    checkpointer=InMemorySaver(),  # <-- Replace this
    ...
)

# After change
from langgraph.checkpoint.mongodb import MongoDBSaver

checkpointer = MongoDBSaver(
    client=self._mongo_service._client,  # Reuse existing connection
    db_name=self.settings.mongodb_database,
    ttl=self.settings.checkpoint_ttl_seconds,  # New config
)
self._graph = create_deep_agent(
    ...
    checkpointer=checkpointer,
    ...
)
```

### 2. Platform Engineer Supervisor

**File:** `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py`

```python
# Line 385 - Current
checkpointer = InMemorySaver()

# After change
from langgraph.checkpoint.mongodb import MongoDBSaver
from ai_platform_engineering.utils.mongodb_client import get_mongodb_client

client = get_mongodb_client()
if client:
    checkpointer = MongoDBSaver(
        client=client,
        db_name=os.getenv("MONGODB_DATABASE", "caipe"),
        ttl=int(os.getenv("CHECKPOINT_TTL_SECONDS", "86400")),
    )
else:
    checkpointer = InMemorySaver()  # Fallback
```

## Existing MongoDB Infrastructure

The codebase already has MongoDB infrastructure in place:

| Component | MongoDB Usage | Env Vars |
|-----------|--------------|----------|
| UI | `conversations`, `messages` collections | `MONGODB_URI`, `MONGODB_DATABASE` |
| Dynamic Agents | `dynamic_agents`, `mcp_servers` collections | `mongodb_uri`, `mongodb_database` in Settings |
| Platform Engineer | `task_configs` collection | `MONGODB_URI`, `MONGODB_DATABASE` |
| Slack Bot | Session storage | `MONGODB_URI`, `MONGODB_DATABASE` |

**Key utility:** `ai_platform_engineering/utils/mongodb_client.py` provides a singleton `get_mongodb_client()`.

## Considerations

### 1. Dependency Version Conflict

**Current state:**
```
Installed:  pymongo==4.16.0
Required:   pymongo>=4.12,<4.16
```

**Resolution options:**
- **Option A:** Pin `pymongo>=4.12,<4.16` (may affect other dependencies)
- **Option B:** Wait for `langgraph-checkpoint-mongodb` to update pymongo constraint
- **Option C:** Open an issue/PR on the langgraph repo

### 2. TTL (Time-to-Live) Policy

MongoDBSaver supports automatic expiration via MongoDB's TTL indexes:

```python
MongoDBSaver(client, ttl=86400)  # Expire checkpoints after 24 hours
```

**Recommendation:** Make TTL configurable via environment variable:
- `CHECKPOINT_TTL_SECONDS=86400` (24 hours default)
- Set to `None` for no expiration

### 3. Thread ID Strategy

**Critical:** The current code uses random UUIDs for `thread_id`, which means NO persistence across requests:

```python
# deep_agent.py:427 - Current (broken for persistence)
{"configurable": {"thread_id": uuid.uuid4()}}
```

**Fix required:** Use a stable identifier:
- For Platform Engineer: Use A2A task ID or user-provided conversation ID
- For Dynamic Agents: Use `session_id` from the request

```python
# After fix
{"configurable": {"thread_id": session_id}}  # From request context
```

### 4. Memory vs Disk Trade-off

| Aspect | InMemorySaver | MongoDBSaver |
|--------|---------------|--------------|
| Persistence | Lost on restart | Survives restart |
| Latency | ~0ms | ~1-5ms per checkpoint |
| Memory | Grows unbounded in-process | Offloaded to MongoDB |
| Cleanup | Automatic (process death) | Requires TTL or manual cleanup |

## Implementation Steps

### Phase 1: Resolve Dependencies

1. Check if downgrading pymongo to 4.15.x breaks anything
2. Add `langgraph-checkpoint-mongodb>=0.3.1` to dependencies
3. Run tests to verify compatibility

### Phase 2: Create Shared Checkpointer Factory

Create `ai_platform_engineering/utils/mongodb_checkpointer.py`:

```python
"""Shared MongoDB checkpointer for LangGraph agents."""

import os
from typing import Optional
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

_checkpointer: Optional[BaseCheckpointSaver] = None


def get_mongodb_checkpointer() -> BaseCheckpointSaver:
    """Get or create shared MongoDB checkpointer.
    
    Falls back to InMemorySaver if MongoDB is not configured.
    """
    global _checkpointer
    
    if _checkpointer is not None:
        return _checkpointer
    
    mongodb_uri = os.getenv("MONGODB_URI")
    if not mongodb_uri:
        _checkpointer = InMemorySaver()
        return _checkpointer
    
    try:
        from langgraph.checkpoint.mongodb import MongoDBSaver
        from pymongo import MongoClient
        
        client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")  # Verify connection
        
        db_name = os.getenv("MONGODB_DATABASE", "caipe")
        ttl = os.getenv("CHECKPOINT_TTL_SECONDS")
        ttl_int = int(ttl) if ttl else None
        
        _checkpointer = MongoDBSaver(
            client=client,
            db_name=db_name,
            checkpoint_collection_name="langgraph_checkpoints",
            writes_collection_name="langgraph_checkpoint_writes",
            ttl=ttl_int,
        )
        return _checkpointer
        
    except Exception as e:
        logger.warning(f"Failed to create MongoDB checkpointer: {e}, using InMemorySaver")
        _checkpointer = InMemorySaver()
        return _checkpointer
```

### Phase 3: Update Dynamic Agents

1. Import shared checkpointer in `agent_runtime.py`
2. Replace `InMemorySaver()` with `get_mongodb_checkpointer()`
3. Ensure `session_id` is passed through for `thread_id`

### Phase 4: Update Platform Engineer

1. Import shared checkpointer in `deep_agent.py`
2. Replace `InMemorySaver()` with `get_mongodb_checkpointer()`
3. Update `serve()` and `serve_stream()` to use stable thread IDs

### Phase 5: Testing

1. Unit tests for checkpointer factory
2. Integration tests for persistence across "restarts" (simulate with new process)
3. Load testing to verify MongoDB performance impact

## Environment Variables (New)

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECKPOINT_TTL_SECONDS` | `86400` | Time-to-live for checkpoints (seconds). Set empty for no expiration. |

## Open Questions

1. **TTL Policy:** What should be the default TTL? 24 hours? 7 days?
2. **Thread ID Source:** For Platform Engineer A2A, what stable ID should be used?
3. **Migration:** Should we migrate existing InMemorySaver-based sessions, or start fresh?

## Related Documents

- [LangGraph Persistence Research](./langgraph-persistence-for-runtime-restart.md)
- [Deep Agents Library Research](./deepagents-library-research.md)

## References

- [langgraph-checkpoint-mongodb on PyPI](https://pypi.org/project/langgraph-checkpoint-mongodb/)
- [LangGraph Checkpointers Documentation](https://langchain-ai.github.io/langgraph/concepts/persistence/)
- [MongoDB TTL Indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)
