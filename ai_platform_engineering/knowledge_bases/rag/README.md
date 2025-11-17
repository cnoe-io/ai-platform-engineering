# 🚀 CAIPE RAG

[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python)](https://www.python.org/)
[![UV](https://img.shields.io/badge/uv-0.1%2B-blue?logo=python)](https://github.com/astral-sh/uv)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](LICENSE)

---

## Overview

- 🤖 **Intelligent Knowledge Platform** with autonomous ontology discovery and RAG-powered question answering across multiple data sources.
- 🧠 **Ontology Agent:** AI agent that automatically discovers and evaluates entity relationships from graph data using heuristics and LLM evaluation.
- 🔍 **RAG/GraphRAG Agent:** Retrieval-augmented generation system for answering questions using vector embeddings and graph traversal.
- 🌐 **Ingestion and Indexing:** Supports ingestion of URLs, as well as ingestors for AWS, Kubernetes, Backstage, and other data sources.
- 📊 **Graph Database Integration:** Uses Neo4j for both data storage and ontology relationship management.
- 🖥️ **Web Interface:** React-based UI for exploring ontologies, searching data, and visualizing relationships.

![CAIPE RAG Demo](docs/rag_gif.gif)

## Getting Started

### 1️⃣ Prerequisites

- Docker and Docker Compose
- Environment variables configured in `.env`

### 2️⃣ Start all services

```bash
# Start all services using Docker Compose
docker compose --profile apps up
```
### 3️⃣ Access the Interface

Interfaces:

  - Web UI: [http://localhost:9447](http://localhost:9447)
  - API Docs: [http://localhost:9446/docs](http://localhost:9446/docs)
  - (Advanced) Neo4j Browser: [http://localhost:7474](http://localhost:7474)
  - (Advanced) Milvus Studio: [http://localhost:9091](http://localhost:9091)
For detailed architecture information, see [Architecture.md](Architecture.md).

---

## Features

### Ontology Agent
- Automatic relationship discovery using heuristics
- LLM-powered evaluation of relationship candidates
- Progress tracking with real-time status updates
- Background processing with concurrent task management

### RAG System
- Document ingestion and chunking
- Vector embeddings with Milvus storage
- Semantic search and retrieval
- LLM-powered question answering

### Web Interface
- Interactive graph visualization
- Real-time agent status with progress indicators
- Search functionality across all data
- Entity exploration and relationship browsing

---

## Local Development

Clone the repo locally.

Navigate to `ai-platform-engineering/knowledge_bases/rag`

Run the dependent services:

```bash
docker compose --profile deps up
```

This will start:

- Neo4j (data graph database)
- Neo4j Ontology (ontology graph database)
- Milvus (vector database)
- MinIO (object storage for Milvus)
- Etcd (configuration for Milvus)
- Redis (key-value store)

Then navigate to the different components and run them:

 - server: `uv sync; source ./.venv/bin/activate; python3 src/server/__main__.py`
 - agent_ontology: `uv sync; source ./.venv/bin/activate; python3 src/agent_ontology/restapi.py`
 - agent_rag: `uv sync; source ./.venv/bin/activate; python3 src/agent_rag/restapi.py`
 - webui: `npm run dev`