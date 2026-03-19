---
sidebar_position: 2
sidebar_label: Specification
---

# Per-Agent MongoDB Checkpoint Persistence

**Status**: ✅ Implemented
**Category**: Architecture & Design
**Date**: March 19, 2026

## Overview

Extends the LangGraph MongoDB checkpointer to give each agent (supervisor + 15 subagents) its own isolated MongoDB collection pair, preventing cross-contamination when agents share the same `thread_id`. Collection names are auto-detected from the running module name — no per-agent environment variables required.

## Problem

The supervisor forwards its `context_id` (conversation UUID) to subagents as their `sessionId`/`thread_id`. When all agents write to the same MongoDB collection, checkpoints from different graph schemas collide on the same `(thread_id, checkpoint_ns, checkpoint_id)` compound key. Loading a Jira agent checkpoint into the supervisor graph (or vice versa) would cause deserialization failures.

Additionally, agent containers were missing the `langgraph-checkpoint-mongodb` package entirely, causing all subagents to silently fall back to `InMemorySaver` — losing state on every container restart.

## Solution

### Auto-prefixed collection names

Added `_detect_collection_prefix()` to `checkpointer.py` that derives a short agent identifier from `sys.modules['__main__'].__spec__.name`:

| Module name | Detected prefix | Collections |
|------------|----------------|-------------|
| `ai_platform_engineering.multi_agents` | `caipe_supervisor` | `caipe_supervisor_checkpoints`, `caipe_supervisor_checkpoint_writes` |
| `agent_jira` | `jira` | `jira_checkpoints`, `jira_checkpoint_writes` |
| `agent_github` | `github` | `github_checkpoints`, `github_checkpoint_writes` |
| `agent_aws` | `aws` | `aws_checkpoints`, `aws_checkpoint_writes` |
| *(any `agent_X`)* | `X` | `X_checkpoints`, `X_checkpoint_writes` |

When `LANGGRAPH_CHECKPOINT_MONGODB_COLLECTION` and `LANGGRAPH_CHECKPOINT_MONGODB_WRITES_COLLECTION` are not set, the auto-prefix kicks in. Explicit env vars still override for backward compatibility.

### Unified checkpointer usage

Replaced all hardcoded `MemorySaver()` / `InMemorySaver()` calls across 7 agent files with `get_checkpointer()` from `ai_platform_engineering.utils.checkpointer`:

- `agents/aws/agent_aws/agent_langgraph.py` — `MemorySaver()` → `get_checkpointer()`
- `agents/github/agent_github/graph.py` — `InMemorySaver()` → `get_checkpointer()`
- `agents/gitlab/agent_gitlab/graph.py` — `InMemorySaver()` → `get_checkpointer()`
- `agents/slack/agent_slack/graph.py` — `InMemorySaver()` → `get_checkpointer()`
- `agents/confluence/agent_confluence/graph.py` — `InMemorySaver()` → `get_checkpointer()`
- `agents/jira/agent_jira/graph.py` — `InMemorySaver()` → `get_checkpointer()`
- `agents/splunk/agent_splunk/agent.py` — `MemorySaver()` → `get_checkpointer()`

### Dependency propagation

Added `langgraph-checkpoint-mongodb>=0.3.0` and `pymongo>=4.7.0` to `ai_platform_engineering/utils/pyproject.toml`. Added `ai-platform-engineering-utils` as a dependency to the 11 agents that were missing it, so all 15 agents get the MongoDB checkpointer transitively.

### Bug fixes

- **GitHub agent SSL crash**: Removed `SSL_CERT_FILE`, `CUSTOM_CA_BUNDLE`, `REQUESTS_CA_BUNDLE` env vars and CA bundle volume mount from `docker-compose.dev.yaml`. When the cert file didn't exist on the host, Docker created it as a directory, causing `IsADirectoryError` on startup.
- **NETWORK_UTILITY → NETUTILS rename**: Updated `.env` from `ENABLE_NETWORK_UTILITY` to `ENABLE_NETUTILS` to match the agent card name, fixing supervisor discovery rejection ("returned wrong agent card").

## Files Changed

| File | Change |
|------|--------|
| `ai_platform_engineering/utils/checkpointer.py` | Added `_detect_collection_prefix()`, auto-prefix logic in `create_checkpointer()` |
| `ai_platform_engineering/utils/pyproject.toml` | Added `langgraph-checkpoint-mongodb`, `pymongo` deps |
| 15x `agents/*/pyproject.toml` | Added `ai-platform-engineering-utils` dep where missing |
| 16x `*/uv.lock` | Regenerated lock files |
| 7x agent `graph.py`/`agent.py` files | `MemorySaver()` → `get_checkpointer()` |
| `docker-compose.dev.yaml` | Removed GitHub SSL cert config, fixed netutils naming |
| `.env` | `ENABLE_NETWORK_UTILITY` → `ENABLE_NETUTILS`, removed explicit collection names |

## Related

- Spec: [082-langgraph-redis-checkpoint-persistence](../082-langgraph-redis-checkpoint-persistence/spec.md)
- Spec: [085-langgraph-redis-persistence](../085-langgraph-redis-persistence/spec.md)
