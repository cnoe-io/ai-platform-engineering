# RAG Smart Snippets + MCP Tool Invocation

## Overview

This document outlines the implementation plan for:

1. **Smart snippet extraction** - Extract relevant text windows around query matches instead of naive truncation
2. **MCP tool invocation endpoint** - REST API to invoke MCP tools directly for debugging
3. **Enhanced SearchView** - UI with MCP tool selector to simulate what LLMs see
4. **Remove `/v1/query` endpoint** - Consolidate search through MCP tools only

## Problem Statement

Current RAG MCP search tools truncate document content to the first 500 characters:

```python
text = result.document.page_content
if len(text) > search_result_truncate_length:
    text = text[:search_result_truncate_length] + "... [truncated]"
```

This often returns irrelevant navigation/header content instead of the actual matching content.

## Solution

Implement intelligent snippet extraction that:
1. Includes title + description from metadata (if available)
2. Finds query terms in page_content using word boundary matching
3. Extracts diverse, non-overlapping snippets around matches
4. Highlights matching terms with `**bold**` markers
5. Falls back to first N chars if no matches found

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RAG Server                                      │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │                    snippet_utils.py (NEW)                                ││
│  │  Shared logic: extract_query_terms, extract_diverse_snippets,            ││
│  │                highlight_terms, format_search_result                     ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│                              │                                               │
│              ┌───────────────┴───────────────┐                               │
│              ▼                               ▼                               │
│       ┌─────────────┐               ┌───────────────────┐                    │
│       │  tools.py   │               │   restapi.py      │                    │
│       │ MCP search  │               │ POST /v1/mcp/invoke                    │
│       │   tools     │               │ GET  /v1/mcp/tools │                   │
│       └─────────────┘               └───────────────────┘                    │
│                                              │                               │
└──────────────────────────────────────────────┼───────────────────────────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           UI - SearchView.tsx                                 │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  [MCP Tool Selector ▾]  [search]  [search_kubernetes_docs]  [custom...] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Search Input: [_________________________________] [Search]              │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Results (MCP Format Preview)                                           │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │  **Title:** Kubernetes Pod Scheduling                             │  │  │
│  │  │  **Description:** How K8s scheduler assigns pods to nodes.        │  │  │
│  │  │  **Snippet:** ...uses **node selectors** and affinity rules...    │  │  │
│  │  │  [...more content...]                                             │  │  │
│  │  │  **Source:** https://k8s.io/docs/scheduling                       │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Output Format

The formatted search result will look like:

```
**Title:** Kubernetes Pod Scheduling

**Description:** How K8s scheduler assigns pods to nodes using affinity rules.

**Snippet:** ...the scheduler uses **node selectors** and affinity rules to determine...
[...]
...for **pod** **placement** across the cluster nodes...

**Source:** https://docs.example.com/k8s/scheduling
```

## Files to Modify/Create

| File | Type | Complexity | Lines Changed |
|------|------|------------|---------------|
| **Backend** |
| `server/src/server/snippet_utils.py` | **NEW** | Medium | ~150 |
| `server/src/server/tools.py` | Modify | Low | ~10 |
| `server/src/server/restapi.py` | Modify | Medium | ~100 (add invoke + schema endpoint) |
| `server/src/server/restapi.py` | Modify | Low | ~-30 (remove /v1/query) |
| `common/src/common/models/server.py` | Modify | Low | ~20 |
| `server/tests/test_snippet_utils.py` | **NEW** | Low | ~100 |
| **Frontend** |
| `ui/src/components/rag/SearchView.tsx` | Modify | Medium | ~150 |
| `ui/src/components/rag/api/index.ts` | Modify | Low | ~30 |
| `ui/src/components/rag/Models.ts` | Modify | Low | ~15 |

**Total: ~555 lines changed**

## Backend Implementation

### 1. `snippet_utils.py` (NEW)

Zero-dependency module using only Python stdlib.

