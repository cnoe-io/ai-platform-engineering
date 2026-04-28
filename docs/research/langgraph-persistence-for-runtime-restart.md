# LangGraph Persistence for Agent Runtime Restart

**Date:** 2026-03-09  
**Status:** Research Complete - Ready for Implementation

## Problem Statement

When the agent runtime is restarted (via "Restart Agent Session" button), the agent loses all conversation history and context. This happens because:

1. The `AgentRuntime` is invalidated and removed from cache
2. The `InMemorySaver` checkpointer (which stores LangGraph state) is destroyed with it
3. A new runtime is created with a fresh `InMemorySaver`
4. **All conversation history is lost** because it was stored in-memory

The `thread_id` (which equals `session_id`) is the key used by LangGraph to store/retrieve conversation state. Currently, since we use `InMemorySaver`, this state lives only in the Python process memory tied to that runtime instance.

## Current Implementation

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`

```python
from langgraph.checkpoint.memory import InMemorySaver

# In AgentRuntime.initialize():
self._graph = create_deep_agent(
    model=llm,
    tools=tools,
    system_prompt=system_prompt,
    context_schema=AgentContext,
    checkpointer=InMemorySaver(),  # <-- In-memory, lost on restart
    name=safe_name,
    subagents=subagents if subagents else None,
)
```

When streaming, LangGraph uses the `thread_id` to retrieve prior state:

```python
config["configurable"]["thread_id"] = session_id
```

The `InMemorySaver` checkpointer stores state keyed by `thread_id`, but this state is destroyed when the runtime is invalidated.

## LangGraph Persistence Options

### Available Checkpointers

| Package | Backend | Notes |
|---------|---------|-------|
| `langgraph-checkpoint` (built-in) | In-memory (`InMemorySaver`) | For development only; state lost on restart |
| `langgraph-checkpoint-sqlite` | SQLite | Good for local dev; file-based persistence |
| `langgraph-checkpoint-postgres` | PostgreSQL | Production-ready; used by LangSmith |
| `langgraph-checkpoint-mongodb` | MongoDB | Production-ready; official package from LangChain |

### What the Checkpointer Stores

LangGraph checkpointers save the full graph state at each "super-step" boundary:

- **Messages**: Full conversation history
- **Channel values**: Current state of all graph channels
- **Tool calls**: Pending and completed tool executions
- **Pending writes**: Work in progress from failed nodes
- **Metadata**: Step number, timestamps, source info

This is more comprehensive than just storing messages - it preserves the full execution state.

## Solution Options

### Option A: MongoDB Checkpointer (Recommended)

Replace `InMemorySaver` with `MongoDBSaver` from `langgraph-checkpoint-mongodb`.

**Pros:**
- Durable persistence; survives restarts, crashes, deploys
- Official LangGraph package maintained by LangChain team
- We already have MongoDB infrastructure
- Preserves full LangGraph state (not just messages)
- Works seamlessly with existing `thread_id` mechanism

**Cons:**
- Adds a dependency
- Slightly more latency per checkpoint (negligible in practice)

**Usage:**
```python
from langgraph.checkpoint.mongodb import MongoDBSaver

MONGODB_URI = "mongodb://localhost:27017"
DB_NAME = "dynamic_agents"

# Option 1: Context manager
with MongoDBSaver.from_conn_string(MONGODB_URI, DB_NAME) as checkpointer:
    graph = create_deep_agent(..., checkpointer=checkpointer)

# Option 2: Long-lived instance
checkpointer = MongoDBSaver.from_conn_string(MONGODB_URI, DB_NAME)
# Use checkpointer across multiple runtimes
```

### Option B: PostgreSQL Checkpointer

Use `langgraph-checkpoint-postgres`.

**Pros:**
- Very mature; high performance
- Used by LangSmith in production

**Cons:**
- Would need to add PostgreSQL dependency (we don't currently use it)
- Additional infrastructure to manage

### Option C: Reload Messages from MongoDB

On restart, load messages from our existing `conversations` collection and hydrate the agent state.

**Pros:**
- No new dependencies
- Uses existing infrastructure

**Cons:**
- Complex implementation
- Would need to convert our message format to LangGraph format
- Doesn't preserve full LangGraph state (tool calls, pending writes, etc.)
- May have subtle bugs with state reconstruction

## Recommended Solution: MongoDB Checkpointer

### Implementation Steps

#### 1. Add Dependency

```toml
# In ai_platform_engineering/dynamic_agents/pyproject.toml
[project.dependencies]
langgraph-checkpoint-mongodb = ">=0.3.0"
```

#### 2. Create Shared Checkpointer

Create a module to manage the checkpointer lifecycle:

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/checkpointer.py`

```python
"""LangGraph checkpointer for persistent conversation state."""

from langgraph.checkpoint.mongodb import MongoDBSaver

from dynamic_agents.config import Settings

_checkpointer: MongoDBSaver | None = None


def get_checkpointer(settings: Settings) -> MongoDBSaver:
    """Get or create the shared MongoDB checkpointer.
    
    The checkpointer is shared across all agent runtimes to enable
    connection pooling and ensure state persists across runtime restarts.
    """
    global _checkpointer
    if _checkpointer is None:
        _checkpointer = MongoDBSaver.from_conn_string(
            settings.mongodb_uri,
            settings.mongodb_db,  # Use same DB as conversations
        )
    return _checkpointer


async def cleanup_checkpointer() -> None:
    """Clean up the checkpointer on shutdown."""
    global _checkpointer
    if _checkpointer is not None:
        # MongoDBSaver may have cleanup methods
        _checkpointer = None
```

