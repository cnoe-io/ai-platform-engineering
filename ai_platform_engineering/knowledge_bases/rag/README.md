# 🚀 RAG AI Agent

[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python)](https://www.python.org/)
[![Poetry](https://img.shields.io/badge/poetry-2.1.1%2B-blueviolet?logo=python)](https://python-poetry.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](LICENSE)

---

## Overview

- 🤖 **RAG Agent** is an LLM-powered agent that can ingest documentation from any URL, web scrape all content, chunk and embed it, and answer questions using Retrieval-Augmented Generation (RAG).
- 🌐 **Protocol Support:** Compatible with the A2A protocol for integration with external user clients.
- 🧠 **Vector Store:** Uses Milvus for storing and retrieving document embeddings ([LangChain Milvus Integration](https://python.langchain.com/docs/integrations/vectorstores/milvus/)).
- 🔗 **Integrated Communication:** All RAG logic is contained within the A2A server, including scraping, chunking, embedding, and retrieval.

---

## Getting Started

### 1️⃣ Configure Environment

Set up your `.env` file with your LLM and Milvus configuration.

### 2️⃣ Start the Agent (A2A Mode)

```bash
docker pull <your-agent-rag-image>
docker run --rm -p 0.0.0.0:8000:8000 -it \
  -v $(pwd)/.env:/app/.env \
  <your-agent-rag-image>
```

### 3️⃣ Run the Client

Use an A2A-compatible client to interact with the agent.

---

## Architecture

- **A2A Protocol** for agent-to-agent or client-to-agent communication
- **RAG Pipeline:**
  - Web scraping
  - Text chunking
  - Embedding (OpenAI or other)
  - Storage in Milvus
  - Retrieval and LLM answering

---

## Features

- Ingest documentation from any URL
- Web scrape and chunk all content
- Store and retrieve embeddings in Milvus
- Answer questions using RAG and LLM
- Expose all functionality via the A2A protocol

---

## Local Development

Clone the repo and run locally:

```bash
git clone <your-agent-rag-repo>.git
cd agent-rag
make run-a2a
```

---

## License

Apache 2.0 