```python
"""
Snippet extraction utilities for RAG search results.
Zero external dependencies - uses only Python stdlib.
"""
import re
from typing import Optional

# Common English stop words (~60 words)
STOP_WORDS: set[str] = {
    "a", "an", "the", "i", "me", "my", "we", "our", "you", "your", 
    "he", "she", "it", "they", "them", "is", "are", "was", "were", 
    "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "can",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
    "and", "or", "but", "if", "then", "so", "because",
    "what", "which", "who", "where", "when", "why", "how",
    "this", "that", "these", "those", "there", "here",
    "all", "any", "some", "no", "not", "only", "just", "also", "very",
}

DEFAULT_SNIPPET_LENGTH = 400
DEFAULT_CONTEXT_WINDOW = 120
MAX_SNIPPETS = 3


def extract_query_terms(query: str) -> list[str]:
    """
    Tokenize query, remove stop words, sort by length (longer = more specific).
    """
    words = re.findall(r'\b[a-zA-Z0-9]+\b', query.lower())
    terms = [w for w in words if w not in STOP_WORDS and len(w) > 1]
    return sorted(set(terms), key=len, reverse=True)


def find_match_positions(text: str, terms: list[str]) -> list[tuple[int, int, str]]:
    """
    Find all positions of terms using word boundary matching.
    Returns [(start, end, matched_term), ...] sorted by position.
    """
    positions = []
    text_lower = text.lower()
    
    for term in terms:
        # Word boundary regex - also matches term variations
        pattern = re.compile(rf'\b({re.escape(term)}\w*)\b', re.IGNORECASE)
        for match in pattern.finditer(text):
            positions.append((match.start(), match.end(), term))
    
    return sorted(positions, key=lambda x: x[0])


def extract_diverse_snippets(
    text: str,
    positions: list[tuple[int, int, str]],
    max_snippets: int = MAX_SNIPPETS,
    window_size: int = DEFAULT_CONTEXT_WINDOW,
    max_total_chars: int = DEFAULT_SNIPPET_LENGTH,
) -> list[str]:
    """
    Extract multiple non-overlapping snippets, maximizing position diversity.
    Strategy: select from start, end, then middle of document.
    """
    # Implementation details in actual file...


def highlight_terms_in_snippet(snippet: str, terms: list[str]) -> str:
    """Wrap term matches with **bold** markers, preserving original case."""
    result = snippet
    for term in terms:
        pattern = re.compile(rf'\b({re.escape(term)}\w*)\b', re.IGNORECASE)
        result = pattern.sub(r'**\1**', result)
    return result


def format_search_result(
    page_content: str,
    metadata: dict,
    query: str,
    max_total_length: int = DEFAULT_SNIPPET_LENGTH,
) -> str:
    """
    Format a search result with metadata + diverse highlighted snippets.
    """
    # Implementation details in actual file...
```

### 2. `restapi.py` - New Endpoints + Remove `/v1/query`

**Remove the legacy `/v1/query` endpoint:**
```python
# DELETE THIS ENDPOINT - replaced by /v1/mcp/invoke
@app.post("/v1/query", response_model=List[QueryResult])
async def query_documents(query_request: QueryRequest, ...):
    ...
```

**Add new endpoint `GET /v1/mcp/tools/schema` - Full MCP tool schemas:**

Returns all registered MCP tools with their JSON schemas from FastMCP. This future-proofs
the API for dynamic form generation while the UI initially only implements search forms.

```python
@app.get("/v1/mcp/tools/schema", tags=["MCP Tools"])
async def list_mcp_tools_with_schema(user: UserContext = Depends(require_role(Role.READONLY))):
    """
    List all registered MCP tools with their full JSON schemas.
    Includes both built-in and custom tools.
    
    Returns tool definitions from FastMCP including:
    - name: Tool identifier
    - description: Human-readable description  
    - parameters: JSON Schema for input parameters
    - category: 'search' | 'graph' | 'utility'
    """
    tools = await mcp.get_tools()
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,  # Full JSON schema
            "category": _categorize_tool(tool.name),
        }
        for name, tool in tools.items()
        if tool.enabled
    ]

def _categorize_tool(name: str) -> str:
    if "search" in name or name == "search":
        return "search"
    elif name.startswith("graph_"):
        return "graph"
    return "utility"
```

