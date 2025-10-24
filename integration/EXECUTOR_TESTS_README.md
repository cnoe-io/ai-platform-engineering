# Platform Engineer Executor Unit Tests

Comprehensive unit tests for `AIPlatformEngineerA2AExecutor` covering all streaming scenarios and routing logic.

## Test Coverage

### 1. Routing Logic (`TestAIPlatformEngineerExecutorRouting`)

Tests that verify the routing decision logic correctly classifies queries:

| Test | Query Example | Expected Route | Purpose |
|------|--------------|----------------|---------|
| `test_route_documentation_query_with_docs_keyword` | "docs duo-sso cli" | DIRECT → RAG | Verifies 'docs' keyword detection |
| `test_route_documentation_query_with_what_is` | "what is caipe?" | DIRECT → RAG | Verifies 'what is' pattern detection |
| `test_route_documentation_query_with_kb_keyword` | "kb search for policy" | DIRECT → RAG | Verifies 'kb' keyword detection |
| `test_route_direct_to_single_agent` | "show me komodor clusters" | DIRECT → Komodor | Single agent detection |
| `test_route_parallel_to_multiple_agents` | "show github repos and komodor clusters" | PARALLEL → GitHub + Komodor | Multiple agent detection |
| `test_route_complex_to_deep_agent` | "who is on call for SRE?" | COMPLEX → Deep Agent | Ambiguous query routing |

### 2. Streaming Behavior (`TestAIPlatformEngineerExecutorStreamingBehavior`)

Tests that verify correct streaming and chunk accumulation:

| Test | Scenario | Validates |
|------|----------|-----------|
| `test_direct_streaming_accumulates_chunks` | Direct routing with multiple chunks | - Chunks are properly accumulated<br>- Final artifact contains complete text |
| `test_non_streaming_receives_complete_response` | Non-streaming `message/send` request | - Final artifact has accumulated text<br>- Critical for UI requests<br>- Prevents "CA" truncation bug |

**Why This Matters:**
- **Streaming clients** (`message/send-streaming`): Get real-time token-by-token chunks
- **Non-streaming clients** (`message/send`): Get complete accumulated text in final artifact
- **Bug Fixed**: Non-streaming requests were only getting first chunk ("CA") instead of full response

### 3. Error Handling (`TestAIPlatformEngineerExecutorErrorHandling`)

Tests that verify graceful degradation and fallback behavior:

| Test | Failure Scenario | Expected Behavior |
|------|------------------|-------------------|
| `test_http_error_fallback_to_deep_agent` | Sub-agent returns 503 | - Falls back to Deep Agent<br>- User still gets a response |
| `test_connection_error_with_partial_results` | Connection drops mid-stream | - Sends partial results to user<br>- Then falls back to Deep Agent |

### 4. Parallel Streaming (`TestAIPlatformEngineerExecutorParallelStreaming`)

Tests that verify parallel execution and result aggregation:

| Test | Scenario | Validates |
|------|----------|-----------|
| `test_parallel_streaming_combines_results` | Query mentions 2+ agents | - Both agents execute in parallel<br>- Results are combined<br>- Source attribution is clear |

## Running the Tests

### Run All Tests
```bash
pytest integration/test_platform_engineer_executor.py -v
```

### Run Specific Test Class
```bash
pytest integration/test_platform_engineer_executor.py::TestAIPlatformEngineerExecutorRouting -v
```

### Run Single Test
```bash
pytest integration/test_platform_engineer_executor.py::TestAIPlatformEngineerExecutorStreaming::test_non_streaming_receives_complete_response -v
```

### Run with Coverage
```bash
pytest integration/test_platform_engineer_executor.py --cov=ai_platform_engineering.multi_agents.platform_engineer --cov-report=html
```

## Test Architecture

### Mocking Strategy

The tests use comprehensive mocking to isolate the executor logic:

1. **Mock RequestContext**: Simulates incoming A2A requests
2. **Mock EventQueue**: Captures all events (artifacts, status updates)
3. **Mock HTTP Client**: Simulates agent card fetches
4. **Mock A2AClient**: Simulates sub-agent streaming responses
5. **Mock Deep Agent**: Simulates fallback behavior

### Key Assertions

#### Routing Assertions
```python
assert decision.type == RoutingType.DIRECT
assert decision.agents[0][0] == 'RAG'
```

#### Streaming Assertions
```python
# Verify final artifact contains complete text
final_artifact = artifact_events[-1][0][0]
assert final_artifact.lastChunk is True
final_text = final_artifact.artifact.parts[0].root.text
assert len(final_text) > 30  # Complete response, not just "CA"
```

#### Error Handling Assertions
```python
# Verify Deep Agent was called as fallback
mock_deep_agent_stream.assert_called_once()
```

## Critical Test: Non-Streaming Response Accumulation

### The Problem
Non-streaming `message/send` requests were only receiving the first chunk ("CA") instead of the complete response:

```json
{
  "artifacts": [
    {
      "parts": [{"text": "CA"}]  // ❌ Incomplete!
    }
  ]
}
```

### The Fix
Modified `_stream_from_sub_agent` to send complete accumulated text in final artifact:

```python
final_text = ''.join(accumulated_text)
await self._safe_enqueue_event(
    event_queue,
    TaskArtifactUpdateEvent(
        lastChunk=True,
        artifact=new_text_artifact(
            text=final_text,  # ✅ Complete text
        ),
    )
)
```

### Test Validation
```python
def test_non_streaming_receives_complete_response(self, executor, ...):
    # Simulate 10 small chunks (like token streaming)
    chunks = ["CA", "IPE", " is", " a", " Commu", "nity", ...]
    
    # Execute
    await executor.execute(mock_context, mock_event_queue)
    
    # Verify final artifact has complete text
    final_text = final_artifact.artifact.parts[0].root.text
    assert "CAIPE is a Community AI Platform Engineering" == final_text
    # Not just "CA" ✅
```

## Recent Fixes Validated by These Tests

### 1. Documentation Keyword Routing (2025-10-21)
- **Issue**: `'docs:'` required colon, so "docs duo-sso" didn't match
- **Fix**: Changed to `'docs'` (no colon)
- **Test**: `test_route_documentation_query_with_docs_keyword`

### 2. Non-Streaming Chunk Accumulation (2025-10-21)
- **Issue**: UI requests only got first chunk ("CA")
- **Fix**: Send complete accumulated text in final artifact
- **Test**: `test_non_streaming_receives_complete_response`

### 3. Error Handling with Partial Results (2025-10-21)
- **Issue**: Connection errors lost all partial data
- **Fix**: Send partial results before fallback
- **Test**: `test_connection_error_with_partial_results`

## Dependencies

```bash
pip install pytest pytest-asyncio pytest-cov
```

## Related Files

- **Source**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py`
- **Integration Tests**: `integration/test_platform_engineer_streaming.py` (end-to-end)
- **Streaming Tests**: `integration/test_rag_streaming.py` (RAG-specific)

## Future Test Additions

Consider adding tests for:
- [ ] Deep Agent timeout handling
- [ ] Concurrent parallel streaming with >2 agents
- [ ] Memory/resource cleanup after streaming
- [ ] Trace ID propagation through routing layers
- [ ] Feature flag toggling (`ENABLE_ENHANCED_STREAMING`)

