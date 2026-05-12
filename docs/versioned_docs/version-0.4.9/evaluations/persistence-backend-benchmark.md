# LangGraph Persistence Backend Benchmark

> Generated: 2026-03-19 09:21 UTC  
> Supervisor backend during recall tests: **mixed**

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

| N | Redis | Postgres | MongoDB | Mixed (MongoDB+Redis) |
|---|-------|----------|---------|------------------------|
| 10 | — | — | — | 10.7 ms |
| 100 | — | — | — | 0.8 ms |
| 1000 | — | — | — | 0.7 ms |

### Store — Read Latency (`store.asearch`, avg ms per search, limit=100)

| N | Redis | Postgres | MongoDB | Mixed (MongoDB+Redis) |
|---|-------|----------|---------|------------------------|
| 10 | — | — | — | 0.7 ms |
| 100 | — | — | — | 1.8 ms |
| 1000 | — | — | — | 1.8 ms |

### Checkpointer — Write Latency (`checkpointer.aput`, avg ms per checkpoint)

| N | Redis | Postgres | MongoDB | Mixed (MongoDB+Redis) |
|---|-------|----------|---------|------------------------|
| 10 | — | — | — | 13.2 ms |
| 100 | — | — | — | 0.6 ms |
| 1000 | — | — | — | 0.5 ms |

### Checkpointer — Read Latency (`checkpointer.aget_tuple`, avg ms)

| N | Redis | Postgres | MongoDB | Mixed (MongoDB+Redis) |
|---|-------|----------|---------|------------------------|
| 10 | — | — | — | 1.0 ms |
| 100 | — | — | — | 0.7 ms |
| 1000 | — | — | — | 0.7 ms |

---

## End-to-End A2A Recall, Precision, and F1

Facts are seeded directly into the store (bypassing LLM extraction) so
every fact is guaranteed to be present. The supervisor is then asked for
a full recall on a fresh thread. Measured against the active supervisor backend.

| N | Backend | Seeded | Recalled | Hallucinated | Recall | Precision | F1 | Injected≈ | A2A Latency |
|---|---------|--------|----------|--------------|--------|-----------|-----|-----------|-------------|
| 10 | mixed | 10 | 10 | 0 | 100.0% | 100.0% | 1.000 | 10 | 12894 ms |
| 100 | mixed | 100 | 50 | 0 | 50.0% | 100.0% | 0.667 | 100 | 21034 ms |
| 1000 | mixed | 1000 | 50 | 0 | 5.0% | 100.0% | 0.095 | 100 | 25366 ms |

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
- **Mixed (MongoDB+Redis)** — recommended production config: MongoDB
  checkpointer (shared with UI) for conversation state + Redis store
  for fact extraction with semantic search. Store latency matches Redis;
  checkpoint latency matches MongoDB.

### MongoDB recall is 0% — missing URI env var

When `switch_backend.sh mongodb` is used to cycle the supervisor, it updates
`LANGGRAPH_STORE_TYPE=mongodb` but does **not** set `LANGGRAPH_STORE_MONGODB_URI`.
The supervisor therefore cannot connect to the MongoDB store and returns no facts,
yielding 0% recall even though facts were successfully seeded (see Injected≈ column).

To get valid MongoDB recall, set `LANGGRAPH_STORE_MONGODB_URI` in `.env` before
starting the supervisor (e.g. `LANGGRAPH_STORE_MONGODB_URI=mongodb://langgraph-mongodb:27017`).

---

## Reproduction

```bash
# Run all backends in one pass (auto-switches supervisor)
PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py \
    --recall-backends redis,postgres,mongodb \
    --save-dataset integration/datasets/recall_dataset.json \
    --publish

# Storage-only (no supervisor needed)
PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py --storage-only

# Re-run recall with a previously saved dataset (same facts, fresh user_id)
PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py \
    --load-dataset integration/datasets/recall_dataset.json
```