**Example response from `/v1/mcp/tools/schema`:**
```json
[
  {
    "name": "search",
    "description": "Search for relevant documents and graph entities...",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {"type": "string"},
        "filters": {"type": "object"},
        "limit": {"type": "integer", "default": 10},
        "keyword_search": {"type": "boolean", "default": false},
        "thought": {"type": "string", "default": ""}
      },
      "required": ["query"]
    },
    "category": "search"
  },
  {
    "name": "search_kubernetes_docs",
    "description": "Search Kubernetes documentation only",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {"type": "string"},
        "limit": {"type": "integer", "default": 10},
        "keyword_search": {"type": "boolean", "default": false},
        "thought": {"type": "string", "default": ""}
      },
      "required": ["query"]
    },
    "category": "search"
  },
  {
    "name": "graph_explore_data_entity",
    "description": "Explore a data entity...",
    "parameters": {
      "type": "object", 
      "properties": {
        "entity_type": {"type": "string"},
        "primary_key": {"type": "string"},
        "depth": {"type": "integer", "default": 1},
        "thought": {"type": "string", "default": ""}
      },
      "required": ["entity_type", "primary_key"]
    },
    "category": "graph"
  }
]
```

Note: Search tools have varying parameters - `filters` is only present when `allow_runtime_filters=true`
in the tool config. The UI should inspect the schema to determine which fields to display.

**Add new MCP invoke endpoint:**
```python
class MCPToolInvokeRequest(BaseModel):
    """Request to invoke an MCP tool via REST API."""
    tool_name: str = Field(..., description="Name of the MCP tool to invoke")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="Tool arguments")


class MCPToolInvokeResponse(BaseModel):
    """Response from MCP tool invocation."""
    tool_name: str
    result: Any
    execution_time_ms: float


@app.post("/v1/mcp/invoke", tags=["MCP Tools"])
async def invoke_mcp_tool(
    request: MCPToolInvokeRequest,
    user: UserContext = Depends(require_role(Role.READONLY))
) -> MCPToolInvokeResponse:
    """
    Invoke an MCP search tool directly via REST API.
    Useful for debugging and testing tool behavior from the UI.
    """
    # Implementation handles built-in tools (search, fetch_document)
    # and custom search tools from MCPToolConfig
```

### 3. `tools.py` - Integration

Replace truncation logic with smart snippet extraction:

```python
from server.snippet_utils import format_search_result

# In _search_internal(), replace:
text = format_search_result(
    page_content=result.document.page_content,
    metadata=result.document.metadata,
    query=query,
    max_total_length=search_result_truncate_length
)
```

## Frontend Implementation

### 1. SearchView.tsx Changes

**New state for MCP tool selection:**
```tsx
// Fetch all tool schemas (future-proof for dynamic forms)
const [toolSchemas, setToolSchemas] = useState<MCPToolSchema[]>([]);
const [selectedTool, setSelectedTool] = useState<string>('search');
const [mcpResult, setMcpResult] = useState<MCPToolInvokeResponse | null>(null);

// Filter to only search tools for now (UI only implements search form)
const searchTools = useMemo(() => 
    toolSchemas.filter(t => t.category === 'search'),
    [toolSchemas]
);

// Check if selected tool supports filters (by inspecting schema)
const selectedToolSchema = useMemo(() => 
    toolSchemas.find(t => t.name === selectedTool),
    [toolSchemas, selectedTool]
);
const supportsFilters = selectedToolSchema?.parameters?.properties?.filters !== undefined;
```

