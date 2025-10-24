# Streaming Tests

This directory contains tests to verify token-by-token and chunk-based streaming for the AI Platform Engineering agents.

## Test Files

### 1. `test_rag_streaming.py`
Tests RAG agent's token-by-token streaming capability.

**What it tests:**
- RAG agent streams tokens in real-time (not one large chunk)
- Verifies `astream_events` implementation
- Counts chunks to ensure proper streaming

**Usage:**
```bash
python integration/test_rag_streaming.py
```

**Expected Output:**
- Should receive 100+ chunks for a typical query
- Tokens appear character-by-character or in small groups
- Final output shows total chunks and duration

### 2. `test_platform_engineer_streaming.py`
Tests Platform Engineer's routing and streaming across different modes.

**What it tests:**
1. **Direct routing to RAG** - Documentation queries → RAG (token streaming)
2. **Direct routing to operational agents** - Single agent queries (token streaming)
3. **Parallel routing** - Multiple agents in parallel
4. **Deep Agent routing** - Ambiguous queries requiring orchestration

**Usage:**
```bash
python integration/test_platform_engineer_streaming.py
```

**Test Queries:**
| Query | Routing Mode | Expected Behavior |
|-------|--------------|-------------------|
| `docs duo-sso cli instructions` | DIRECT → RAG | Token streaming |
| `show me komodor clusters` | DIRECT → Komodor | Token streaming |
| `show me github repos and komodor clusters` | PARALLEL | GitHub + Komodor streaming |
| `who is on call for SRE?` | COMPLEX → Deep Agent | PagerDuty + RAG (chunk-based) |
| `what is the escalation policy?` | COMPLEX → Deep Agent | RAG via semantic routing |

### 3. `test_all_streaming.sh`
Shell script to run all streaming tests in sequence.

**Usage:**
```bash
chmod +x integration/test_all_streaming.sh
./integration/test_all_streaming.sh
```

## Prerequisites

1. **Services must be running:**
   ```bash
   docker-compose -f docker-compose.dev.yaml --profile p2p up -d
   ```

2. **Python dependencies:**
   ```bash
   pip install httpx a2a
   ```

3. **Verify services are accessible:**
   ```bash
   curl http://localhost:8099/.well-known/agent.json  # RAG agent
   curl http://localhost:8080/.well-known/agent.json  # Platform Engineer
   ```

## Streaming Architecture

### Token-Based Streaming (Direct Routing)
- Used for: Direct queries to RAG or operational agents
- Implementation: `astream_events(version='v2')` in agent code
- Behavior: Tokens streamed immediately as LLM generates them
- User Experience: ChatGPT-like real-time typing

**Flow:**
```
User Query → Platform Engineer → Detects direct route → Sub-agent streams tokens → Client
```

### Chunk-Based Streaming (Deep Agent Routing)
- Used for: Ambiguous queries requiring orchestration
- Implementation: `A2ARemoteAgentConnectTool` accumulates tokens
- Behavior: Tool collects all tokens, returns complete text to Deep Agent
- User Experience: Complete responses from each tool call

**Flow:**
```
User Query → Platform Engineer → Deep Agent → Tool calls sub-agents → Accumulates responses → Returns complete text
```

## Troubleshooting

### No streaming output
1. Check if services are running: `docker ps | grep -E "agent_rag|platform-engineer"`
2. Check logs: `docker logs agent_rag` or `docker logs platform-engineer-p2p`
3. Verify ports are correct in test scripts

### Only 1-2 chunks received
- This indicates chunk-based streaming, not token-based
- Check routing logic in `platform_engineer/protocol_bindings/a2a/agent_executor.py`
- Verify query matches documentation keywords for direct RAG routing

### Connection errors
- Ensure you're inside the Docker network or using correct external ports
- RAG: `http://localhost:8099` (external) or `http://agent_rag:8000` (internal)
- Platform Engineer: `http://localhost:8080` (external) or `http://platform-engineer-p2p:8000` (internal)

## Verifying Streaming

### Good Token Streaming:
```
✅ Streaming test completed!
   Total chunks: 460
   Total characters: 1951
   Duration: 4.5s
   ✅ Token streaming verified (received 460 chunks)
```

### Not Token Streaming:
```
⚠️  Streaming test completed!
   Total chunks: 1
   Total characters: 1951
   Duration: 4.5s
   ⚠️  Only 1 chunks received - may not be token-level streaming
```

## Recent Changes

### 2025-10-21: Fixed RAG Direct Routing
- **Issue:** Queries like "docs duo-sso" weren't matching documentation keywords
- **Fix:** Changed `'docs:'` → `'docs'` (removed colon requirement)
- **Impact:** Documentation queries now route directly to RAG for token streaming

### 2025-10-21: Added Newlines to Tool Messages
- **Issue:** Tool call messages were concatenated without spacing
- **Fix:** Added `\n` to end of tool call/result messages in `BaseLangGraphAgent`
- **Impact:** Better formatting for tool execution visibility

## Related Files

- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` - Routing logic
- `ai_platform_engineering/utils/a2a_common/a2a_remote_agent_connect.py` - Deep Agent tool for sub-agent communication
- `ai_platform_engineering/knowledge_bases/rag/agent_rag/src/agent_rag/protocol_bindings/a2a_server/agent.py` - RAG agent streaming
- `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py` - Base class for agent streaming

