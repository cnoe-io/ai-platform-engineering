---
sidebar_position: 1
id: 034-oom-protection-summary-architecture
sidebar_label: Architecture
---

# Architecture: ADR: ArgoCD Agent - OOM Protection Strategy

**Date**: 2025-11-05

## Solution Architecture

### Layer 1: Strict Pagination at MCP Tool Level ✅

**What**: All list operations in MCP ArgoCD tools enforce pagination limits.

**Implementation**:
- `list_applications()`, `project_list()`, `applicationset_list()`, `cluster_service__list()`
- Default: `page_size=20`, max: `100`
- Returns pagination metadata with each response

**Files**:
- `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_applications.py`
- `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_projects.py`
- `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_applicationsets.py`
- `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/api_v1_clusters.py`

**Benefits**:
- Limits data fetched from ArgoCD API
- Reduces JSON parsing memory overhead
- Prevents large payloads from entering the system

---

### Layer 2: Search Tool for Efficient Filtering ✅

**What**: Unified search tool that filters across all ArgoCD resources client-side.

**Implementation**:
- `search_argocd_resources()` with regex-based filtering
- Searches names, descriptions, labels, annotations, repos, etc.
- Returns paginated results after filtering

**File**: `ai_platform_engineering/agents/argocd/mcp/mcp_argocd/tools/search.py`

**Benefits**:
- Reduces the number of items the LLM needs to process
- More efficient than listing all and filtering in prompt
- Supports case-sensitive/insensitive search

---

### Layer 3: LLM Prompt Engineering ✅

**What**: Agent system prompt guides LLM to:
1. **Prefer search tool** for keyword-based queries
2. **Use pagination** when listing resources
3. **Summarize large result sets** (>50 items)
4. **Show only first 20 items** in detail to stay under 16K output token limit

**Implementation**:
```
**CRITICAL - Tool Selection Strategy**:
1. ALWAYS prefer Search_Argocd_Resources for keyword queries
2. Use list tools ONLY when user asks for "all" or "list all"

**CRITICAL - Output Token Limits & Pagination**:
1. If result >50 items:
   - Start with "This is PAGE 1 of X items"
   - Add summary section
   - Show first 20 items in table
   - End with pagination instructions
2. If result ≤50 items:
   - Show all items
```

**File**: `ai_platform_engineering/agents/argocd/agent_argocd/protocol_bindings/a2a_server/agent.py`

**Benefits**:
- Prevents LLM from generating 80K+ token responses
- Avoids stream disconnection and memory spikes
- Guides user to use pagination or filters

---

### Layer 4: Context Window Management ✅

**What**: Aggressive context trimming and message history management.

**Configuration** (in `docker-compose.dev.yaml`):
```yaml
MAX_CONTEXT_TOKENS: 20000          # Lower limit to trigger trimming sooner
MIN_MESSAGES_TO_KEEP: 2            # Keep minimal conversation history
ENABLE_AUTO_COMPRESSION: true      # Compress old messages
SUMMARIZE_TOOL_OUTPUTS: true       # Summarize large tool outputs
MAX_TOOL_OUTPUT_LENGTH: 5000       # Truncate tool outputs >5000 chars
```

**Implementation**: `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`

**Benefits**:
- Prevents context from growing unbounded
- Reduces memory footprint of conversation history
- Allows longer sessions without OOM

---

### Layer 5: Docker Resource Limits ✅

**What**: Hard memory limits and reservations at container level.

**Configuration** (in `docker-compose.dev.yaml`):
```yaml
agent-argocd-p2p:
  mem_limit: 4g              # Hard limit - container killed if exceeded
  mem_reservation: 2g        # Soft limit - guaranteed allocation
```

**Benefits**:
- Prevents agent from consuming all host memory
- Provides early warning via `docker stats`
- Graceful OOMKill rather than system-wide issues

---


## Additional Safeguards to Consider

### 1. Max Response Size Limit (RECOMMENDED) 🔧

Add a hard limit on search tool response sizes:

```python
# In search.py
MAX_SEARCH_RESULTS = 1000  # Never return more than 1000 items total

# After fetching all results
if len(all_results) > MAX_SEARCH_RESULTS:
    return {
        "error": f"Query returned {len(all_results)} results, exceeding limit of {MAX_SEARCH_RESULTS}. Please refine your search.",
        "suggestion": "Use more specific search terms or filter by resource_types"
    }
```

### 2. Streaming Tool Outputs (FUTURE ENHANCEMENT)

Instead of returning full JSON:
- Stream tool results in chunks
- Allow LLM to process incrementally
- Reduces peak memory usage

### 3. Response Size Monitoring (RECOMMENDED) 🔧

Add logging to track response sizes:

```python
# In agent.py, after tool execution
tool_output_size = len(json.dumps(tool_result))
if tool_output_size > 100_000:  # 100KB
    logger.warning(f"Large tool output: {tool_output_size} bytes from {tool_name}")
```

### 4. Circuit Breaker Pattern (ADVANCED)

If OOM occurs:
- Automatically reduce `MAX_CONTEXT_TOKENS` by 50%
- Force search tool usage for all queries
- Alert monitoring system

---


## Monitoring Recommendations

### Key Metrics to Track

1. **Container Memory**:
   ```bash
   docker stats agent-argocd-p2p --format "{{.MemUsage}} / {{.MemLimit}} ({{.MemPerc}})"
   ```

2. **OOM Events**:
   ```bash
   docker inspect agent-argocd-p2p --format '{{.State.OOMKilled}}'
   ```

3. **Tool Output Sizes** (add to logs):
   - Average tool output size
   - 95th percentile output size
   - Max output size per tool

4. **Context Window Usage** (add to logs):
   - Current token count before/after trimming
   - Number of messages in history
   - Frequency of trimming events

### Alerting Thresholds

- **Warning**: Memory usage > 75% (3 GiB)
- **Critical**: Memory usage > 90% (3.6 GiB)
- **Alert**: Any OOMKilled event
- **Alert**: Tool output > 200KB

---


## Related

- Spec: [spec.md](./spec.md)
