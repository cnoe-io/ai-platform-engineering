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
# Start all services (direct access, no authentication)
docker compose --profile apps up
```

**Access Points:**
- Web UI: [http://localhost:9447](http://localhost:9447)
- API Docs: [http://localhost:9446/docs](http://localhost:9446/docs)
- Neo4j Browser: [http://localhost:7474](http://localhost:7474)

### Quick start with auth (Optional)

To add authentication (via OAuth2 Proxy):

```bash
# Start with OAuth2 proxy
WEBUI_PORT=9448 docker compose --profile apps --profile oauth2 up
```

- Authenticated access: [http://localhost:9447](http://localhost:9447) (via OAuth2 Proxy)
- Direct access: [http://localhost:9448](http://localhost:9448) (bypasses auth)
- OAuth2-only mode: Set `WEBUI_PORT=0` to disable direct access

**Configuration:**

Create `oauth2-proxy.cfg` file in the rag folder with your OIDC provider settings:

```ini
http_address="0.0.0.0:9447"
cookie_secret="<random-string>"
email_domains="example.com"
reverse_proxy="true"
upstreams="http://webui:80"
whitelist_domains=["localhost:9447", "127.0.0.1:9447"]

# Your OIDC provider settings
client_id="YOUR_CLIENT_ID"
client_secret="YOUR_CLIENT_SECRET"
oidc_issuer_url="https://your-provider.com/oidc"
provider="oidc"
redirect_url="http://localhost:9447/oauth2/callback"
```

For full configuration options, see [OAuth2 Proxy documentation](https://oauth2-proxy.github.io/oauth2-proxy/).

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
- If Oauth2Proxy is enabled, it acts as reverse proxy to the web ui.

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