# DeepAgents Library Research

**Date:** 2026-03-10  
**Status:** Research Complete

## Overview

Research into LangChain's `deepagents` library to understand how StateBackend, StoreBackend, checkpointing, and filesystem APIs work. The upstream repo was cloned to `research-files/deepagents/` for analysis.

## Key Findings

### 1. StateBackend - In-Memory File Storage

**Location:** `research-files/deepagents/libs/deepagents/deepagents/backends/state.py`

StateBackend stores files as a dict in LangGraph state:

```python
# Structure: dict[str, FileData]
files = runtime.state.get("files", {})

# FileData format:
{
    "content": ["line1", "line2", ...],  # list of strings (lines)
    "created_at": "2026-03-10T...",       # ISO timestamp
    "modified_at": "2026-03-10T..."       # ISO timestamp
}
```

**How tools work with StateBackend:**
- `ls`: Filters `files.keys()` by path prefix
- `read`: Direct key lookup `files.get(file_path)`
- `grep`: Iterates all files, checks each line for **substring match** (literal, not regex)
- `glob`: Iterates all files, uses `wcmatch.glob.globmatch`
- `write`/`edit`: Return `WriteResult(files_update={...})` which LangGraph applies via `Command` pattern

### 2. StoreBackend - Persistent External Storage

**Location:** `research-files/deepagents/libs/deepagents/deepagents/backends/store.py`

StoreBackend persists files to LangGraph's `BaseStore` (Postgres, Redis, InMemoryStore, etc.):

- Writes **immediately** via `store.put()` - no state update needed
- Returns `files_update=None` because data is already persisted externally
- Supports **namespace-based isolation** for multi-tenancy:

```python
StoreBackend(
    runtime,
    namespace=lambda ctx: ("filesystem", ctx.runtime.context.user_id)
)
```

### 3. Checkpoint Timing (State Persistence)

**Key insight:** Checkpoints happen at **super-step boundaries** (after each node completes), NOT after individual tool calls.

From `docs/research/langgraph-persistence-for-runtime-restart.md`:

> LangGraph checkpointers save the full graph state at each "super-step" boundary:
> - Messages: Full conversation history
> - Channel values: Current state of all graph channels (including `files` dict)
> - Tool calls: Pending and completed tool executions

**What is a super-step?**
```
User message → [super-step 1: START node]
            → [super-step 2: agent node - LLM thinks, calls tools]
              (if LLM calls 3 tools, all 3 execute within same super-step)
            → [checkpoint saved here]
            → [super-step 3: next node]
```

If an LLM calls 3 tools in one response, they all execute, THEN the checkpoint is saved once.

### 4. Performance Implications of Frequent DB Saves

**Why it's usually OK:**
1. Checkpoint per super-step, not per tool call
2. Async writes (MongoDB/Postgres checkpointers)
3. Small payloads (JSON-serializable dicts)
4. Connection pooling via shared checkpointer

**When it could be problematic:**
1. Large files in StateBackend (serialized in every checkpoint)
2. Many concurrent agents
3. High-latency network to DB

**Mitigation strategies:**
- Use `StoreBackend` for large files (persists immediately, not in checkpoint)
- Use `FilesystemBackend` for local file access (files on disk, not in state)
- Add TTL index on checkpoints collection

### 5. Memory Management for Large Files

**No mmap or streaming support in StateBackend.** Files are stored entirely in memory as `list[str]`.

**Existing safeguards:**
- `max_file_size_mb` on `FilesystemBackend` (default 10MB) - skips large files in grep
- Pagination via `offset` and `limit` parameters on `read()`
- Truncation of large tool outputs (`truncate_if_too_long`)

**Recommendations for large files:**

| Use Case | Recommended Backend |
|----------|---------------------|
| Large files agent needs to edit | `FilesystemBackend` or `StoreBackend` |
| Grep over large repos | `FilesystemBackend` with ripgrep |
| Multi-tenant with file isolation | `StoreBackend` with namespace |

### 6. Live Filesystem Introspection APIs

**The library provides APIs to probe filesystem state in real-time.** This enables UI features like file explorers, live previews, etc.

#### Primary API: `agent.get_state(config)` / `agent.aget_state(config)`

```python
# Get current state for a thread
config = {"configurable": {"thread_id": "session-123"}}
state = await agent.aget_state(config)

# Access files dict
files = state.values.get("files", {})
# {
#   "/path/to/file.txt": {
#     "content": ["line1", "line2", ...],
#     "created_at": "...",
#     "modified_at": "..."
#   }
# }
```