#### 3. Update AgentRuntime

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`

```python
# Change import
from langgraph.checkpoint.mongodb import MongoDBSaver
# Remove: from langgraph.checkpoint.memory import InMemorySaver

class AgentRuntime:
    def __init__(
        self,
        config: DynamicAgentConfig,
        mcp_servers: list[MCPServerConfig],
        checkpointer: MongoDBSaver,  # Add parameter
        settings: Settings | None = None,
        mongo_service: "MongoDBService | None" = None,
    ):
        self.config = config
        self.mcp_servers = mcp_servers
        self._checkpointer = checkpointer  # Store reference
        # ... rest of init

    async def initialize(self) -> None:
        # ... existing code ...
        
        self._graph = create_deep_agent(
            model=llm,
            tools=tools,
            system_prompt=system_prompt,
            context_schema=AgentContext,
            checkpointer=self._checkpointer,  # Use shared checkpointer
            name=safe_name,
            subagents=subagents if subagents else None,
        )
```

#### 4. Update RuntimeCache

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`

```python
from dynamic_agents.services.checkpointer import get_checkpointer

class AgentRuntimeCache:
    def __init__(self, settings: Settings, mongo_service: MongoDBService):
        self._settings = settings
        self._mongo_service = mongo_service
        self._cache: dict[str, AgentRuntime] = {}
        self._ttl = settings.agent_runtime_ttl
        self._checkpointer = get_checkpointer(settings)  # Shared instance

    async def get_or_create(
        self,
        agent_config: DynamicAgentConfig,
        mcp_servers: list[MCPServerConfig],
        session_id: str,
    ) -> AgentRuntime:
        # ... existing cache logic ...
        
        # Create new runtime with shared checkpointer
        runtime = AgentRuntime(
            agent_config,
            mcp_servers,
            checkpointer=self._checkpointer,  # Pass shared checkpointer
            settings=self._settings,
            mongo_service=self._mongo_service,
        )
        await runtime.initialize()
        self._cache[key] = runtime
        return runtime
```

#### 5. Configuration (Optional)

If we want a separate database for checkpoints:

```python
# In config.py / Settings
class Settings:
    # ... existing settings ...
    
    # LangGraph checkpoint settings
    langgraph_checkpoint_db: str = Field(
        default="",
        description="MongoDB database for LangGraph checkpoints (defaults to mongodb_db)"
    )
    
    @property
    def checkpoint_db(self) -> str:
        return self.langgraph_checkpoint_db or self.mongodb_db
```

### Files to Modify

| File | Changes |
|------|---------|
| `ai_platform_engineering/dynamic_agents/pyproject.toml` | Add `langgraph-checkpoint-mongodb` dependency |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/checkpointer.py` | New file: checkpointer factory |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` | Replace `InMemorySaver` with `MongoDBSaver`, accept checkpointer param |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/main.py` | (Optional) Initialize/cleanup checkpointer at startup/shutdown |

### MongoDB Collections Created

The `MongoDBSaver` will create these collections in the specified database:

- `checkpoints` - Stores checkpoint data
- `checkpoint_writes` - Stores pending writes

### Testing Plan

1. Start a conversation with an agent
2. Send a few messages, including some that trigger tool calls
3. Click "Restart Agent Session"
4. Send another message
5. **Verify:** Agent remembers the full conversation history
6. **Verify:** Agent can reference previous tool results
7. Restart the entire dynamic-agents server
8. **Verify:** Conversation still persists

## Open Questions

### 1. Checkpoint Collection Location

Should the LangGraph checkpoints go in:
- **A.** Same database as conversations (`caipe`) - simpler, all data together
- **B.** Separate database (`langgraph_checkpoints`) - isolation, easier to manage TTL

**Recommendation:** Same database (A) for simplicity.

### 2. Cleanup Policy

LangGraph stores checkpoints at every super-step, which can accumulate significantly. Options:

- **A.** No cleanup - let MongoDB handle it (simplest)
- **B.** Add TTL index on checkpoints collection
- **C.** Periodic cleanup job for old threads
- **D.** Cleanup when conversation is deleted

**Recommendation:** Start with (A), add TTL later if storage becomes an issue.

### 3. Restart Behavior Clarification

When user clicks "Restart Agent Session," what should happen?

- **A.** Preserve full conversation history, just reconnect MCP servers (recommended)
- **B.** Clear LangGraph state but keep MongoDB messages visible (fresh agent context)
- **C.** Clear everything and start fresh

Current behavior: Clears everything (unintentional).
**Recommendation:** Option A - preserve history.

## References

- [LangGraph Persistence Documentation](https://docs.langchain.com/oss/python/langgraph/persistence)
- [langgraph-checkpoint-mongodb on PyPI](https://pypi.org/project/langgraph-checkpoint-mongodb/)
- [Deep Agents Overview](https://docs.langchain.com/oss/python/deepagents/overview)
