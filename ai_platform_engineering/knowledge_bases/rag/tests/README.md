# End-to-End Tests for RAG System

This directory contains end-to-end tests for the Retrieval-Augmented Generation (RAG) system. These tests validate that all components work together correctly in both Graph RAG enabled and disabled modes.

## Test Structure

```
tests/
├── run_tests_e2e.sh            # Main test runner for all components
├── README.md                   # This file

server/
└── tests/
    ├── test_rag_e2e.py        # RAG Server E2E tests
    ├── run_e2e_tests.sh       # Server-specific test runner
    ├── pytest.ini             # Pytest configuration
    └── README.md              # Server test documentation

# Future components will follow the same pattern:
# agent_rag/tests/
# agent_ontology/tests/
# webui/tests/
```

## Running Tests

```bash
# RAG Server only
cd server/tests
chmod +x run_e2e_tests.sh
./run_e2e_tests.sh
```

## Test Modes

All tests run in both operational modes:
1. **Graph RAG Enabled** - Full functionality with Neo4j graphs
2. **Graph RAG Disabled** - Vector-only mode without graph features

## Prerequisites

- `uv` package manager
- Docker and docker-compose
- Environment variables in `../.env`