**Fetch tool schemas on mount:**
```tsx
useEffect(() => {
    const fetchToolSchemas = async () => {
        try {
            const schemas = await getMCPToolSchemas();
            setToolSchemas(schemas);
        } catch (error) {
            console.error('Failed to fetch MCP tool schemas:', error);
        }
    };
    fetchToolSchemas();
}, []);
```

**Tool selector dropdown (only shows search tools):**
```tsx
<select
    value={selectedTool}
    onChange={(e) => setSelectedTool(e.target.value)}
    className="px-3 py-1.5 rounded-lg border ..."
>
    {searchTools.map(tool => (
        <option key={tool.name} value={tool.name}>
            {tool.name}
        </option>
    ))}
</select>
```

**Conditional filters display (based on schema):**
```tsx
{supportsFilters && (
    <div className="filters-section">
        {/* Filter inputs */}
    </div>
)}
```

**Modified search handler to call `/v1/mcp/invoke`:**
```tsx
const handleQuery = async () => {
    const args: Record<string, unknown> = {
        query,
        limit,
        keyword_search: false,
        thought: "UI search simulation"
    };
    
    // Only include filters if the tool supports them
    if (supportsFilters && Object.keys(filters).length > 0) {
        args.filters = filters;
    }
    
    const response = await invokeMCPTool({
        tool_name: selectedTool,
        arguments: args
    });
    setMcpResult(response);
};
```

### 2. API Client Updates

```typescript
export interface MCPToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            default?: unknown;
            description?: string;
        }>;
        required: string[];
    };
    category: 'search' | 'graph' | 'utility';
}

export interface MCPToolInvokeRequest {
    tool_name: string;
    arguments: Record<string, unknown>;
}

export interface MCPToolInvokeResponse {
    tool_name: string;
    result: unknown;
    execution_time_ms: number;
}

export const getMCPToolSchemas = async (): Promise<MCPToolSchema[]> => {
    return apiGet('/v1/mcp/tools/schema');
};

export const invokeMCPTool = async (
    request: MCPToolInvokeRequest
): Promise<MCPToolInvokeResponse> => {
    return apiPost('/v1/mcp/invoke', request);
};
```

## Diverse Snippet Algorithm

The algorithm maximizes diversity by:

1. Finding all term match positions in the document
2. Building snippet windows around each match (expanding to word boundaries)
3. Selecting non-overlapping snippets with maximum spread (first, last, then middle)
4. Respecting total character limit across all snippets

```python
def extract_diverse_snippets(text, positions, max_snippets=3, max_total_chars=400):
    # Order indices for max spread: [0, -1, 1, -2, 2, ...]
    n = len(windows)
    indices = []
    for i in range((n + 1) // 2):
        if i < n:
            indices.append(i)
        if n - 1 - i > i:
            indices.append(n - 1 - i)
    
    # Greedy selection avoiding overlaps
    for idx in indices:
        if not overlaps and chars_used + snippet_len <= max_total_chars:
            selected.append(snippet)
    
    return selected
```

## Performance Analysis

| Operation | Time per Result | Notes |
|-----------|-----------------|-------|
| `extract_query_terms()` | <0.1ms | Simple string ops |
| `find_match_positions()` | 1-3ms | Regex on ~10KB doc |
| `extract_diverse_snippets()` | <0.5ms | Greedy selection |
| `highlight_terms_in_snippet()` | <0.5ms | Regex replace |
| **Total per result** | **~2-4ms** | |
| **10 results batch** | **~20-40ms** | Acceptable |

**Memory:** No additional dependencies, ~3KB for stop words set.

**Total added latency:** ~25-50ms on top of existing ~100-500ms search latency (<10% increase).

## Test Plan

### Unit Tests (`test_snippet_utils.py`)

