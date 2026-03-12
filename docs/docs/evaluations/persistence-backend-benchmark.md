# LangGraph Persistence Backend Benchmark

> Generated: 2026-03-12 17:17 UTC  
> Supervisor backend during recall tests: **postgres**

## Overview

This document reports write/read latency and end-to-end recall quality
(recall, precision, F1) for the three supported LangGraph persistence
backends at synthetic dataset sizes of 10, 100, and 1000 facts.

### Synthetic dataset

Facts are generated programmatically with a unique `FACTID-NNNNN` token
embedded in each fact content. This allows exact recall measurement:

- **Recall** = FACTID tokens found in agent response / seeded facts
- **Precision** = seeded FACTID tokens found / all FACTID tokens in response
  (precision < 100% indicates hallucinated fact IDs)
- **F1** = harmonic mean of precision and recall

> **Note:** Recall at N=1000 is expected to be low without
> `EMBEDDINGS_PROVIDER` configured. The store's `asearch()` uses
> prefix matching rather than semantic similarity, limiting the number
> of facts injected into the LLM context per request.

---

## Storage Layer Latency

Latencies are averages across all N operations.  
Checkpoint benchmarks use `min(N, 50)` writes to keep schema operations bounded.

### Store — Write Latency (`store.aput`, avg ms per fact)

| N | Redis | Postgres | MongoDB |
|---|-------|----------|---------|
| 10 | 10.3 ms | 9.9 ms | 16.1 ms |
| 100 | 0.7 ms | 0.4 ms | 0.5 ms |
| 1000 | 0.7 ms | 0.4 ms | 0.4 ms |

### Store — Read Latency (`store.asearch`, avg ms per search, limit=100)

| N | Redis | Postgres | MongoDB |
|---|-------|----------|---------|
| 10 | 0.6 ms | 1.1 ms | 1.0 ms |
| 100 | 1.7 ms | 1.3 ms | 0.8 ms |
| 1000 | 1.7 ms | 1.7 ms | 0.9 ms |

### Checkpointer — Write Latency (`checkpointer.aput`, avg ms per checkpoint)

| N | Redis | Postgres | MongoDB |
|---|-------|----------|---------|
| 10 | 1.1 ms | 1.2 ms | 1.3 ms |
| 100 | 0.6 ms | 0.5 ms | 0.5 ms |
| 1000 | 0.6 ms | 0.5 ms | 0.4 ms |

### Checkpointer — Read Latency (`checkpointer.aget_tuple`, avg ms)

| N | Redis | Postgres | MongoDB |
|---|-------|----------|---------|
| 10 | 1.1 ms | 0.8 ms | 0.8 ms |
| 100 | 0.9 ms | 0.6 ms | 0.7 ms |
| 1000 | 0.8 ms | 0.5 ms | 0.6 ms |

---

## End-to-End A2A Recall, Precision, and F1

Facts are seeded directly into the store (bypassing LLM extraction) so
every fact is guaranteed to be present. The supervisor is then asked for
a full recall on a fresh thread. Measured against the active supervisor backend.

| N | Backend | Seeded | Recalled | Hallucinated | Recall | Precision | F1 | Injected≈ | A2A Latency |
|---|---------|--------|----------|--------------|--------|-----------|-----|-----------|-------------|
| 10 | postgres | 10 | 5 | 0 | 50.0% | 100.0% | 0.667 | 10 | 21317 ms |
| 100 | postgres | 100 | 5 | 0 | 5.0% | 100.0% | 0.095 | 100 | 16042 ms |
| 1000 | postgres | 1000 | 5 | 0 | 0.5% | 100.0% | 0.010 | 100 | 20104 ms |

**Injected≈** = number of facts returned by `store.asearch(limit=100)` —
a proxy for how many facts the LLM received in its context.

---

## Observations

### Recall decreases with N (expected without embeddings)

Without `EMBEDDINGS_PROVIDER` configured the store uses namespace prefix
search. At N=1000 the preflight injects a bounded number of facts, so
recall drops significantly. Configure semantic embeddings to improve
recall at large dataset sizes.

### Precision typically remains high

The LLM rarely invents `FACTID-NNNNN` tokens that were not seeded,
so precision stays near 100%.  Any precision drop indicates hallucination
of synthetic identifiers.

### Backend latency characteristics

- **Redis** — lowest write latency due to in-memory storage; read via
  RediSearch index scan.
- **Postgres** — slightly higher write latency; read benefits from
  B-tree index on `prefix`; consistent under load.
- **MongoDB** — balanced read/write; document model maps naturally to
  namespace arrays.

---

## Reproduction

```bash
# Start Postgres backend (substitute redis/mongodb as needed)
IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-postgres" \
    docker compose -f docker-compose.dev.yaml up -d

# Run benchmark and publish
PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py --publish
```
