---
sidebar_position: 11
---

# NexiGraph - Knowledge graph generation and RAG system for strucutred data

🚧 This page is still under construction 🚧

NexiGraph is a knowledge graph system, that can be used to store and retrieve structured documents (e.g. JSON). It can automatically create relations between documents, and allow for GraphRAG. The Question & Answer agent is an example of GraphRAG enabled agent.

It has the following components:
 - `server`: The server that exposes endpoints to submit strucutred document. It exposes the API through REST and MCP.
 - `agent_fkey`: An agent that analyses foreign key relationships between the documents and automatically creates relations.
 - `agen_qa`: An agent that can answer questions based on the knowledge graph. It exposes the chat interface through A2A.
 - `client`: Client uses the server API to submit documents. Examples of clients can be found in the `nexigraph/clients` directory.

## ✨ Features

- 📂 Ready-made clients to import data from AWS, Backstage, K8s.
- 🔗 Auto creation of relations
- 💬 A2A enabled query agent to query the graph database

## 🚀  How to run

Pre-requisites:
 - docker
 - docker-compose
 - make
 - uv

Run the following command to start the nexigraph service locally:

```bash
export AZURE_OPENAI_ENDPOINT=<azure-openai-endpoint> OPENAI_API_VERSION=<azure-openai-version> AZURE_OPENAI_API_KEY=<azure-openai-token>
docker-compose up
```

This will start the components mentioned above. The different components will come up at different times and retry until they connect with each other.
A dummy_client will populate dummy data into the graph database

The following should be accessible:
  - The Neo4J Graph database should be available at [http://localhost:7474/](http://localhost:7474/).
  - The server UI at [http://localhost:8095/admin](http://localhost:8095/admin)
    - Once the data is populated, click `Process and Evaluate All` button
  - Question and answer agent A2A interface at [http://localhost:8096/](http://localhost:8096/.well-known/agent.json)

How to query:
 - Once the relations are created you can ask question on the graph database by:
 - `docker run -it -e A2A_HOST=host.docker.internal -e A2A_PORT=8096 ghcr.io/cnoe-io/agent-chat-cli:latest`