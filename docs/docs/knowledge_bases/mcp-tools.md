# MCP Tools

The RAG server exposes MCP (Model Context Protocol) tools that enable AI agents to search, fetch, and explore the knowledge base. These tools provide a standardized interface for LLMs to access organizational knowledge.

For configuration details, see the [Server README](https://github.com/cnoe-io/ai-platform-engineering/tree/main/ai_platform_engineering/knowledge_bases/rag/server/README.md).

## What is MCP?

Model Context Protocol (MCP) is an open standard for connecting AI models to external tools and data sources. Instead of custom integrations, MCP provides:

- **Standardized tool interface** for any MCP-compatible client
- **Streaming responses** via Server-Sent Events (SSE)
- **Tool discovery** so agents know what capabilities are available

## Connecting to CAIPE RAG

### MCP Endpoint

```
http://localhost:9446/mcp
```

### Compatible Clients

Any MCP-compatible client can connect:

- Claude Desktop
- VS Code with GitHub Copilot
- Cursor
- Continue
- Custom LangChain/LangGraph agents

### Example: Claude Desktop Configuration

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "caipe-rag": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-client", "http://localhost:9446/mcp"]
    }
  }
}
```

## Search + Fetch Pattern

The MCP tools follow a **search + fetch pattern** that mirrors how humans use search engines:

1. **Search** returns truncated snippets (500 chars) with metadata
2. **Scan** results to identify relevant documents
3. **Fetch** full content of specific documents

This pattern is token-efficient: agents scan many results quickly, then fetch only what they need.

## Available Tools

### Core Search Tools

#### `search`

Hybrid semantic and keyword search across all indexed content.

**Parameters:**
- `query` (required): Search query string
- `top_k`: Number of results (default: 10)
- `bias`: Search strategy - `"semantic"` or `"keyword"` (default: balanced)
- `filters`: Metadata filters (see below)

**Returns:** List of results with truncated content (500 chars), scores, and metadata.

**Use when:** Finding relevant documents, exploring a topic, answering questions.

#### `fetch_document`

Retrieve full content of a specific document by ID.

**Parameters:**
- `document_id` (required): Document ID from search results

**Returns:** Complete document content and metadata.

**Use when:** Need full context after identifying a relevant document via search.

#### `fetch_datasources_and_entity_types`

List all available datasources and entity types in the knowledge base.

**Parameters:** None

**Returns:** List of datasources with their entity types.

**Use when:** Discovering what data is available, building filters.

### Graph Exploration Tools

These tools are available when Graph RAG is enabled (`ENABLE_GRAPH_RAG=true`).

#### `graph_explore_ontology_entity`

Explore entity type schemas and their relationships.

**Parameters:**
- `entity_type` (required): Type name (e.g., "Pod", "Deployment")
- `hops`: Relationship depth (1-3, default: 1)

**Returns:** Entity type schema with properties and connected relationship types.

**Use when:** Understanding the knowledge graph schema, discovering what relationships exist.

#### `graph_explore_data_entity`

Explore a specific entity instance and its neighborhood.

**Parameters:**
- `entity_type` (required): Type name
- `entity_id` (required): Entity identifier
- `hops`: Relationship depth (1-3, default: 1)

**Returns:** Entity with properties and related entities.

**Use when:** Investigating a specific resource and its connections.

#### `graph_fetch_data_entity_details`

Get complete properties and all relations for an entity.

**Parameters:**
- `entity_type` (required): Type name
- `entity_id` (required): Entity identifier

**Returns:** Full entity details including all properties and relationships.

**Use when:** Need complete information about a specific entity.

#### `graph_shortest_path_between_entity_types`

Find relationship paths between two entity types.

**Parameters:**
- `source_type` (required): Starting entity type
- `target_type` (required): Ending entity type

**Returns:** Path in Cypher notation showing relationship chain.

**Use when:** Understanding how entity types are connected, planning graph queries.

#### `graph_raw_query_data` / `graph_raw_query_ontology`

Execute custom read-only Cypher queries.

**Parameters:**
- `query` (required): Cypher query string (read-only)

**Returns:** Query results (limited to configured max results).

**Use when:** Complex queries that can't be expressed with other tools.

**Note:** Queries are automatically scoped to the correct tenant labels (`NxsDataEntity` or `NxsSchemaEntity`).

## Filtering

Search and exploration tools support metadata filters:

| Filter Key | Description | Example |
|------------|-------------|---------|
| `datasource_id` | Filter by data source | `"aws-production"` |
| `ingestor_id` | Filter by ingestor | `"k8s-ingestor"` |
| `is_graph_entity` | Only graph entities | `true` |
| `graph_entity_type` | Filter by entity type | `"Pod"` |
| `document_type` | Filter by document type | `"runbook"` |

Filters are combined with AND logic.

## Example Agent Workflow

Here's how an AI agent might use these tools to answer "What pods are running on node worker-1?":

1. **Discover schema:**
   ```
   fetch_datasources_and_entity_types()
   → Sees "Pod" and "Node" entity types from k8s datasource
   ```

2. **Explore relationships:**
   ```
   graph_explore_ontology_entity(entity_type="Pod", hops=1)
   → Sees Pod has "RUNS_ON" relationship to Node
   ```

3. **Find the node:**
   ```
   search(query="worker-1", filters={"graph_entity_type": "Node"})
   → Gets Node entity ID
   ```

4. **Explore node's pods:**
   ```
   graph_explore_data_entity(entity_type="Node", entity_id="worker-1", hops=1)
   → Gets all Pods connected to this Node
   ```

## Configuration

### Enable/Disable MCP

```bash
ENABLE_MCP=true  # default
```

### Result Truncation

```bash
SEARCH_RESULT_TRUNCATE_LENGTH=500  # Characters per result in search
```

### Graph Query Limits

```bash
MAX_GRAPH_RAW_QUERY_RESULTS=100   # Max entities per query
MAX_GRAPH_RAW_QUERY_TOKENS=80000  # Max tokens in results
```

## Further Reading

- [Server Architecture](https://github.com/cnoe-io/ai-platform-engineering/tree/main/ai_platform_engineering/knowledge_bases/rag/server/ARCHITECTURE.md) - MCP implementation details
- [Architecture Overview](architecture.md) - System-level architecture
- [MCP Specification](https://modelcontextprotocol.io/) - Official MCP documentation
