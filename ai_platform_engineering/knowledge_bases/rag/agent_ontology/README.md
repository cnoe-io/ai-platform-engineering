# Agent Ontology

Automated schema discovery service that discovers and evaluates relationships between entity types in a knowledge graph using BM25 fuzzy search, deep property matching, and parallel LLM evaluation.

## Quick Start

```bash
# Install dependencies
uv sync

# Set environment variables (see Configuration)
export NEO4J_URI="bolt://localhost:7687"
export REDIS_URL="redis://localhost:6379"

# Run the service
source ./.venv/bin/activate 
LOG_LEVEL=DEBUG python src/agent_ontology/restapi.py
```

## Configuration

### Required Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URI` | - | Neo4j connection URI (bolt://host:port) |
| `NEO4J_USER` | - | Neo4j username |
| `NEO4J_PASSWORD` | - | Neo4j password |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

### Optional Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `8098` | HTTP API port |
| `SYNC_INTERVAL` | `21600` | Auto-evaluation interval (seconds, 6 hours) |
| `MIN_COUNT_FOR_EVAL` | `3` | Min matches for LLM evaluation |
| `COUNT_CHANGE_THRESHOLD_RATIO` | `0.1` | Re-eval trigger threshold (10%) |
| `MAX_CONCURRENT_EVALUATION` | `10` | Parallel agent workers |
| `AGENT_RECURSION_LIMIT` | `100` | Max LLM recursion depth |
| `MAX_LLM_TOKENS` | `100000` | Max tokens for LLM context |
| `DEBUG_AGENT` | `false` | Enable debug logging |

### LLM Configuration

Requires LLM configuration via `cnoe-agent-utils`. Set one of:
- `OPENAI_API_KEY` - For OpenAI models
- `ANTHROPIC_API_KEY` - For Anthropic Claude
- Custom LLM provider environment variables

## Connections

### Neo4j (Dual Databases)

- **Data Graph** (Label: `NxsDataEntity`): Source entity data
- **Ontology Graph** (Label: `NxsSchemaEntity`): Schema and relation evaluations

Default ports: 7687 (bolt), 7474 (http)

### Redis

- **Heuristics metrics**: Match counts, quality scores, examples
- **Ontology version**: Current version tracking

Default port: 6379

## Background Processing

The agent runs **in the background** and can be controlled via REST API:

### Automatic Mode (Timer-based)
- Runs every `SYNC_INTERVAL` seconds (default: 6 hours)
- Discovers new relationships and re-evaluates changed heuristics
- No manual intervention needed

### Manual Trigger (API-based)
```bash
# Trigger full processing + evaluation cycle
curl -X POST http://localhost:8098/v1/graph/ontology/agent/regenerate_ontology

# Check agent status
curl http://localhost:8098/v1/graph/ontology/agent/status
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design.

### Components

- **HeuristicsProcessor**: BM25 fuzzy search + Bloom filter for candidate discovery
- **RelationCandidateManager**: Manages candidates across Redis and Neo4j
- **OntologyAgent**: Orchestrates processing and evaluation
- **AgentWorker**: Isolated LLM workers for parallel evaluation

### Data Flow

```
Data Graph → Heuristics Processing → Redis (metrics) + Neo4j (structure)
           → Agent Evaluation → Neo4j (decisions) → Data Graph (relations)
```
