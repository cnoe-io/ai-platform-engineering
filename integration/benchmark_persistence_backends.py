#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
LangGraph Persistence Backend Benchmark

Measures write/read latency and recall/precision/F1 for Redis, Postgres, and
MongoDB at synthetic dataset sizes of 10, 100, and 1000 facts.

Storage benchmarks (write/read latency) run against all reachable backends
independently of the supervisor.  The A2A recall benchmark runs against
whichever backend the supervisor at localhost:8000 is currently configured for.

Unique synthetic identifiers embedded in every fact content allow precise
recall and precision calculation without needing semantic similarity.

Usage:
    # Storage benchmarks only (no supervisor needed)
    PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py --storage-only

    # Full benchmark: auto-detect active supervisor backend and run recall for it
    PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py

    # Full benchmark across ALL backends — cycles supervisor through redis/postgres/mongodb
    PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py \
        --recall-backends redis,postgres,mongodb \
        --save-dataset integration/datasets/recall_dataset.json \
        --publish

    # Re-run recall with the same fact set from a previous run
    PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py \
        --load-dataset integration/datasets/recall_dataset.json

Dataset flags:
    --save-dataset PATH   Persist generated facts to JSON (reproducible re-runs)
    --load-dataset PATH   Load facts from a saved JSON file (fresh user_id per run)

Multi-backend recall flags:
    --recall-backends     Comma-separated list (e.g. redis,postgres,mongodb);
                          switches the supervisor between backends automatically
    --switch-script PATH  Path to backend switcher (default: skills/persistence/switch_backend.sh)
    --supervisor-wait N   Seconds to wait for supervisor after switch (default: 90)

Benchmark outputs:
    Console  — real-time progress and per-metric results
    Markdown — docs/docs/evaluations/persistence-backend-benchmark.md (with --publish)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import socket
import statistics
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import httpx

# ---------------------------------------------------------------------------
# Connection constants
# ---------------------------------------------------------------------------

SUPERVISOR_URL = "http://localhost:8000"
REDIS_URL = "redis://localhost:6380"
POSTGRES_DSN = "postgresql://langgraph:langgraph@localhost:5433/langgraph"
MONGODB_URI = "mongodb://localhost:27018"

DATASET_SIZES = [10, 100, 1000]
STORAGE_READ_TRIALS = 5   # repeated asearch() calls to average read latency
A2A_TIMEOUT = 180.0       # seconds per A2A message/send call

DOCS_OUTPUT = "docs/docs/evaluations/persistence-backend-benchmark.md"
DATASETS_DIR = "integration/datasets"
SWITCH_SCRIPT_DEFAULT = "skills/persistence/switch_backend.sh"
SUPERVISOR_WAIT_DEFAULT = 90  # seconds to poll for supervisor after a backend switch


# ---------------------------------------------------------------------------
# Reachability
# ---------------------------------------------------------------------------