#### Streaming File Updates

The `files` channel is exposed for streaming:

```python
# Confirmed in tests/utils.py:11-12
assert "files" in agent.stream_channels

# Stream file changes in real-time
async for namespace, stream_mode, data in agent.astream(
    {"messages": [HumanMessage(content="Create a file")]},
    config,
    stream_mode=["messages", "updates"],
):
    if stream_mode == "updates" and "files" in data:
        print(f"Files updated: {data['files'].keys()}")
```

#### Direct Checkpointer Access (File History)

```python
# Get specific checkpoint
checkpoint = agent.checkpointer.get(config)
files = checkpoint["channel_values"]["files"]

# List all checkpoints for a thread (history)
checkpoints = list(agent.checkpointer.list(config))
```

#### UI Integration Example

For Dynamic Agents, expose API endpoints:

```python
@router.get("/sessions/{session_id}/files")
async def get_session_files(session_id: str):
    runtime = await runtime_cache.get(session_id)
    config = {"configurable": {"thread_id": session_id}}
    state = await runtime._graph.aget_state(config)
    return state.values.get("files", {})

@router.get("/sessions/{session_id}/files/{path:path}")
async def read_session_file(session_id: str, path: str):
    runtime = await runtime_cache.get(session_id)
    config = {"configurable": {"thread_id": session_id}}
    state = await runtime._graph.aget_state(config)
    files = state.values.get("files", {})
    file_data = files.get(f"/{path}")
    if not file_data:
        raise HTTPException(404, "File not found")
    return {
        "path": path,
        "content": "\n".join(file_data["content"]),
        "modified_at": file_data.get("modified_at")
    }
```

| UI Feature | Implementation |
|------------|----------------|
| Show file tree | `state.values["files"].keys()` |
| Read file content | `"\n".join(file_data["content"])` |
| Watch for changes | Stream with `stream_mode="updates"`, filter `files` key |
| Show file history | Iterate `checkpointer.list(config)`, compare `files` dicts |

## Available Backend Classes

From `backends/__init__.py` (publicly exported):

| Backend | Description |
|---------|-------------|
| `StateBackend` | In-memory dict in LangGraph state (ephemeral) |
| `StoreBackend` | Persistent external storage (Postgres, Redis, etc.) |
| `FilesystemBackend` | Direct host filesystem access |
| `LocalShellBackend` | Filesystem + shell execution |
| `CompositeBackend` | Route operations to different backends by path prefix |

## BackendProtocol Interface

All backends implement these methods:

| Method | Description |
|--------|-------------|
| `ls_info(path)` | List files/directories with metadata |
| `read(file_path, offset, limit)` | Read file content with pagination |
| `write(file_path, content)` | Create a new file |
| `edit(file_path, old, new, replace_all)` | String replacement in file |
| `grep_raw(pattern, path, glob)` | Search for literal text pattern |
| `glob_info(pattern, path)` | Find files matching glob pattern |
| `upload_files(files)` | Batch upload files |
| `download_files(paths)` | Batch download files |

All methods have async versions (`aread`, `awrite`, `als_info`, etc.)

## Relevant Source Files

### Cloned Repository (primary research source)
- `research-files/deepagents/` - Full upstream clone of langchain-ai/deepagents

### Key Source Files
- `research-files/deepagents/libs/deepagents/deepagents/backends/state.py` - StateBackend
- `research-files/deepagents/libs/deepagents/deepagents/backends/store.py` - StoreBackend with namespace isolation
- `research-files/deepagents/libs/deepagents/deepagents/backends/protocol.py` - BackendProtocol interface
- `research-files/deepagents/libs/deepagents/deepagents/backends/filesystem.py` - FilesystemBackend
- `research-files/deepagents/libs/deepagents/deepagents/middleware/filesystem.py` - FilesystemMiddleware with tool implementations

### Test Files (useful examples)
- `research-files/deepagents/libs/deepagents/tests/unit_tests/backends/test_state_backend.py`
- `research-files/deepagents/libs/deepagents/tests/unit_tests/middleware/test_memory_middleware.py` - Shows `get_state` usage
- `research-files/deepagents/libs/deepagents/tests/evals/test_hitl.py` - Shows live state inspection

## References

- [DeepAgents Documentation](https://docs.langchain.com/oss/python/deepagents/overview)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- Related: `docs/research/langgraph-persistence-for-runtime-restart.md`
