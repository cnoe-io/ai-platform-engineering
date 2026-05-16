# Quickstart: Per-Agent Distribution Control

**Date**: 2026-04-08  
**Spec**: `098-unify-single-distributed-binding`

## Usage

### All agents in-process (default)

```bash
# No env vars needed — this is the default
docker compose -f docker-compose.dev.yaml up caipe-supervisor
```

### Specific agents distributed

```bash
# Only ArgoCD and AWS run as remote A2A containers
DISTRIBUTED_AGENTS=argocd,aws docker compose -f docker-compose.dev.yaml \
  --profile argocd --profile aws up
```

### All agents distributed (legacy-compatible)

```bash
# Either of these produces identical behavior
DISTRIBUTED_AGENTS=all docker compose -f docker-compose.dev.yaml up
DISTRIBUTED_MODE=true  docker compose -f docker-compose.dev.yaml up
```

### Mixed mode with agent disable

```bash
# ArgoCD distributed, Splunk disabled, everything else in-process
DISTRIBUTED_AGENTS=argocd ENABLE_SPLUNK=false docker compose -f docker-compose.dev.yaml \
  --profile argocd up
```

## Helm Values

```yaml
# charts/ai-platform-engineering/values.yaml
env:
  DISTRIBUTED_AGENTS: "argocd,aws"
  ENABLE_SPLUNK: "false"
```

## Verification

After the supervisor starts, check the logs for per-agent routing:

```
INFO - 📡 argocd → remote A2A subagent
INFO - 🏠 jira → in-process MCP tools
INFO - 🏠 github → in-process MCP tools
INFO - 📡 aws → remote A2A subagent
INFO - ⏭️ Disabled agents: ['splunk']
INFO - ✅ 4 subagents initialized (2 remote, 2 local)
```

---

## RAG Reliability Configuration (US-6)

### Default configuration (via docker-compose.dev.yaml)

```yaml
environment:
  - FETCH_DOCUMENT_MAX_CALLS=10    # max fetch_document calls per query
  - SEARCH_MAX_CALLS=5             # max search calls per query
  - RAG_MAX_OUTPUT_CHARS=10000     # per-call output truncation (chars)
  - RAG_MAX_SEARCH_RESULTS=3       # max results per search call
  - LANGGRAPH_RECURSION_LIMIT=500  # LangGraph recursion safety limit
```

### Testing RAG caps

```bash
# Start supervisor with RAG
docker compose -f docker-compose.dev.yaml --profile rag up -d

# Ask a broad RAG query via Slack or curl
# Expected: response completes within 60s, synthesized from ≤10 documents
```

### Tuning for specific workloads

```bash
# High-volume RAG (many small documents)
FETCH_DOCUMENT_MAX_CALLS=20 SEARCH_MAX_CALLS=10 \
  docker compose -f docker-compose.dev.yaml up caipe-supervisor

# Strict limits (cost-sensitive)
FETCH_DOCUMENT_MAX_CALLS=3 SEARCH_MAX_CALLS=2 RAG_MAX_SEARCH_RESULTS=2 \
  docker compose -f docker-compose.dev.yaml up caipe-supervisor
```

### Verifying caps in logs

```
INFO - FetchDocumentCapWrapper: call 5/10 for thread abc123
INFO - SearchCapWrapper: capping limit from 10 to 3
WARN - FetchDocumentCapWrapper: cap reached (10/10) — returning synthesis instruction
```

## Slack Narrative Streaming (US-7)

### What you should see in Slack

```
🔧 [RAG] Search for AGNTCY documentation
I'll search the knowledge base for relevant information.    ← narrative (was missing)
🔧 [RAG] Fetch document: agntcy-overview.md
Let me get more details from the overview document.         ← narrative (was missing)
🔧 [Forge] Synthesize findings
Here is a comprehensive answer about AGNTCY...              ← final answer
```

### What was broken before

```
🔧 [RAG] Search for AGNTCY documentation
                                                            ← missing narrative
🔧 [RAG] Fetch document: agntcy-overview.md
                                                            ← missing narrative
🔧 [Forge] Synthesize findings
I've completed your request.                                ← empty final answer
```

---

## Test Harness (Phase D)

### Running unit tests (fast CI)

```bash
# All new test harness tests
PYTHONPATH=. uv run pytest tests/test_binding_streaming_events.py \
  tests/test_slack_narrative_streaming.py \
  tests/test_final_result_content.py \
  tests/test_distributed_mode_binding.py -v

# All existing + new tests together
make test-supervisor
```

### Running integration tests (Docker required)

```bash
# Start minimal test environment
docker compose -f docker-compose.dev.yaml \
  --profile github --profile netutils-agent up -d --build

# Run integration streaming harness
PYTHONPATH=. uv run pytest integration/test_streaming_harness.py -v

# Teardown
docker compose -f docker-compose.dev.yaml down
```

### Test coverage by user story

| User Story | Unit Tests | Integration Tests |
|------------|------------|-------------------|
| US-1 (Single codebase) | `test_distributed_agents.py` | `test_streaming_harness.py` |
| US-2 (Tool notifications) | `test_streaming_narration.py`, `test_binding_streaming_events.py` | `test_streaming_harness.py` |
| US-5 (Per-agent distribution) | `test_distributed_agents.py`, `test_distributed_mode_binding.py` | — |
| US-6 (RAG reliability) | `test_rag_tools_hard_stop.py`, `test_final_result_content.py` | `test_rag_streaming.py` |
| US-7 (Slack narrative) | `test_slack_narrative_streaming.py`, `test_final_result_content.py` | `test_streaming_harness.py` |

### Adding new test fixtures

```bash
# Create a fixture from a real A2A response (optional — for future tests)
curl -N http://localhost:10010/a2a \
  -H "Content-Type: application/json" \
  -d '{"task":{"message":{"parts":[{"text":"test query"}]}}}' \
  > tests/fixtures/captured_a2a_stream.json
```
