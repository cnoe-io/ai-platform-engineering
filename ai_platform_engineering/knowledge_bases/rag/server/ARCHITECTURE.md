# Server Architecture

The **server** component is the core of the RAG (Retrieval-Augmented Generation) platform. It orchestrates document ingestion, graph entity management, vector search, and exposes MCP (Model Context Protocol) tools for AI agents to interact with the knowledge base.

## Table of Contents

1. [Overview](#overview)
2. [Core Components](#core-components)
3. [Document Ingestion Pipeline](#document-ingestion-pipeline)
4. [Graph Entity Ingestion](#graph-entity-ingestion)
5. [Query & Reranking](#query--reranking)
6. [MCP Tools for AI Agents](#mcp-tools-for-ai-agents)

---

## Overview

The server provides:
- **Unified ingestion pipeline** for documents and graph entities
- **Hybrid search** combining dense (semantic) and sparse (keyword/BM25) vector search
- **Graph RAG** capabilities with Neo4j for knowledge graph management
- **MCP tools** for AI agents to search, fetch, and explore the knowledge base
- **Job management** for tracking ingestion progress
- **Metadata storage** in Redis for datasources, ingestors, and job tracking

### Key Technologies

- **FastAPI**: REST API framework
- **Milvus**: Vector database with hybrid search (dense + sparse vectors)
- **Neo4j**: Graph database for entity relationships (optional, controlled by `ENABLE_GRAPH_RAG`)
- **Redis**: Metadata storage and job queue
- **LangChain**: Document processing and text splitting
- **FastMCP**: Model Context Protocol server implementation

---

## Core Components

### 1. REST API Server (`restapi.py`)

The main FastAPI application that manages the entire application lifecycle.

**Key Responsibilities:**
- Initialize all databases (Milvus, Neo4j, Redis)
- Expose REST endpoints for datasources, jobs, ingestion, and querying
- Proxy requests to the ontology agent service
- Provide health checks and configuration information

**Global Services:**
- `metadata_storage` - Redis-backed metadata for datasources and ingestors
- `vector_db` - Milvus vector database for document search
- `jobmanager` - Tracks ingestion job progress
- `data_graph_db` - Neo4j database for entity data
- `ontology_graph_db` - Neo4j database for entity schemas
- `ingestor` - Document processing pipeline

### 2. Document Processing Pipeline (`ingestion.py`)

Handles all document and entity ingestion, chunking, and transformation.

**Main Class: `DocumentProcessor`**

**Responsibilities:**
- Parse and validate document metadata
- Chunk large documents for efficient storage and retrieval
- Process graph entities (parse, split nested structures, format)
- Coordinate dual storage in vector DB and graph DB

### 3. Query Orchestration (`query_service.py`)

Provides unified query interface with filtering and ranking.

**Main Class: `VectorDBQueryService`**

**Capabilities:**
- Execute hybrid semantic + keyword searches
- Validate and apply metadata filters
- Support weighted reranking strategies

### 4. MCP Tools for AI Agents (`tools.py`)

Implements MCP tools that AI agents use to interact with the knowledge base.

**Main Class: `AgentTools`**

**Provides tools for:**
- **Search**: Hybrid semantic/keyword search with filters
- **Fetch**: Retrieve full document content by ID
- **Graph exploration**: Explore entity neighborhoods, find paths, execute raw queries

---

## Document Ingestion Pipeline

### Flow Overview

```
External Ingestor → REST API → DocumentProcessor → Vector DB + Graph DB
```

### Step-by-Step Process

#### 1. Document Submission

External ingestors submit documents to the `POST /v1/ingest` endpoint. Each request includes:
- Datasource ID
- Job ID for tracking
- List of documents with content and metadata
- Fresh-until timestamp (data expiration)

#### 2. Document Parsing & Metadata Extraction

The DocumentProcessor parses each document's metadata into a structured format including:
- Document ID and title
- Datasource and ingestor identifiers
- Whether it's a graph entity
- Custom metadata fields
- Timestamps for tracking

#### 3. Document Chunking

Large documents are automatically split into manageable chunks:

**Strategy:**
- Splits on paragraph boundaries first, then sentences, then words
- Each chunk overlaps with adjacent chunks to maintain context
- Chunk size is capped at 60,000 characters (Milvus field limit)
- Smaller documents remain as single chunks

**Chunk Metadata:**
Each chunk inherits document metadata and adds:
- Unique chunk identifier
- Position in the document (chunk index)
- Total number of chunks

#### 4. Vector Embedding & Indexing

Chunks are indexed in Milvus with two types of vectors:

**Dense Vector (Semantic):**
- Generated using configured embeddings model (e.g., OpenAI text-embedding-3-small)
- Captures semantic meaning and context
- Uses HNSW index with cosine similarity

**Sparse Vector (Keyword/BM25):**
- Generated using Milvus's built-in BM25 function
- Captures keyword importance and frequency
- Uses inverted index for fast keyword matching

This dual-vector approach enables powerful hybrid search that combines semantic understanding with exact keyword matching.

#### 5. Job Progress Tracking

Throughout ingestion, the system continuously updates job status:
- Updates progress messages
- Increments progress counters
- Records any errors encountered
- Marks completion or failure

---

## Graph Entity Ingestion

When Graph RAG is enabled, the server can ingest **graph entities** - structured data with relationships that are stored in both the vector database (for search) and the graph database (for traversal).

### What is a Graph Entity?

A graph entity is a structured object with:
- **Entity Type**: Classification (e.g., Pod, Deployment, Service)
- **Primary Key Properties**: Unique identifiers (e.g., namespace, name)
- **Additional Properties**: All other attributes
- **Alternative Keys**: Optional alternative identifiers
- **Labels**: Extra categorization tags

### Graph Entity Processing Flow

```
Graph Entity (JSON) → Parse → Split Nested Structures → Format for Search → Dual Storage
```

#### Step 1: Entity Parsing

The system parses the JSON entity from the document's content, validating its structure and ensuring all required fields are present.

#### Step 2: Flattening & Splitting Nested Entities

Graph entities often contain nested structures. The splitting process:

**Flattening Strategy:**
- Properties are flattened using dot notation (e.g., `spec.nodeName`)
- Lists of primitive values are kept as-is
- Lists of complex objects are split into separate child entities

**Why Split?**
- Allows fine-grained relationships in the graph database
- Each nested item can have its own relationships to other entities
- Preserves hierarchy for graph traversal
- Enables more precise queries

**Example Transformation:**

A Pod containing multiple Containers becomes:
1. **Parent Entity**: Pod (without the containers array)
2. **Child Entities**: Individual Container entities (one per container)
3. **Automatic Relations**: Links between Pod and its Containers

Each child entity tracks:
- Its parent entity reference
- Its index in the original array
- Its entity type
- All its own properties

#### Step 3: Entity Sanitization

Properties that exceed the configured length limit (default 250 characters) are removed to prevent bloat in the graph database while maintaining searchability in the vector database.

#### Step 4: Formatting for Vector Search

The system creates a searchable text representation of the entity that emphasizes:
- Entity type and labels at the top
- Primary key properties prominently displayed
- All properties in a structured JSON format

This formatting ensures that the most important identifying information appears early in the text, improving retrieval quality.

#### Step 5: Dual Storage

**Vector Database (Milvus):**
- Stores the formatted entity text as a searchable document
- Metadata includes graph entity type and primary key for linking
- Enables semantic and keyword search across entity properties
- Supports filtering by entity type

**Graph Database (Neo4j):**
- Stores all split entities as nodes
- Creates relationships between parent and child entities
- Enables graph traversal and pattern matching
- Supports complex relationship queries

This dual storage approach gives you the best of both worlds:
- Fast semantic search through Milvus
- Rich relationship traversal through Neo4j

#### Step 6: Batch Ingestion

All entities from a batch of documents are collected and ingested together in large batches (1000 entities per Neo4j transaction) for optimal performance.

---

## Query & Reranking

The query pipeline combines semantic and keyword search with configurable reranking to provide the most relevant results.

### Query Flow

```
User Query → VectorDBQueryService → Milvus Hybrid Search → Weighted Reranking → Sorted Results
```

### Hybrid Search Mechanism

Milvus performs **two searches simultaneously**:

**1. Dense Vector Search (Semantic):**
- Embeds the query using the same embeddings model
- Finds documents with similar semantic meaning
- Works well for conceptual queries

**2. Sparse Vector Search (Keyword/BM25):**
- Tokenizes the query and computes BM25 scores
- Finds documents with matching keywords
- Works well for exact term matching

### Reranking Strategy

The server uses **weighted reranking** to combine both search results:

**Common Presets:**

| Preset | Semantic Weight | Keyword Weight | Best For |
|--------|-----------------|----------------|----------|
| Semantic (default) | 50% | 50% | Balanced search |
| Keyword | 10% | 90% | Exact term matching |

The final score is a weighted combination of both scores, and results are sorted by this final score.

### Filtering

Queries support filtering by metadata fields:

**Valid Filter Keys:**
- `datasource_id` - Filter by data source
- `ingestor_id` - Filter by ingestor
- `is_graph_entity` - Filter for graph entities only
- `graph_entity_type` - Filter by entity type (e.g., Pod)
- `document_type` - Filter by document type

Multiple filters can be combined with AND logic.

---

## MCP Tools for AI Agents

The Model Context Protocol (MCP) tools enable AI agents to interact with the knowledge base efficiently using a **search + fetch pattern**:

**Search Phase:** Returns truncated results (500 chars) with full metadata - fast and token-efficient for scanning multiple results.

**Fetch Phase:** Retrieves full content of specific documents identified in search - provides complete information for detailed analysis.

This pattern mimics how humans use search engines: scan snippets first, then click for full details.

### Available Tools

**Core Tools:**
- `search` - Hybrid semantic/keyword search with filters and bias presets (semantic or keyword-focused)
- `fetch_document` - Retrieve full document content by ID from search results
- `fetch_datasources_and_entity_types` - List available datasources and entity types in the knowledge base

**Graph Tools (when Graph RAG enabled):**
- `graph_explore_ontology_entity` - Explore entity type schemas and their relationships (1-3 hops)
- `graph_explore_data_entity` - Explore specific entity instances and their neighborhoods (1-3 hops)
- `graph_fetch_data_entity_details` - Get complete properties and relations for an entity
- `graph_shortest_path_between_entity_types` - Find relationship paths between entity types in Cypher notation
- `graph_raw_query_data` / `graph_raw_query_ontology` - Execute custom read-only Cypher queries with automatic tenant isolation
