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

## Quick Start

```bash
# Start all services
docker compose --profile apps up
```

**Access Points:**
- Web UI: [http://localhost:9447](http://localhost:9447)
- API Docs: [http://localhost:9446/docs](http://localhost:9446/docs)
- Neo4j Browser: [http://localhost:7474](http://localhost:7474)

If you have Claude code, VS code, Cursor etc. you can connect upto the MCP server running at http://localhost:9446/mcp

**Documentation:**
- [Architecture Overview](Architecture.md) - System architecture and data flows
- [Server](server/README.md) - Core API and orchestration layer
- [Ontology Agent](agent_ontology/README.md) - Autonomous schema discovery
- [Web UI](webui/README.md) - Frontend interface and visualization
- [Ingestors](ingestors/README.md) - Data source integrations

## Connections

DEFAULT port configurations between components:

**Server (Port 9446):**
- Connects to Neo4j over `7687` (bolt protocol)
- Connects to Redis over `6379`
- Connects to Milvus over `19530`
- Proxies to agent_ontology over `8098`
- Serves Web UI and exposes REST API

**Ontology Agent (Port 8098):**
- Connects to Neo4j over `7687`
- Connects to Redis over `6379`
- Proxies queries from Server

**Web UI (Port 9447):**
- Connects to Server over `9446` (REST)

**CAIPE Agent (MCP):**
- Connects to Server over `9446` (MCP tools)

**Ingestors:**
- Connect to Server over `9446` (REST)
- Connect to Redis over `6379` (webloader ingestor)

**Databases:**
- Neo4j Data: `7687` (bolt), `7474` (browser)
- Neo4j Ontology: `7687` (bolt) - separate database
- Milvus: `19530` (gRPC)
- Redis: `6379`

---

## Local Development

Start dependent services only:

```bash
docker compose --profile deps up
```

Run components individually:

```bash
# Server
cd server && uv sync && source .venv/bin/activate && python3 src/server/__main__.py

# Ontology Agent
cd agent_ontology && uv sync && source .venv/bin/activate && python3 src/agent_ontology/restapi.py

# Web UI
cd webui && npm install && npm run dev
```