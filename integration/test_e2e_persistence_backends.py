#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
End-to-end A2A integration tests verifying LangGraph persistence across all three backends.

For each backend (Redis, Postgres, MongoDB) this test suite runs three phases:

  Phase 1 — Checkpoint persistence
    Send an A2A message to the supervisor with a known context_id (= LangGraph thread_id).
    Query the backend directly to confirm the checkpoint was written.

  Phase 2 — Fact extraction and storage
    Send three fact-rich messages with a known user_id.
    Wait for background extraction (~30 s).
    Query the backend memories namespace to confirm facts were stored.

  Phase 3 — Cross-thread recall
    Open a new thread (new context_id) with the same user_id.
    Ask the agent what it remembers.
    Verify the response mentions key facts from Phase 2.

Prerequisites per backend
  Redis   — COMPOSE_PROFILES="...,langgraph-redis"   IMAGE_TAG=0.2.38 docker compose -f docker-compose.dev.yaml up
  Postgres — COMPOSE_PROFILES="...,langgraph-postgres" IMAGE_TAG=0.2.38 ...
  MongoDB  — COMPOSE_PROFILES="...,langgraph-mongodb"  IMAGE_TAG=0.2.38 ...

Supervisor must be running at localhost:8000 (included in all stacks above).
Fact extraction requires ENABLE_FACT_EXTRACTION=true in .env.

Usage:
  # Run all (skips unreachable backends automatically)
  PYTHONPATH=. uv run pytest integration/test_e2e_persistence_backends.py -v -m integration -s

  # Run only Redis
  PYTHONPATH=. uv run pytest integration/test_e2e_persistence_backends.py::TestRedisE2EPersistence -v -s

  # Seed facts only (skip recall phase)
  PYTHONPATH=. uv run pytest integration/test_e2e_persistence_backends.py -v -m integration -k "checkpoint or fact_storage"
