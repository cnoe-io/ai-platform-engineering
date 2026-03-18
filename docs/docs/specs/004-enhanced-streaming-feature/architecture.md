---
sidebar_position: 1
id: 004-enhanced-streaming-feature-architecture
sidebar_label: Architecture
---

# Architecture: Enhanced Streaming Feature

**Date**: 2024-10-22

## Feature Flag

### Environment Variable

```bash
ENABLE_ENHANCED_STREAMING=true|false
```

- **Default**: `true` (enabled)
- **Location**: `docker-compose.dev.yaml` → `platform-engineer-p2p` service
- **Set in `.env`**: Override with `ENABLE_ENHANCED_STREAMING=false` to disable

### Behavior

#### When Enabled (`true`)

Queries are analyzed and routed intelligently:

```
┌─────────────────────────────────────────────────┐
│  Query: "show me komodor clusters"              │
│    ↓                                            │
│  Router detects: 1 agent mentioned              │
│    ↓                                            │
│  DIRECT MODE: Stream from Komodor               │
│  Result: Token-by-token streaming ⚡️            │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Query: "list github repos and komodor clusters"│
│    ↓                                            │
│  Router detects: 2 agents, no orchestration     │
│    ↓                                            │
│  PARALLEL MODE: Stream from both agents         │
│  Result: Aggregated results with sources 🌊     │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Query: "analyze clusters and create tickets"   │
│    ↓                                            │
│  Router detects: orchestration keywords         │
│    ↓                                            │
│  COMPLEX MODE: Use Deep Agent                   │
│  Result: Intelligent multi-step orchestration 🧠│
└─────────────────────────────────────────────────┘
```

#### When Disabled (`false`)

All queries go through Deep Agent (original behavior):
- Provides intelligent orchestration for all queries
- No direct streaming optimization
- Higher latency but consistent reasoning path


## Routing Logic

### DIRECT Mode Triggers

- Single agent mentioned in query
- Examples:
  - "show me komodor clusters"
  - "list github repositories"
  - "get weather for Seattle"

### PARALLEL Mode Triggers

- Multiple agents mentioned
- NO orchestration keywords
- Examples:
  - "show me github repos and komodor clusters"
  - "list jira tickets and github issues"
  - "get weather and backstage services"

### COMPLEX Mode Triggers

- No specific agent mentioned, OR
- Multiple agents with orchestration keywords
- Orchestration keywords:
  - `analyze`, `compare`, `if`, `then`
  - `create`, `update`, `based on`
  - `depending on`, `which`, `that have`
- Examples:
  - "analyze komodor clusters and create jira tickets if any are failing"
  - "compare github stars to confluence documentation quality"
  - "what is the status of our platform?" (no specific agent)


## Performance Characteristics

| Mode | Streaming | Latency | Best For |
|------|-----------|---------|----------|
| **DIRECT** | ✅ Token-by-token | ~100ms to first token | Single-agent queries |
| **PARALLEL** | ✅ Aggregated | ~200ms (parallel) | Multi-agent data gathering |
| **COMPLEX** | ❌ Blocked | ~2-5s | Intelligent orchestration |


## Usage Examples

### Enable Feature (Default)

```bash
# In .env or docker-compose.dev.yaml
ENABLE_ENHANCED_STREAMING=true
```

```bash
docker compose -f docker-compose.dev.yaml restart platform-engineer-p2p
```

### Disable Feature

```bash
# In .env
ENABLE_ENHANCED_STREAMING=false
```

```bash
docker compose -f docker-compose.dev.yaml restart platform-engineer-p2p
```

### Verify Status

```bash
docker logs platform-engineer-p2p 2>&1 | grep "Enhanced streaming"
```

Expected output:
```
🎛️  Enhanced streaming: ENABLED
```
or
```
🎛️  Enhanced streaming: DISABLED
```


## Implementation Details

### Files Modified

1. **`agent_executor.py`**
   - Added `RoutingType` enum
   - Added `RoutingDecision` dataclass
   - Added `_route_query()` method
   - Added `_stream_from_multiple_agents()` method
   - Modified `execute()` to check feature flag
   - Feature flag read from `ENABLE_ENHANCED_STREAMING` env var

2. **`docker-compose.dev.yaml`**
   - Added `ENABLE_ENHANCED_STREAMING` to `platform-engineer-p2p` environment
   - Default: `${ENABLE_ENHANCED_STREAMING:-true}`

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Client Query                                               │
│      ↓                                                      │
│  Feature Flag Check                                         │
│      │                                                      │
│      ├─ ENABLED ────→ Intelligent Router                   │
│      │                      │                               │
│      │                      ├─ DIRECT ──→ Single Agent      │
│      │                      ├─ PARALLEL → Multiple Agents   │
│      │                      └─ COMPLEX ─→ Deep Agent        │
│      │                                                      │
│      └─ DISABLED ───→ Deep Agent (all queries)             │
└────────────────────────────────────────────────────────────┘
```


## Troubleshooting

### Feature Not Working

1. Check feature flag status:
   ```bash
   docker logs platform-engineer-p2p 2>&1 | grep "Enhanced streaming"
   ```

2. Verify environment variable:
   ```bash
   docker inspect platform-engineer-p2p | grep ENABLE_ENHANCED_STREAMING
   ```

3. Restart container:
   ```bash
   docker compose -f docker-compose.dev.yaml restart platform-engineer-p2p
   ```

### Routing Not as Expected

Enable debug logging to see routing decisions:
```bash
docker logs platform-engineer-p2p 2>&1 | grep "🎯"
```

### Fallback to Deep Agent

If DIRECT or PARALLEL modes fail, the system automatically falls back to Deep Agent:
```bash
docker logs platform-engineer-p2p 2>&1 | grep "falling back"
```


## Future Enhancements

- [ ] LLM-based routing (use GPT-4o-mini for intelligent routing decisions)
- [ ] Streaming commentary (supervisor injects status updates during parallel execution)
- [ ] Event bus architecture (fully async orchestration)
- [ ] Per-agent routing configuration (override routing for specific agents)
- [ ] Query complexity scoring (automatic threshold-based routing)



## Related

- Spec: [spec.md](./spec.md)
