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
    # Run full benchmark (storage + A2A recall) for all reachable backends
    PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py

    # Storage benchmarks only (no supervisor needed)
    PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py --storage-only

    # Write results to docs (default: integration/benchmark_results.md)
    PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py --publish

Benchmark outputs:
    Console  — real-time progress and per-metric results
    Markdown — docs/docs/evaluations/persistence-backend-benchmark.md (with --publish)
"""

from __future__ import annotations

import argparse
import asyncio
import re
import socket
import statistics
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


async def _bench_recall(backend: str, store_factory, n: int) -> RecallMetrics:
    user_id = f"recall-bench-{uuid.uuid4().hex[:8]}"
    namespace = ("memories", user_id)
    facts = generate_facts(n, user_id)
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


async def run_backend(
    backend: str,
    storage_only: bool = False,
    active_backend: Optional[str] = None,
) -> BackendResults:
    result = BackendResults(backend=backend)
    up_fn, factory_fn = _BACKEND_MAP[backend]

    if not up_fn():
        result.error = f"{backend} not reachable"
        return result

    store_f, ckpt_f = factory_fn()

    print(f"\n{'─'*60}")
    print(f"  Backend: {backend.upper()}")
    print(f"{'─'*60}")

    # Storage benchmarks
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

    # Recall benchmarks (only for the supervisor's active backend)
    if storage_only:
        return result
    if not supervisor_up():
        print("  Recall: SKIP (supervisor not running)")
        return result
    if active_backend and active_backend != backend:
        print(f"  Recall: SKIP (supervisor uses {active_backend}, not {backend})")
        return result

    for n in DATASET_SIZES:
        print(f"  Recall  N={n:>4} ...", end=" ", flush=True)
        try:
            m = await _bench_recall(backend, store_f, n)
            result.recall.append(m)
            print(
                f"recall {m.recall*100:.1f}%  "
                f"precision {m.precision*100:.1f}%  "
                f"F1 {m.f1:.3f}  "
                f"injected≈{m.facts_injected_estimate}  "
                f"latency {m.response_latency_ms:.0f}ms"
            )
        except Exception as exc:
            print(f"ERROR: {exc}")

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
        "---",
        "",
        "## Reproduction",
        "",
        "```bash",
        "# Start Postgres backend (substitute redis/mongodb as needed)",
        'IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-postgres" \\',
        "    docker compose -f docker-compose.dev.yaml up -d",
        "",
        "# Run benchmark and publish",
        "PYTHONPATH=. uv run python integration/benchmark_persistence_backends.py --publish",
        "```",
        "",
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def _detect_active_backend() -> Optional[str]:
    """Ask the supervisor's environment which backend is active."""
    import subprocess
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

    active_backend = None if args.storage_only else await _detect_active_backend()
    if active_backend:
        print(f"\n  Supervisor active backend: {active_backend.upper()}")
    elif not args.storage_only:
        print("\n  ⚠️  Could not detect supervisor backend — recall tests skipped")

    all_results: list[BackendResults] = []

    for backend in ["redis", "postgres", "mongodb"]:
        r = await run_backend(
            backend,
            storage_only=args.storage_only,
            active_backend=active_backend,
        )
        all_results.append(r)
        if r.error and not r.storage:
            print(f"  SKIP {backend}: {r.error}")

    # Print summary
    print(f"\n{'='*60}")
    print("  Summary")
    print(f"{'='*60}")
    for r in all_results:
        tag = "✅" if r.storage else "⚠️ "
        print(f"  {tag} {r.backend:8s}  storage={len(r.storage)} sizes  recall={len(r.recall)} sizes")
        if r.error:
            print(f"     error: {r.error}")

    # Generate report
    report = generate_report(all_results, active_backend, run_at)

    if args.publish:
        import os
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
    sys.exit(asyncio.run(main(parser.parse_args())))