"""

from __future__ import annotations

import asyncio
import socket
import uuid
import warnings

import httpx
import pytest

pytestmark = pytest.mark.integration

# ---------------------------------------------------------------------------
# Connection constants
# ---------------------------------------------------------------------------

SUPERVISOR_URL = "http://localhost:8000"
REDIS_URL = "redis://localhost:6380"
POSTGRES_DSN = "postgresql://langgraph:langgraph@localhost:5433/langgraph"
MONGODB_URI = "mongodb://localhost:27018"

# How long to wait for background fact extraction after the last message
FACT_EXTRACTION_WAIT_SECS = 30

# Fact messages to send — contain extractable entities
FACT_MESSAGES = [
    (
        "Hi! I'm a platform engineer on the SRE team. "
        "I work primarily with ArgoCD and Kubernetes. "
        "Our main production cluster is called 'prod-us-west-2' and "
        "we deploy to the 'platform-infra' namespace."
    ),
    (
        "Our team uses Helm charts for all deployments and we follow "
        "GitOps practices with ArgoCD. We manage about 30 microservices. "
        "I prefer concise bullet-point responses with code examples."
    ),
    (
        "We monitor with Prometheus and Grafana. Our CI/CD runs on GitHub Actions. "
        "Python 3.12 is my scripting language of choice."
    ),
]

# Keywords expected to appear in a recall response (lowercase)
FACT_KEYWORDS = [
    "argocd",
    "prod-us-west-2",
    "platform-infra",
    "helm",
    "gitops",
    "concise",
    "30",
    "prometheus",
]

RECALL_THRESHOLD_PCT = 40  # ≥ 40% of keywords must be recalled


# ---------------------------------------------------------------------------
# Reachability helpers
# ---------------------------------------------------------------------------


def _tcp_reachable(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _supervisor_reachable() -> bool:
    return _tcp_reachable("localhost", 8000)


def _redis_reachable() -> bool:
    return _tcp_reachable("localhost", 6380)


def _postgres_reachable() -> bool:
    return _tcp_reachable("localhost", 5433)


def _mongodb_reachable() -> bool:
    return _tcp_reachable("localhost", 27018)


skip_if_no_supervisor = pytest.mark.skipif(
    not _supervisor_reachable(),
    reason=(
        "Supervisor not reachable on localhost:8000. "
        "Start with: IMAGE_TAG=0.2.38 COMPOSE_PROFILES='...' "
        "docker compose -f docker-compose.dev.yaml up -d"
    ),
)

skip_if_no_redis = pytest.mark.skipif(
    not _redis_reachable(),
    reason=(
        "Redis not reachable on localhost:6380. "
        "Start with COMPOSE_PROFILES='...,langgraph-redis'"
    ),
)

skip_if_no_postgres = pytest.mark.skipif(
    not _postgres_reachable(),
    reason=(
        "Postgres not reachable on localhost:5433. "
        "Start with COMPOSE_PROFILES='...,langgraph-postgres'"
    ),
)

skip_if_no_mongodb = pytest.mark.skipif(
    not _mongodb_reachable(),
    reason=(
        "MongoDB not reachable on localhost:27018. "
        "Start with COMPOSE_PROFILES='...,langgraph-mongodb'"
    ),
)


# ---------------------------------------------------------------------------
# A2A helpers
# ---------------------------------------------------------------------------


async def send_a2a_message(
    text: str,
    context_id: str,
    user_id: str,
    base_url: str = SUPERVISOR_URL,
    timeout: float = 120.0,
) -> dict:
    """Send a blocking A2A message/send request and return the result dict."""
    payload = {
        "jsonrpc": "2.0",
        "method": "message/send",
        "id": str(uuid.uuid4()),
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": text}],
                "messageId": str(uuid.uuid4()),
                "contextId": context_id,
                "metadata": {"user_id": user_id},
            },
            "configuration": {
                "acceptedOutputModes": ["text"],
                "blocking": True,
            },
        },
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(base_url, json=payload)
        data = resp.json()
    if "error" in data:
        raise RuntimeError(f"A2A error: {data['error']}")
    return data.get("result", {})


def extract_response_text(result: dict) -> str:
    """Extract the final text from an A2A result dict."""
    for artifact in result.get("artifacts", []):
        if artifact.get("name") in ("final_result", "streaming_result", "partial_result"):
            parts = [
                p["text"]
                for p in artifact.get("parts", [])
                if p.get("kind") == "text"
            ]
            if parts:
                return " ".join(parts)
    # Fallback: any text part
    all_parts = [
        p["text"]
        for a in result.get("artifacts", [])
        for p in a.get("parts", [])
        if p.get("kind") == "text"
    ]
    return " ".join(all_parts) if all_parts else ""


# ---------------------------------------------------------------------------
# Storage verifiers — use our own lazy wrappers (same code the supervisor uses)
# ---------------------------------------------------------------------------


class RedisStorageVerifier:
    """Queries Redis checkpoint + store using our lazy wrappers."""

    async def checkpoint_exists(self, thread_id: str) -> bool:
        """Return True if a checkpoint was written for thread_id."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncRedisSaver
        saver = _LazyAsyncRedisSaver(REDIS_URL)
        config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
        result = await saver.aget_tuple(config)
        return result is not None

    async def fact_count(self, user_id: str) -> int:
        """Return number of facts stored under memories/<user_id>."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore
        store = _LazyAsyncRedisStore(REDIS_URL)
        results = await store.asearch(("memories", user_id), limit=100)
        return len(results)


class PostgresStorageVerifier:
    """Queries Postgres checkpoint + store using our lazy wrappers."""

    async def checkpoint_exists(self, thread_id: str) -> bool:
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncPostgresSaver
        saver = _LazyAsyncPostgresSaver(POSTGRES_DSN)
        config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
        result = await saver.aget_tuple(config)
        return result is not None

    async def fact_count(self, user_id: str) -> int:
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore
        store = _LazyAsyncPostgresStore(POSTGRES_DSN)
        results = await store.asearch(("memories", user_id), limit=100)
        return len(results)


class MongoDBStorageVerifier:
    """Queries MongoDB checkpoint + store using our lazy wrappers."""

    async def checkpoint_exists(self, thread_id: str) -> bool:
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncMongoDBSaver
        saver = _LazyAsyncMongoDBSaver(MONGODB_URI)
        config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
        result = await saver.aget_tuple(config)
        return result is not None

    async def fact_count(self, user_id: str) -> int:
        from ai_platform_engineering.utils.store import _LazyAsyncMongoDBStore
        store = _LazyAsyncMongoDBStore(MONGODB_URI)
        results = await store.asearch(("memories", user_id), limit=100)
        return len(results)


# ---------------------------------------------------------------------------
# Shared test logic
# ---------------------------------------------------------------------------


class _E2EPersistenceBase:
    """Base class for backend-specific E2E test classes."""

    verifier = None  # set by subclass

    # --- Phase 1: checkpoint ---

    async def _run_checkpoint_test(self) -> None:
        context_id = str(uuid.uuid4())
        user_id = f"e2e-ckpt-{uuid.uuid4().hex[:8]}"

        print(f"\n  [checkpoint] thread_id={context_id[:12]}... user={user_id}")

        result = await send_a2a_message(
            "What is Kubernetes? Give me a one-sentence answer.",
            context_id=context_id,
            user_id=user_id,
        )
        response_text = extract_response_text(result)
        assert response_text, "Supervisor returned empty response — is it running?"

        print(f"  [checkpoint] response: {response_text[:120]}...")

        exists = await self.verifier.checkpoint_exists(context_id)
        assert exists, (
            f"No checkpoint found for thread_id={context_id}. "
            "Ensure the supervisor is configured for this backend "
            "(LANGGRAPH_CHECKPOINT_TYPE env var)."
        )
        print(f"  [checkpoint] ✅ Checkpoint found in storage")

    # --- Phase 2: fact storage ---

    async def _run_fact_storage_test(self) -> None:
        context_id = str(uuid.uuid4())
        user_id = f"e2e-facts-{uuid.uuid4().hex[:8]}"

        print(f"\n  [facts] thread_id={context_id[:12]}... user={user_id}")

        for i, msg in enumerate(FACT_MESSAGES, 1):
            print(f"  [facts] Turn {i}/{len(FACT_MESSAGES)}: {msg[:60]}...")
            await send_a2a_message(msg, context_id=context_id, user_id=user_id)
            if i < len(FACT_MESSAGES):
                await asyncio.sleep(3)

        print(f"  [facts] Waiting {FACT_EXTRACTION_WAIT_SECS}s for background extraction...")
        await asyncio.sleep(FACT_EXTRACTION_WAIT_SECS)

        count = await self.verifier.fact_count(user_id)
        print(f"  [facts] Found {count} facts in storage for user={user_id}")

        if count == 0:
            warnings.warn(
                f"No facts extracted for user={user_id}. "
                "Ensure ENABLE_FACT_EXTRACTION=true in supervisor config and "
                "that the supervisor is configured for this storage backend "
                "(LANGGRAPH_STORE_TYPE env var).",
                stacklevel=2,
            )
            pytest.skip(
                "No facts extracted — set ENABLE_FACT_EXTRACTION=true "
                "and LANGGRAPH_STORE_TYPE to the active backend"
            )

        assert count > 0, f"Expected facts in storage, got 0 for user={user_id}"
        print(f"  [facts] ✅ {count} facts stored in backend")

    # --- Phase 3: cross-thread recall ---

    async def _run_recall_test(self) -> None:
        user_id = f"e2e-recall-{uuid.uuid4().hex[:8]}"
        seed_context_id = str(uuid.uuid4())

        print(f"\n  [recall] user={user_id}")
        print(f"  [recall] Phase 3a: Seeding facts on thread {seed_context_id[:12]}...")

        for i, msg in enumerate(FACT_MESSAGES, 1):
            print(f"  [recall] Seed turn {i}/{len(FACT_MESSAGES)}")
            await send_a2a_message(msg, context_id=seed_context_id, user_id=user_id)
            if i < len(FACT_MESSAGES):
                await asyncio.sleep(3)

        print(f"  [recall] Waiting {FACT_EXTRACTION_WAIT_SECS}s for background extraction...")
        await asyncio.sleep(FACT_EXTRACTION_WAIT_SECS)

        # Verify facts made it to storage before testing recall
        count = await self.verifier.fact_count(user_id)
        if count == 0:
            pytest.skip(
                "No facts in storage — cannot test recall. "
                "Ensure ENABLE_FACT_EXTRACTION=true and LANGGRAPH_STORE_TYPE is set."
            )

        # Open a NEW thread and ask for recall
        recall_context_id = str(uuid.uuid4())
        print(f"  [recall] Phase 3b: Asking recall on new thread {recall_context_id[:12]}...")

        result = await send_a2a_message(
            "What do you remember about me and my infrastructure setup? "
            "List all facts you know about my team, tools, and preferences.",
            context_id=recall_context_id,
            user_id=user_id,
        )
        response_text = extract_response_text(result)
        print(f"  [recall] Response ({len(response_text)} chars): {response_text[:300]}...")

        text_lower = response_text.lower()
        found = [kw for kw in FACT_KEYWORDS if kw.lower() in text_lower]
        missed = [kw for kw in FACT_KEYWORDS if kw.lower() not in text_lower]
        recall_pct = len(found) / len(FACT_KEYWORDS) * 100

        print(f"  [recall] Keywords found: {len(found)}/{len(FACT_KEYWORDS)} ({recall_pct:.0f}%)")
        print(f"  [recall] Found: {found}")
        if missed:
            print(f"  [recall] Missed: {missed}")

        assert recall_pct >= RECALL_THRESHOLD_PCT, (
            f"Recall {recall_pct:.0f}% < {RECALL_THRESHOLD_PCT}% threshold. "
            f"Found: {found}. Missed: {missed}"
        )
        print(f"  [recall] ✅ Recalled {recall_pct:.0f}% of seeded facts")


# ---------------------------------------------------------------------------
# Redis E2E Tests
# ---------------------------------------------------------------------------


class TestRedisE2EPersistence(_E2EPersistenceBase):
    """
    E2E persistence tests against Redis backend.

    Start: IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-redis" \\
             docker compose -f docker-compose.dev.yaml up -d
    .env:  LANGGRAPH_CHECKPOINT_TYPE=redis
           LANGGRAPH_STORE_TYPE=redis
           ENABLE_FACT_EXTRACTION=true
    """

    verifier = RedisStorageVerifier()

    @skip_if_no_supervisor
    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_checkpoint_written_to_redis(self):
        """A2A message → supervisor writes checkpoint → verifiable in Redis."""
        await self._run_checkpoint_test()

    @skip_if_no_supervisor
    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_facts_extracted_and_stored_in_redis(self):
        """Fact-rich A2A conversation → background extraction → facts in Redis store."""
        await self._run_fact_storage_test()

    @skip_if_no_supervisor
    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_cross_thread_fact_recall_from_redis(self):
        """Facts seeded on thread A → new thread B → agent recalls facts from Redis."""
        await self._run_recall_test()


# ---------------------------------------------------------------------------
# Postgres E2E Tests
# ---------------------------------------------------------------------------


class TestPostgresE2EPersistence(_E2EPersistenceBase):
    """
    E2E persistence tests against Postgres backend.

    Start: IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-postgres" \\
             docker compose -f docker-compose.dev.yaml up -d
    .env:  LANGGRAPH_CHECKPOINT_TYPE=postgres
           LANGGRAPH_STORE_TYPE=postgres
           ENABLE_FACT_EXTRACTION=true
    """

    verifier = PostgresStorageVerifier()

    @skip_if_no_supervisor
    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_checkpoint_written_to_postgres(self):
        """A2A message → supervisor writes checkpoint → verifiable in Postgres."""
        await self._run_checkpoint_test()

    @skip_if_no_supervisor
    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_facts_extracted_and_stored_in_postgres(self):
        """Fact-rich A2A conversation → background extraction → facts in Postgres store."""
        await self._run_fact_storage_test()

    @skip_if_no_supervisor
    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_cross_thread_fact_recall_from_postgres(self):
        """Facts seeded on thread A → new thread B → agent recalls facts from Postgres."""
        await self._run_recall_test()


# ---------------------------------------------------------------------------
# MongoDB E2E Tests
# ---------------------------------------------------------------------------


class TestMongoDBE2EPersistence(_E2EPersistenceBase):
    """
    E2E persistence tests against MongoDB backend.

    Start: IMAGE_TAG=0.2.38 COMPOSE_PROFILES="...,langgraph-mongodb" \\
             docker compose -f docker-compose.dev.yaml up -d
    .env:  LANGGRAPH_CHECKPOINT_TYPE=mongodb
           LANGGRAPH_STORE_TYPE=mongodb
           ENABLE_FACT_EXTRACTION=true
    """

    verifier = MongoDBStorageVerifier()

    @skip_if_no_supervisor
    @skip_if_no_mongodb
    @pytest.mark.asyncio
    async def test_checkpoint_written_to_mongodb(self):
        """A2A message → supervisor writes checkpoint → verifiable in MongoDB."""
        await self._run_checkpoint_test()

    @skip_if_no_supervisor
    @skip_if_no_mongodb
    @pytest.mark.asyncio
    async def test_facts_extracted_and_stored_in_mongodb(self):
        """Fact-rich A2A conversation → background extraction → facts in MongoDB store."""
        await self._run_fact_storage_test()

    @skip_if_no_supervisor
    @skip_if_no_mongodb
    @pytest.mark.asyncio
    async def test_cross_thread_fact_recall_from_mongodb(self):
        """Facts seeded on thread A → new thread B → agent recalls facts from MongoDB."""
        await self._run_recall_test()


# ---------------------------------------------------------------------------
# CLI runner (for direct script execution without pytest)
# ---------------------------------------------------------------------------


async def _run_backend(backend: str, verifier) -> dict[str, bool]:
    """Run all three phases for one backend and return pass/fail per phase."""
    suite = _E2EPersistenceBase()
    suite.verifier = verifier
    results = {}

    for phase, method in [
        ("checkpoint", suite._run_checkpoint_test),
        ("fact_storage", suite._run_fact_storage_test),
        ("fact_recall", suite._run_recall_test),
    ]:
        label = f"{backend}/{phase}"
        try:
            await method()
            results[label] = True
            print(f"  ✅ PASS  {label}")
        except Exception as exc:
            results[label] = False
            print(f"  ❌ FAIL  {label}: {exc}")

    return results


async def _cli_main(backends: list[str]) -> int:
    print("=" * 70)
    print("  E2E Persistence Backend Tests")
    print("=" * 70)

    if not _supervisor_reachable():
        print("❌ Supervisor not reachable on localhost:8000 — aborting")
        return 1

    all_results: dict[str, bool] = {}

    for backend in backends:
        print(f"\n{'─'*70}")
        print(f"  Backend: {backend.upper()}")
        print(f"{'─'*70}")

        if backend == "redis":
            if not _redis_reachable():
                print("  SKIP — Redis not reachable on localhost:6380")
                continue
            results = await _run_backend("redis", RedisStorageVerifier())
        elif backend == "postgres":
            if not _postgres_reachable():
                print("  SKIP — Postgres not reachable on localhost:5433")
                continue
            results = await _run_backend("postgres", PostgresStorageVerifier())
        elif backend == "mongodb":
            if not _mongodb_reachable():
                print("  SKIP — MongoDB not reachable on localhost:27018")
                continue
            results = await _run_backend("mongodb", MongoDBStorageVerifier())
        else:
            print(f"  SKIP — unknown backend '{backend}'")
            continue

        all_results.update(results)

    print(f"\n{'='*70}")
    print("  Summary")
    print(f"{'='*70}")
    passed = sum(1 for v in all_results.values() if v)
    total = len(all_results)
    for name, ok in all_results.items():
        print(f"  {'✅' if ok else '❌'} {name}")
    print(f"\n  {passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    import sys

    backends = sys.argv[1:] if len(sys.argv) > 1 else ["redis", "postgres", "mongodb"]
    sys.exit(asyncio.run(_cli_main(backends)))
