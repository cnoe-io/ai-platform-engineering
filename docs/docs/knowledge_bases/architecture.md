# Knowledge Bases architecture

This page describes how CAIPE ingests, authorizes, searches, and serves
organizational knowledge. For implementation details and environment variables,
see
[RAG codebase architecture](https://github.com/caipe-io/ai-platform-engineering/tree/main/ai_platform_engineering/knowledge_bases/rag/Architecture.md).

## Component architecture

```mermaid
flowchart TB
  subgraph Clients
    UI["CAIPE UI"]
    AG["Agents and MCP clients"]
    ING["Ingestors<br/>documents · collaboration · infrastructure"]
  end

  BFF["CAIPE BFF<br/>session and capability checks"]
  RAG["RAG server<br/>REST API · MCP · ingestion · retrieval"]
  AUTH["OIDC + OpenFGA<br/>identity and resource authorization"]
  ONT["Ontology Agent<br/>relationship discovery"]

  subgraph Storage
    MIL[("Milvus<br/>dense + BM25 indexes")]
    NEO[("Neo4j<br/>data + ontology graphs")]
    REDIS[("Redis<br/>metadata + jobs")]
    OBJ[("Object storage + etcd<br/>Milvus dependencies")]
  end

  UI -->|"session request"| BFF
  BFF -->|"bearer token"| RAG
  AG -->|"MCP /mcp"| RAG
  ING -->|"REST /v1/ingest"| RAG
  RAG <--> AUTH
  RAG <--> MIL
  RAG <--> NEO
  RAG <--> REDIS
  MIL --- OBJ
  ONT <--> RAG
  ONT <--> NEO
  ONT <--> REDIS
```

### Core components

| Component | Default port | Responsibility |
|-----------|--------------|----------------|
| **CAIPE UI and BFF** | 3000 | Data source management, collections, search, graph exploration, and authenticated API proxying |
| **RAG server** | 9446 | Ingestion, hybrid search, graph operations, REST APIs, and MCP tools |
| **Ontology Agent** | 8098 | Optional background discovery and validation of entity relationships |
| **Ingestors** | Varies | Retrieve data from external systems and submit normalized content or entities |

OIDC establishes the caller's identity. OpenFGA relationships decide which
knowledge-base actions and resources that identity may use. The RAG server checks
data source access even when a request has already passed through the UI BFF.

## Document ingestion

```mermaid
flowchart LR
  SRC["Document source"]
  N["Normalize and attach<br/>data source metadata"]
  C["Chunk text<br/>with overlap"]
  D["Dense embedding"]
  S["BM25 sparse vector"]
  M[("Milvus")]

  SRC --> N --> C
  C --> D --> M
  C --> S --> M
```

1. An ingestor retrieves source content and associates every item with a data source ID.
2. The RAG server normalizes and chunks the text while preserving useful metadata.
3. An embedding provider creates dense semantic vectors.
4. Milvus produces and indexes BM25 sparse vectors for keyword matching.
5. Milvus stores both representations for filtered hybrid retrieval.

Data source IDs are part of the security boundary. Reloading a data source
replaces its indexed content and removes stale pages while preserving its
ownership and search access.

## Structured-entity ingestion

```mermaid
flowchart LR
  SRC["Structured source<br/>infrastructure or catalog API"]
  P["Parse entities and<br/>split nested structures"]
  V["Create searchable<br/>entity representations"]
  M[("Milvus")]
  N[("Neo4j data graph")]
  O["Ontology Agent"]
  OG[("Ontology graph")]

  SRC --> P --> V
  V --> M
  V --> N
  N --> O --> OG
```

Structured ingestors can submit entities and relationships instead of document
pages. The server splits nested structures into connected entities, makes their
properties searchable, and stores their relationships in Neo4j when Graph RAG
is enabled.

The Ontology Agent examines entity types and properties, finds candidate
relationships, evaluates them, and writes accepted relationships to the
ontology graph.

## Authorized query flow

```mermaid
sequenceDiagram
  actor Caller
  participant UI as CAIPE UI / agent runtime
  participant FGA as OpenFGA
  participant RAG as RAG server
  participant DB as Milvus / Neo4j

  Caller->>UI: Search or agent request
  UI->>FGA: Resolve caller capabilities and resources
  FGA-->>UI: Allowed data source IDs
  UI->>RAG: Query + bearer token + requested scope
  RAG->>FGA: Revalidate data source access
  FGA-->>RAG: Effective data source IDs
  RAG->>DB: Filtered vector or graph query
  DB-->>RAG: Authorized matches
  RAG-->>Caller: Ranked results
```

For a direct search, the requested scope may include every data source the caller
can search. For an agent request, CAIPE intersects that access with the data
sources and collections selected for the agent. Both paths fail closed when
authorization cannot be verified.

## Hybrid retrieval

A query produces a dense vector and a sparse keyword representation. Milvus runs
both searches within the authorized data source filter, then CAIPE combines the
result scores with configurable weights.

| Strategy | Semantic weight | Keyword weight | Useful for |
|----------|-----------------|----------------|------------|
| Balanced | 50% | 50% | General-purpose retrieval |
| Semantic | 90% | 10% | Concepts and paraphrased language |
| Keyword | 10% | 90% | Exact identifiers and terms |

These values describe the standard presets. Deployments can tune the weights for their content and evaluation results.

## Storage and supporting services

| Service | Purpose |
|---------|---------|
| **Milvus** | Dense HNSW and sparse BM25 indexes |
| **Neo4j** | Optional data and ontology graphs |
| **Redis** | Data source metadata, ingestion jobs, and ontology state |
| **Object storage** | Milvus object persistence |
| **etcd** | Milvus metadata coordination |

## Embedding providers

The embedding factory supports provider configurations for:

- Azure OpenAI
- OpenAI
- AWS Bedrock
- Cohere
- Hugging Face
- LiteLLM
- Ollama

Use deployment-owned secrets for credentials. Do not place provider keys in reusable source configuration or documentation examples.

## Port reference

| Port | Service | Protocol |
|------|---------|----------|
| 3000 | CAIPE UI | HTTP |
| 9446 | RAG REST API and MCP server | HTTP / Streamable HTTP |
| 8098 | Ontology Agent | HTTP |
| 7687 | Neo4j | Bolt |
| 7474 | Neo4j Browser | HTTP |
| 19530 | Milvus | gRPC |
| 6379 | Redis | TCP |

Neo4j and the Ontology Agent are required only for the Graph RAG profile.

## Further reading

- [RAG server architecture](https://github.com/caipe-io/ai-platform-engineering/tree/main/ai_platform_engineering/knowledge_bases/rag/server/ARCHITECTURE.md)
- [Ontology Agent](ontology-agent.md)
- [RAG API reference](api-reference.md)
- [Authentication](authentication-overview.md)