```python
def test_extract_query_terms_removes_stop_words():
    assert extract_query_terms("how to deploy kubernetes pods") == ["kubernetes", "deploy", "pods"]

def test_extract_query_terms_sorts_by_length():
    terms = extract_query_terms("k8s kubernetes pod")
    assert terms[0] == "kubernetes"

def test_find_match_positions_word_boundary():
    text = "podman container vs kubernetes pod deployment"
    positions = find_match_positions(text, ["pod"])
    assert len(positions) == 1
    assert text[positions[0][0]:positions[0][1]] == "pod"

def test_extract_diverse_snippets_non_overlapping():
    text = "A" * 100 + "TERM1" + "B" * 200 + "TERM2" + "C" * 100
    positions = [(100, 105, "term1"), (305, 310, "term2")]
    snippets = extract_diverse_snippets(text, positions, max_snippets=2, max_total_chars=300)
    assert len(snippets) == 2

def test_highlight_terms_preserves_case():
    result = highlight_terms_in_snippet("Deploy Kubernetes pods", ["kubernetes"])
    assert "**Kubernetes**" in result

def test_format_search_result_includes_all_sections():
    result = format_search_result(
        page_content="Content about kubernetes deployment",
        metadata={"title": "K8s Guide", "metadata": {"source": "https://k8s.io"}},
        query="kubernetes deployment"
    )
    assert "**Title:** K8s Guide" in result
    assert "**Snippet:**" in result
    assert "**Source:** https://k8s.io" in result
```

## Implementation Order

| Phase | Tasks | Effort |
|-------|-------|--------|
| **Phase 1** | `snippet_utils.py` + unit tests | 2 hrs |
| **Phase 2** | Integrate into `tools.py` | 30 min |
| **Phase 3** | Add `/v1/mcp/tools/schema` endpoint | 45 min |
| **Phase 4** | Add `/v1/mcp/invoke` endpoint + models | 1.5 hrs |
| **Phase 5** | Remove `/v1/query` endpoint | 15 min |
| **Phase 6** | Update `SearchView.tsx` with tool selector | 2 hrs |
| **Phase 7** | Update API client + types | 30 min |
| **Phase 8** | End-to-end testing | 1 hr |
| **Total** | | **~8.5 hrs** |

## Design Decisions

### Why zero-dependency for snippet extraction?

1. Consistency with existing `bm25_search_engine.py` in agent_ontology (also zero-dep)
2. No NLTK/spaCy in current RAG server dependencies
3. Avoids `nltk.download()` issues in containerized environments
4. Simple stop words list + regex sufficient for this use case

### Why multiple snippets instead of one?

User requirement: "each snippet should have representation, but max limit for the result preview should be capped, so the algorithm should try to maximise diversity"

This ensures that if a query has multiple distinct terms matching in different parts of the document, the user/LLM sees context from multiple relevant sections.

### Why remove `/v1/query`?

1. Consolidates all search functionality through MCP tools
2. Ensures UI shows exactly what LLMs see (same formatting, same snippets)
3. Reduces code duplication - one search path instead of two
4. `/v1/mcp/invoke` provides superset of functionality with tool selection

### Why return full MCP schemas from `/v1/mcp/tools/schema`?

1. Future-proofs the API for dynamic form generation (support graph tools later)
2. No backend changes needed when UI adds support for other tool types
3. UI can inspect schemas to determine parameter support (e.g., `filters` is conditional)
4. Consistent with MCP protocol design - tools are self-describing
5. Schema includes `category` field for easy filtering in UI

### Why `/v1/mcp/invoke` instead of direct tool calls?

1. Allows UI to simulate exact MCP tool behavior
2. Useful for debugging tool configurations
3. Shows execution time for performance monitoring
4. Maintains consistent auth/RBAC with other endpoints

## Related Files

- `ai_platform_engineering/knowledge_bases/rag/server/src/server/tools.py` - MCP tool implementations
- `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rag.py` - MCPToolConfig model
- `ui/src/components/rag/SearchView.tsx` - Search UI component
- `ui/src/components/rag/api/index.ts` - RAG API client