def _tcp_ok(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


def supervisor_up() -> bool:
    return _tcp_ok("localhost", 8000)


def redis_up() -> bool:
    return _tcp_ok("localhost", 6380)


def postgres_up() -> bool:
    return _tcp_ok("localhost", 5433)


def mongodb_up() -> bool:
    return _tcp_ok("localhost", 27018)


# ---------------------------------------------------------------------------
# Synthetic fact generator
# ---------------------------------------------------------------------------

_TOOL_NAMES = ["ArgoCD", "Helm", "Prometheus", "Grafana", "GitHub-Actions",
               "Terraform", "Vault", "Istio", "Fluentd", "OPA"]
_ENV_NAMES = ["prod", "staging", "dev", "canary", "dr"]
_REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"]


def generate_facts(n: int, user_id: str) -> list[dict]:
    """
    Generate n unique synthetic facts for user_id.

    Every fact embeds a unique token ``FACTID-{i:05d}`` so we can
    precisely measure recall by scanning the agent's response for these tokens.
    """
    facts = []
    for i in range(n):
        cat = i % 5
        idx = f"{i:05d}"
        if cat == 0:
            content = (
                f"FACTID-{idx}: production cluster k8s-prod-{idx} "
                f"runs in region {_REGIONS[i % 4]} "
                f"with namespace platform-ns-{idx}"
            )
        elif cat == 1:
            content = (
                f"FACTID-{idx}: team uses {_TOOL_NAMES[i % 10]} "
                f"for {_ENV_NAMES[i % 5]} environment deployments (node-{idx})"
            )
        elif cat == 2:
            content = (
                f"FACTID-{idx}: on-call rotation slot-{idx} covers "
                f"service svc-{idx} with PagerDuty escalation level {(i % 3) + 1}"
            )
        elif cat == 3:
            content = (
                f"FACTID-{idx}: cost centre cc-{idx} allocated "
                f"{(i % 9 + 1) * 100}$ monthly for compute in {_REGIONS[i % 4]}"
            )
        else:
            content = (
                f"FACTID-{idx}: repository repo-{idx} deploys via "
                f"CI pipeline pipe-{idx} triggered on push to main branch"
            )
        facts.append({"content": content, "fact_id": f"FACTID-{idx}"})
    return facts


def fact_ids(facts: list[dict]) -> set[str]:
    return {f["fact_id"] for f in facts}


# ---------------------------------------------------------------------------
# Dataset persistence helpers
# ---------------------------------------------------------------------------

def _save_dataset(path: str, n: int, facts: list[dict]) -> None:
    """Upsert facts for size n into a JSON dataset file."""
    os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
    data: dict = {}
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
    data.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
    data.setdefault("sizes", {})[str(n)] = facts
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _load_dataset(path: str) -> dict[int, list[dict]]:
    """Load a dataset file and return {n: facts_list}.  Returns {} if file missing."""
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        data = json.load(f)
    return {int(k): v for k, v in data.get("sizes", {}).items()}


def _load_or_generate_facts(n: int, user_id: str, dataset: dict[int, list[dict]]) -> list[dict]:
    """Return dataset facts for size n (if available) or generate fresh ones."""
    if n in dataset:
        return list(dataset[n])   # copy — caller may mutate
    return generate_facts(n, user_id)


# ---------------------------------------------------------------------------
# Supervisor backend switcher
# ---------------------------------------------------------------------------

async def _supervisor_http_ready() -> bool:
    """
    Return True if the supervisor is responding to HTTP requests.

    TCP open is not enough — the supervisor may accept connections while
    the application is still initializing.  We send a lightweight POST
    and consider the supervisor ready if we receive any HTTP response
    (including error status codes).
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            payload = {
                "jsonrpc": "2.0", "method": "message/send", "id": "healthcheck",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"kind": "text", "text": "ping"}],
                        "messageId": "healthcheck",
                        "contextId": "healthcheck",
                        "metadata": {"user_id": "healthcheck"},
                    },
                    "configuration": {"acceptedOutputModes": ["text"], "blocking": True},
                },
            }
            await client.post(SUPERVISOR_URL, json=payload)
            return True
    except Exception:
        return False


async def _switch_supervisor_backend(
    backend: str,
    switch_script: str,
    wait_secs: int,
) -> None:
    """
    Call switch_backend.sh <backend> then poll until the supervisor is up again.

    Raises RuntimeError if the supervisor does not respond within wait_secs.
    """
    print(f"\n  ⏳ Switching supervisor to {backend.upper()} (this restarts docker compose)...")
    result = subprocess.run(
        [switch_script, backend],
        capture_output=False,   # let output flow through to terminal
    )
    if result.returncode != 0:
        raise RuntimeError(f"switch_backend.sh {backend} exited {result.returncode}")

    print(f"  ⏳ Waiting up to {wait_secs}s for supervisor HTTP readiness on :8000 ...")
    deadline = time.monotonic() + wait_secs
    while time.monotonic() < deadline:
        if await _supervisor_http_ready():
            print("  ✅ Supervisor HTTP-ready on :8000")
            return
        await asyncio.sleep(5)
    raise RuntimeError(
        f"Supervisor did not become HTTP-ready within {wait_secs}s after switching to {backend}"
    )


# ---------------------------------------------------------------------------
# Benchmark result types
# ---------------------------------------------------------------------------

@dataclass
class StorageMetrics:
    backend: str
    n: int
    write_latency_ms: float          # avg ms per aput()
    write_total_ms: float            # total ms for N writes
    read_latency_ms: float           # avg ms per asearch() over STORAGE_READ_TRIALS
    ckpt_write_latency_ms: float     # avg ms per checkpoint aput()
    ckpt_read_latency_ms: float      # avg ms per checkpoint aget_tuple()


@dataclass
class RecallMetrics:
    backend: str
    n: int
    seeded: int
    recalled: int           # seeded fact IDs found in response
    hallucinated: int       # fact-ID-like tokens in response NOT in seeded set
    recall: float           # recalled / seeded
    precision: float        # recalled / (recalled + hallucinated)  [1.0 if 0 hallucinations]
    f1: float
    response_latency_ms: float
    facts_injected_estimate: int   # facts returned by asearch (proxy for what LLM received)


@dataclass
class BackendResults:
    backend: str
    storage: list[StorageMetrics] = field(default_factory=list)
    recall: list[RecallMetrics] = field(default_factory=list)
    error: str = ""


# ---------------------------------------------------------------------------
# Storage benchmark
# ---------------------------------------------------------------------------

async def _bench_storage(backend: str, store_factory, ckpt_factory, n: int) -> StorageMetrics:
    user_id = f"bench-{uuid.uuid4().hex[:8]}"
    namespace = ("bench_facts", user_id)
    facts = generate_facts(n, user_id)

    # ---- store write latency ------------------------------------------------
    store = store_factory()
    t0 = time.perf_counter()
    for f in facts:
        key = str(uuid.uuid4())
        await store.aput(namespace, key, f)
    write_total_ms = (time.perf_counter() - t0) * 1000
    write_avg_ms = write_total_ms / n

    # ---- store read latency (repeated asearch) --------------------------------
    read_times = []
    for _ in range(STORAGE_READ_TRIALS):
        t0 = time.perf_counter()
        await store.asearch(namespace, limit=min(n, 100))
        read_times.append((time.perf_counter() - t0) * 1000)
    read_avg_ms = statistics.mean(read_times)

    # ---- checkpoint write/read latency ---------------------------------------
    saver = ckpt_factory()
    thread_ids = []
    ckpt_write_times = []
    for i in range(min(n, 50)):          # cap at 50 checkpoints (schema-heavy)
        tid = f"bench-ckpt-{uuid.uuid4().hex[:8]}"
        thread_ids.append(tid)
        ckpt = {
            "v": 1, "id": str(uuid.uuid4()), "ts": "2026-01-01T00:00:00+00:00",
            "channel_values": {"messages": [{"type": "human", "content": f"msg {i}"}]},
            "channel_versions": {"messages": 1}, "versions_seen": {}, "pending_sends": [],
        }
        cfg = {"configurable": {"thread_id": tid, "checkpoint_ns": "", "checkpoint_id": ckpt["id"]}}
        meta = {"source": "input", "step": i, "writes": {}, "parents": {}}
        t0 = time.perf_counter()
        await saver.aput(cfg, ckpt, meta, {})
        ckpt_write_times.append((time.perf_counter() - t0) * 1000)

    ckpt_read_times = []
    for tid in thread_ids:
        cfg = {"configurable": {"thread_id": tid, "checkpoint_ns": ""}}
        t0 = time.perf_counter()
        await saver.aget_tuple(cfg)
        ckpt_read_times.append((time.perf_counter() - t0) * 1000)

    return StorageMetrics(
        backend=backend,
        n=n,
        write_latency_ms=round(write_avg_ms, 2),
        write_total_ms=round(write_total_ms, 2),
        read_latency_ms=round(read_avg_ms, 2),
        ckpt_write_latency_ms=round(statistics.mean(ckpt_write_times), 2),
        ckpt_read_latency_ms=round(statistics.mean(ckpt_read_times), 2),
    )


# ---------------------------------------------------------------------------
# A2A recall benchmark
# ---------------------------------------------------------------------------

_FACTID_RE = re.compile(r"FACTID-\d{5}")


async def _send_a2a(text: str, context_id: str, user_id: str) -> tuple[str, float]:
    """POST message/send, return (response_text, latency_ms)."""
    payload = {
        "jsonrpc": "2.0", "method": "message/send", "id": str(uuid.uuid4()),
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": text}],
                "messageId": str(uuid.uuid4()),
                "contextId": context_id,
                "metadata": {"user_id": user_id},
            },
            "configuration": {"acceptedOutputModes": ["text"], "blocking": True},
        },
    }
    async with httpx.AsyncClient(timeout=A2A_TIMEOUT) as client:
        t0 = time.perf_counter()
        resp = await client.post(SUPERVISOR_URL, json=payload)
        latency_ms = (time.perf_counter() - t0) * 1000

    data = resp.json()
    if "error" in data:
        return f"[ERROR] {data['error']}", latency_ms

    result = data.get("result", {})
    parts = []
    for artifact in result.get("artifacts", []):
        if artifact.get("name") in ("final_result", "streaming_result", "partial_result"):
            for p in artifact.get("parts", []):
                if p.get("kind") == "text":
                    parts.append(p["text"])
    return " ".join(parts) if parts else "", latency_ms


async def _bench_recall(
    backend: str,
    store_factory,
    n: int,
    *,
    preloaded_facts: Optional[list[dict]] = None,
    save_dataset_path: Optional[str] = None,
) -> RecallMetrics:
    user_id = f"recall-bench-{uuid.uuid4().hex[:8]}"
    namespace = ("memories", user_id)
    facts = preloaded_facts if preloaded_facts is not None else generate_facts(n, user_id)
    if save_dataset_path:
        _save_dataset(save_dataset_path, n, facts)
    seeded_ids = fact_ids(facts)

    # Seed directly into store (no LLM extraction — full control over content)
    store = store_factory()
    for f in facts:
        await store.aput(namespace, str(uuid.uuid4()), f)

    # Estimate how many facts the preflight will inject (asearch limit ~10)
    search_results = await store.asearch(namespace, limit=100)
    facts_injected_estimate = len(search_results)

    # Ask the agent to recall everything about this user on a fresh thread
    context_id = str(uuid.uuid4())
    recall_prompt = (
        "I need a complete inventory of everything you know about me. "
        "Please list every fact, detail, cluster name, tool, service, "
        "cost centre, on-call slot, and repository you have stored. "
        "Be exhaustive — include every FACTID identifier you have."
    )
    response_text, latency_ms = await _send_a2a(recall_prompt, context_id, user_id)

    # Recall: seeded IDs found in response
    found_ids = set(_FACTID_RE.findall(response_text))
    recalled = len(found_ids & seeded_ids)
    hallucinated = len(found_ids - seeded_ids)

    recall_val = recalled / n if n > 0 else 0.0
    precision_val = (recalled / (recalled + hallucinated)) if (recalled + hallucinated) > 0 else 1.0
    f1_val = (
        2 * precision_val * recall_val / (precision_val + recall_val)
        if (precision_val + recall_val) > 0 else 0.0
    )

    return RecallMetrics(
        backend=backend,
        n=n,
        seeded=n,
        recalled=recalled,
        hallucinated=hallucinated,
        recall=round(recall_val, 4),
        precision=round(precision_val, 4),
        f1=round(f1_val, 4),
        response_latency_ms=round(latency_ms, 0),
        facts_injected_estimate=facts_injected_estimate,
    )


# ---------------------------------------------------------------------------
# Per-backend runners
# ---------------------------------------------------------------------------

def _make_redis_factories():
    from ai_platform_engineering.utils.store import _LazyAsyncRedisStore
    from ai_platform_engineering.utils.checkpointer import _LazyAsyncRedisSaver
    return (
        lambda: _LazyAsyncRedisStore(REDIS_URL),
        lambda: _LazyAsyncRedisSaver(REDIS_URL),
    )


def _make_postgres_factories():
    from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore
    from ai_platform_engineering.utils.checkpointer import _LazyAsyncPostgresSaver
    return (
        lambda: _LazyAsyncPostgresStore(POSTGRES_DSN),
        lambda: _LazyAsyncPostgresSaver(POSTGRES_DSN),
    )


def _make_mongodb_factories():
    from ai_platform_engineering.utils.store import _LazyAsyncMongoDBStore
    from ai_platform_engineering.utils.checkpointer import _LazyAsyncMongoDBSaver
    return (
        lambda: _LazyAsyncMongoDBStore(MONGODB_URI),
        lambda: _LazyAsyncMongoDBSaver(MONGODB_URI),
    )


_BACKEND_MAP = {
    "redis":    (redis_up,    _make_redis_factories),
    "postgres": (postgres_up, _make_postgres_factories),
    "mongodb":  (mongodb_up,  _make_mongodb_factories),
}


async def run_backend(backend: str) -> BackendResults:
    """Run storage-only benchmarks for one backend."""
    result = BackendResults(backend=backend)
    up_fn, factory_fn = _BACKEND_MAP[backend]

    if not up_fn():
        result.error = f"{backend} not reachable"
        return result

    store_f, ckpt_f = factory_fn()

    print(f"\n{'─'*60}")
    print(f"  Backend: {backend.upper()}")
    print(f"{'─'*60}")

    for n in DATASET_SIZES:
        print(f"  Storage N={n:>4} ...", end=" ", flush=True)
        try:
            m = await _bench_storage(backend, store_f, ckpt_f, n)
            result.storage.append(m)
            print(
                f"write {m.write_latency_ms:.1f}ms/fact  "
                f"search {m.read_latency_ms:.1f}ms  "
                f"ckpt-w {m.ckpt_write_latency_ms:.1f}ms  "
                f"ckpt-r {m.ckpt_read_latency_ms:.1f}ms"
            )
        except Exception as exc:
            print(f"ERROR: {exc}")
            result.error = str(exc)

    return result


# ---------------------------------------------------------------------------
# Markdown report generator
# ---------------------------------------------------------------------------

def _pct(v: float) -> str:
    return f"{v*100:.1f}%"


def _ms(v: float) -> str:
    return f"{v:.1f} ms"


def generate_report(
    all_results: list[BackendResults],
    active_backend: Optional[str],
    run_at: str,
) -> str:
    lines: list[str] = []

    lines += [
        "# LangGraph Persistence Backend Benchmark",
        "",
        f"> Generated: {run_at}  ",
        f"> Supervisor backend during recall tests: **{active_backend or 'none'}**",
        "",
        "## Overview",
        "",
        "This document reports write/read latency and end-to-end recall quality",
        "(recall, precision, F1) for the three supported LangGraph persistence",
        "backends at synthetic dataset sizes of 10, 100, and 1000 facts.",
        "",
        "### Synthetic dataset",
        "",
        "Facts are generated programmatically with a unique `FACTID-NNNNN` token",
        "embedded in each fact content. This allows exact recall measurement:",
        "",
        "- **Recall** = FACTID tokens found in agent response / seeded facts",
        "- **Precision** = seeded FACTID tokens found / all FACTID tokens in response",
        "  (precision < 100% indicates hallucinated fact IDs)",
        "- **F1** = harmonic mean of precision and recall",
        "",
        "> **Note:** Recall at N=1000 is expected to be low without",
        "> `EMBEDDINGS_PROVIDER` configured. The store's `asearch()` uses",
        "> prefix matching rather than semantic similarity, limiting the number",
        "> of facts injected into the LLM context per request.",
        "",
        "---",
        "",
        "## Storage Layer Latency",
        "",
        "Latencies are averages across all N operations.  ",
        "Checkpoint benchmarks use `min(N, 50)` writes to keep schema operations bounded.",
        "",
    ]

    # --- Store write latency table ---
    lines += [
        "### Store — Write Latency (`store.aput`, avg ms per fact)",
        "",
        "| N | Redis | Postgres | MongoDB |",
        "|---|-------|----------|---------|",
    ]
    redis_s = {m.n: m for r in all_results if r.backend == "redis" for m in r.storage}
    pg_s    = {m.n: m for r in all_results if r.backend == "postgres" for m in r.storage}
    mg_s    = {m.n: m for r in all_results if r.backend == "mongodb" for m in r.storage}
    for n in DATASET_SIZES:
        r_v = _ms(redis_s[n].write_latency_ms) if n in redis_s else "—"
        p_v = _ms(pg_s[n].write_latency_ms) if n in pg_s else "—"
        m_v = _ms(mg_s[n].write_latency_ms) if n in mg_s else "—"
        lines.append(f"| {n} | {r_v} | {p_v} | {m_v} |")

    lines += [
        "",
        "### Store — Read Latency (`store.asearch`, avg ms per search, limit=100)",
        "",
        "| N | Redis | Postgres | MongoDB |",
        "|---|-------|----------|---------|",
    ]
    for n in DATASET_SIZES:
        r_v = _ms(redis_s[n].read_latency_ms) if n in redis_s else "—"
        p_v = _ms(pg_s[n].read_latency_ms) if n in pg_s else "—"
        m_v = _ms(mg_s[n].read_latency_ms) if n in mg_s else "—"
        lines.append(f"| {n} | {r_v} | {p_v} | {m_v} |")

    lines += [
        "",
        "### Checkpointer — Write Latency (`checkpointer.aput`, avg ms per checkpoint)",
        "",
        "| N | Redis | Postgres | MongoDB |",
        "|---|-------|----------|---------|",
    ]
    for n in DATASET_SIZES:
        r_v = _ms(redis_s[n].ckpt_write_latency_ms) if n in redis_s else "—"
        p_v = _ms(pg_s[n].ckpt_write_latency_ms) if n in pg_s else "—"
        m_v = _ms(mg_s[n].ckpt_write_latency_ms) if n in mg_s else "—"
        lines.append(f"| {n} | {r_v} | {p_v} | {m_v} |")

    lines += [
        "",
        "### Checkpointer — Read Latency (`checkpointer.aget_tuple`, avg ms)",
        "",
        "| N | Redis | Postgres | MongoDB |",
        "|---|-------|----------|---------|",
    ]
    for n in DATASET_SIZES:
        r_v = _ms(redis_s[n].ckpt_read_latency_ms) if n in redis_s else "—"
        p_v = _ms(pg_s[n].ckpt_read_latency_ms) if n in pg_s else "—"
        m_v = _ms(mg_s[n].ckpt_read_latency_ms) if n in mg_s else "—"
        lines.append(f"| {n} | {r_v} | {p_v} | {m_v} |")

    # --- Recall / Precision / F1 ---
    lines += [
        "",
        "---",
        "",
        "## End-to-End A2A Recall, Precision, and F1",
        "",
        "Facts are seeded directly into the store (bypassing LLM extraction) so",
        "every fact is guaranteed to be present. The supervisor is then asked for",
        "a full recall on a fresh thread. Measured against the active supervisor backend.",
        "",
        "| N | Backend | Seeded | Recalled | Hallucinated | Recall | Precision | F1 | Injected≈ | A2A Latency |",
        "|---|---------|--------|----------|--------------|--------|-----------|-----|-----------|-------------|",
    ]
    for r in all_results:
        for m in r.recall:
            lines.append(
                f"| {m.n} | {m.backend} "
                f"| {m.seeded} | {m.recalled} | {m.hallucinated} "
                f"| {_pct(m.recall)} | {_pct(m.precision)} | {m.f1:.3f} "
                f"| {m.facts_injected_estimate} | {m.response_latency_ms:.0f} ms |"
            )

    lines += [
        "",
        "**Injected≈** = number of facts returned by `store.asearch(limit=100)` —",
        "a proxy for how many facts the LLM received in its context.",
        "",
        "---",
        "",
        "## Observations",
        "",
        "### Recall decreases with N (expected without embeddings)",
        "",
        "Without `EMBEDDINGS_PROVIDER` configured the store uses namespace prefix",
        "search. At N=1000 the preflight injects a bounded number of facts, so",
        "recall drops significantly. Configure semantic embeddings to improve",
        "recall at large dataset sizes.",
        "",
        "### Precision typically remains high",
        "",
        "The LLM rarely invents `FACTID-NNNNN` tokens that were not seeded,",
        "so precision stays near 100%.  Any precision drop indicates hallucination",
        "of synthetic identifiers.",
        "",
        "### Backend latency characteristics",
        "",
        "- **Redis** — lowest write latency due to in-memory storage; read via",
        "  RediSearch index scan.",
        "- **Postgres** — slightly higher write latency; read benefits from",
        "  B-tree index on `prefix`; consistent under load.",
        "- **MongoDB** — balanced read/write; document model maps naturally to",
        "  namespace arrays.",
        "",
        "### MongoDB recall is 0% — missing URI env var",
        "",
        "When `switch_backend.sh mongodb` is used to cycle the supervisor, it updates",
        "`LANGGRAPH_STORE_TYPE=mongodb` but does **not** set `LANGGRAPH_STORE_MONGODB_URI`.",
        "The supervisor therefore cannot connect to the MongoDB store and returns no facts,",
        "yielding 0% recall even though facts were successfully seeded (see Injected≈ column).",
        "",
        "To get valid MongoDB recall, set `LANGGRAPH_STORE_MONGODB_URI` in `.env` before",
        "starting the supervisor (e.g. `LANGGRAPH_STORE_MONGODB_URI=mongodb://langgraph-mongodb:27017`).",
        "",
        "---",
        "",
        "## Reproduction",
        "",
        "```bash",
        "# Run all backends in one pass (auto-switches supervisor)",
        "PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py \\",
        "    --recall-backends redis,postgres,mongodb \\",
        "    --save-dataset integration/datasets/recall_dataset.json \\",
        "    --publish",
        "",
        "# Storage-only (no supervisor needed)",
        "PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py --storage-only",
        "",
        "# Re-run recall with a previously saved dataset (same facts, fresh user_id)",
        "PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py \\",
        "    --load-dataset integration/datasets/recall_dataset.json",
        "```",
        "",
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def _detect_active_backend() -> Optional[str]:
    """Ask the supervisor's environment which backend is active."""
    try:
        out = subprocess.check_output(
            ["docker", "exec", "caipe-supervisor", "env"],
            text=True, stderr=subprocess.DEVNULL,
        )
        for line in out.splitlines():
            if line.startswith("LANGGRAPH_CHECKPOINT_TYPE="):
                val = line.split("=", 1)[1].strip().lower()
                if val in ("redis", "postgres", "mongodb"):
                    return val
    except Exception:
        pass
    return None


async def main(args: argparse.Namespace) -> int:
    run_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # ---- dataset loading -----------------------------------------------------
    dataset: dict[int, list[dict]] = {}
    if args.load_dataset:
        dataset = _load_dataset(args.load_dataset)
        if dataset:
            print(f"\n  📂 Loaded dataset from {args.load_dataset} "
                  f"(sizes: {sorted(dataset.keys())})")
        else:
            print(f"\n  ⚠️  --load-dataset {args.load_dataset}: file not found or empty "
                  "— generating fresh facts")

    save_path: Optional[str] = args.save_dataset or None
    if save_path:
        os.makedirs(DATASETS_DIR, exist_ok=True)
        print(f"\n  💾 Dataset will be saved to {save_path}")

    # ---- detect active backend -----------------------------------------------
    active_backend = None if args.storage_only else await _detect_active_backend()
    if active_backend:
        print(f"\n  Supervisor active backend: {active_backend.upper()}")
    elif not args.storage_only and not args.recall_backends:
        print("\n  ⚠️  Could not detect supervisor backend — recall tests skipped")

    # ---- build a BackendResults map for recall attachment --------------------
    all_results: list[BackendResults] = []
    results_by_backend: dict[str, BackendResults] = {}

    # ---- storage benchmarks (all reachable backends, no supervisor needed) --
    for backend in ["redis", "postgres", "mongodb"]:
        r = await run_backend(backend)
        all_results.append(r)
        results_by_backend[backend] = r
        if r.error and not r.storage:
            print(f"  SKIP {backend}: {r.error}")

    # ---- recall benchmarks ---------------------------------------------------
    if not args.storage_only:
        recall_backends: list[str] = []

        if args.recall_backends:
            # Explicit list — cycle through them, switching supervisor as needed
            recall_backends = [b.strip().lower() for b in args.recall_backends.split(",") if b.strip()]
        elif active_backend:
            # Original behaviour: only the currently-active backend
            recall_backends = [active_backend]

        current_active = active_backend
        for backend in recall_backends:
            up_fn, factory_fn = _BACKEND_MAP[backend]
            if not up_fn():
                print(f"\n  Recall {backend.upper()}: SKIP ({backend} not reachable)")
                continue

            if not supervisor_up():
                print(f"\n  Recall {backend.upper()}: SKIP (supervisor not running)")
                continue

            # Switch supervisor if needed
            if args.recall_backends and current_active != backend:
                try:
                    await _switch_supervisor_backend(
                        backend,
                        switch_script=args.switch_script,
                        wait_secs=args.supervisor_wait,
                    )
                    current_active = backend
                except RuntimeError as exc:
                    print(f"\n  Recall {backend.upper()}: SKIP (switch failed: {exc})")
                    continue

            store_f, _ = factory_fn()
            r = results_by_backend[backend]

            print(f"\n{'─'*60}")
            print(f"  Recall benchmarks: {backend.upper()}")
            print(f"{'─'*60}")

            for n in DATASET_SIZES:
                print(f"  Recall  N={n:>4} ...", end=" ", flush=True)
                try:
                    preloaded = dataset.get(n)
                    m = await _bench_recall(
                        backend, store_f, n,
                        preloaded_facts=preloaded,
                        save_dataset_path=save_path,
                    )
                    r.recall.append(m)
                    print(
                        f"recall {m.recall*100:.1f}%  "
                        f"precision {m.precision*100:.1f}%  "
                        f"F1 {m.f1:.3f}  "
                        f"injected≈{m.facts_injected_estimate}  "
                        f"latency {m.response_latency_ms:.0f}ms"
                    )
                except Exception as exc:
                    print(f"ERROR ({type(exc).__name__}): {exc}")

    # ---- summary -------------------------------------------------------------
    print(f"\n{'='*60}")
    print("  Summary")
    print(f"{'='*60}")
    for r in all_results:
        tag = "✅" if r.storage else "⚠️ "
        print(f"  {tag} {r.backend:8s}  storage={len(r.storage)} sizes  recall={len(r.recall)} sizes")
        if r.error:
            print(f"     error: {r.error}")

    if save_path and os.path.exists(save_path):
        print(f"\n  💾 Dataset saved to {save_path}")

    # ---- generate report -----------------------------------------------------
    # Use the active backend that ran last (or original active_backend for the header)
    report_backend = active_backend
    if args.recall_backends:
        # Show all backends that ran
        ran = [b for b in ["redis", "postgres", "mongodb"] if results_by_backend[b].recall]
        report_backend = ",".join(ran) if ran else active_backend

    report = generate_report(all_results, report_backend, run_at)

    if args.publish:
        os.makedirs(os.path.dirname(DOCS_OUTPUT), exist_ok=True)
        with open(DOCS_OUTPUT, "w") as f:
            f.write(report)
        print(f"\n  📄 Report written to {DOCS_OUTPUT}")
    else:
        out_path = "integration/benchmark_results.md"
        with open(out_path, "w") as f:
            f.write(report)
        print(f"\n  📄 Report written to {out_path}")
        print(f"     (run with --publish to write to {DOCS_OUTPUT})")

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LangGraph persistence backend benchmark")
    parser.add_argument("--storage-only", action="store_true",
                        help="Skip A2A recall benchmarks (no supervisor needed)")
    parser.add_argument("--publish", action="store_true",
                        help=f"Write report to {DOCS_OUTPUT}")
    parser.add_argument("--save-dataset", metavar="PATH",
                        help="Save generated facts to a JSON file for reproducible re-runs "
                             f"(e.g. {DATASETS_DIR}/recall_dataset.json)")
    parser.add_argument("--load-dataset", metavar="PATH",
                        help="Load facts from a previously saved JSON dataset "
                             "(fresh user_id generated each run to avoid collisions)")
    parser.add_argument("--recall-backends", metavar="BACKENDS",
                        help="Comma-separated backends to run recall for, cycling the "
                             "supervisor between each (e.g. redis,postgres,mongodb). "
                             "Requires --switch-script to be present.")
    parser.add_argument("--switch-script", metavar="PATH",
                        default=SWITCH_SCRIPT_DEFAULT,
                        help=f"Path to backend switcher script (default: {SWITCH_SCRIPT_DEFAULT})")
    parser.add_argument("--supervisor-wait", metavar="SECS", type=int,
                        default=SUPERVISOR_WAIT_DEFAULT,
                        help=f"Seconds to wait for supervisor after a backend switch "
                             f"(default: {SUPERVISOR_WAIT_DEFAULT})")
    sys.exit(asyncio.run(main(parser.parse_args())))
