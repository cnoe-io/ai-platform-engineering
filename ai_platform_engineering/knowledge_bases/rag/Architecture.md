# Architecture

## Core Components

- **Server:** Main REST API server with metadata storage and loader functionality
- **Ontology Agent:** Autonomous agent that discovers entity relationships using heuristics and LLM evaluation
- **RAG Agent:** Retrieval-augmented generation system for question answering
- **Connectors:** Modular data ingestion from AWS, Kubernetes, Backstage, and other sources
- **Web UI:** React-based interface for exploring data and ontologies

## Data Flow

1. **Docs Data Ingestion:** Use UI or API to ingest documents via URLs.
2. **Graph Data Ingestion:** Connectors pull data from various sources into the graph database (Neo4j).
3. **Ontology Discovery:** Ontology agent analyzes data patterns and discovers relationships in the graph database, and applies them to all entities.
4. **Query & Search:** Users interact via web UI to explore data and ask questions.

## Component Details

### Server
The main REST API server provides:
- Metadata storage and management
- Document ingestion and chunking
- Vector embeddings and storage in Milvus
- API endpoints for data access and exploration
- Integration with connectors (AWS, K8s, Backstage, URLs)

### Ontology Agent
The ontology agent is responsible for:
- Analyzing entity patterns in the graph database
- Discovering potential relationships using heuristics
- Evaluating relationship candidates with LLM assistance
- Managing relationship acceptance/rejection thresholds
- Background processing with progress tracking

### RAG Agent
The RAG system handles:
- Semantic search and retrieval
- LLM-powered question answering
- Integration with graph data for enhanced context

### Connectors
Modular connectors support various data sources to ingest into the graph database:
- **AWS Connector:** Ingests AWS resources
- **Kubernetes Connector:** Pulls K8s cluster resources
- **Backstage Connector:** Pulls Backstage service catalogs

### Web UI
React-based interface providing:
- Interactive graph visualization
- Search functionality across all data
- Entity exploration and relationship browsing

## Technology Stack

### Databases
- **Neo4j:** Primary graph database for data storage
- **Neo4j Ontology:** Separate instance for ontology relationships
- **Milvus:** Vector database for embeddings storage
- **Redis:** Key-value store for caching and state management

### Backend
- **Python 3.13+** with UV package manager
- **FastAPI** for REST API services
- **LangChain** for LLM integration
- **LangGraph** for agent workflows

### Frontend
- **React** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** for styling

### Infrastructure
- **Docker** and **Docker Compose** for containerization
- **MinIO** for object storage
- **Etcd** for configuration management
