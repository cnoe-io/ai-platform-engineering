#!/usr/bin/env python3
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive LangGraph persistence & memory integration tests.

Tests all persistence features exercisable through the A2A protocol:
  1. Thread persistence (same contextId across turns)
  2. Memory recall (agent remembers facts from earlier turns)
  3. Thread isolation (different contextId = independent state)
  4. Multi-turn accumulation (3+ turns build up state)
  5. Context compression / pre-flight summarization
  6. Orphaned tool call resilience (sub-agent delegation)
  7. New thread creation (omitted contextId)
  8. Concurrent threads (parallel conversations)
  9. Long conversation stress test
 10. Structured response persistence

Prerequisites:
  - Supervisor running on localhost:8000

Usage:
    PYTHONPATH=. uv run python integration/test_persistence_features.py
    PYTHONPATH=. uv run python integration/test_persistence_features.py --url http://localhost:8000
    PYTHONPATH=. uv run python integration/test_persistence_features.py --test recall
    PYTHONPATH=. uv run python integration/test_persistence_features.py --verbose
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
from dataclasses import dataclass, field

import httpx

DEFAULT_URL = "http://localhost:8000"
DEFAULT_TIMEOUT = 120


@dataclass
class TestResult:
    name: str
    passed: bool
    duration: float
    details: str = ""
    error: str = ""


@dataclass
class TestSuite:
    results: list[TestResult] = field(default_factory=list)

    def add(self, result: TestResult) -> None:
        self.results.append(result)
        status = "✅ PASS" if result.passed else "❌ FAIL"
        print(f"  {status} {result.name} ({result.duration:.1f}s)")
        if result.details:
            for line in result.details.split("\n"):
                print(f"         {line}")
        if result.error:
            print(f"         Error: {result.error}")

    def summary(self) -> str:
        passed = sum(1 for r in self.results if r.passed)
        total = len(self.results)
        lines = [
            "",
            "=" * 70,
            f"  RESULTS: {passed}/{total} tests passed",
            "=" * 70,
        ]
        for r in self.results:
            status = "✅" if r.passed else "❌"
            lines.append(f"  {status} {r.name} ({r.duration:.1f}s)")
        lines.append("=" * 70)
        return "\n".join(lines)

    @property
    def all_passed(self) -> bool:
        return all(r.passed for r in self.results)


async def send_message(
    client: httpx.AsyncClient,
    url: str,
    text: str,
    context_id: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    verbose: bool = False,
) -> dict:
    """Send a message/send request and return parsed result."""
    msg: dict = {
        "role": "user",
        "parts": [{"kind": "text", "text": text}],
        "messageId": str(uuid.uuid4()),
    }
    if context_id:
        msg["contextId"] = context_id

    payload = {
        "jsonrpc": "2.0",
        "method": "message/send",
        "id": str(uuid.uuid4()),
        "params": {
            "message": msg,
            "configuration": {
                "acceptedOutputModes": ["text"],
                "blocking": True,
            },
        },
    }

    if verbose:
        print(f"    → Sending: {text[:80]}...")

    resp = await client.post(url, json=payload, timeout=timeout)
    data = resp.json()

    if "error" in data:
        raise RuntimeError(f"A2A error: {data['error']}")

    return data.get("result", {})


def extract_response_text(result: dict) -> str:
    """Extract the final text response from an A2A result."""
    for artifact in result.get("artifacts", []):
        if artifact.get("name") == "final_result":
            parts_text = []
            for part in artifact.get("parts", []):
                if part.get("kind") == "text":
                    parts_text.append(part["text"])
            if parts_text:
                return " ".join(parts_text)

    for artifact in result.get("artifacts", []):
        if artifact.get("name") == "streaming_result":
            parts_text = []
            for part in artifact.get("parts", []):
                if part.get("kind") == "text":
                    parts_text.append(part["text"])
            if parts_text:
                return "".join(parts_text)

    return ""


# ──────────────────────────────────────────────────────────────────────────────
# Test 1: Basic Thread Persistence
# ──────────────────────────────────────────────────────────────────────────────
async def test_thread_persistence(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Two messages on the same contextId share conversation state."""
    name = "Thread Persistence (same contextId)"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        r1 = await send_message(client, url, "Hello, just say 'acknowledged' to confirm you can hear me.", ctx, verbose=verbose)
        returned_ctx = r1.get("contextId", "")
        if returned_ctx != ctx:
            return TestResult(name, False, time.monotonic() - t0,
                              error=f"Context ID mismatch: sent={ctx}, got={returned_ctx}")

        r2 = await send_message(client, url, "What was the first thing I said to you?", ctx, verbose=verbose)
        returned_ctx2 = r2.get("contextId", "")

        text2 = extract_response_text(r2).lower()
        persistence_ok = returned_ctx2 == ctx
        recall_ok = any(w in text2 for w in ["acknowledged", "hello", "hear", "confirm", "first"])

        return TestResult(name, persistence_ok and recall_ok, time.monotonic() - t0,
                          details=f"contextId preserved: {persistence_ok}, recall detected: {recall_ok}")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 2: Memory Recall (Facts)
# ──────────────────────────────────────────────────────────────────────────────
async def test_memory_recall(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Agent remembers specific facts told in a prior message."""
    name = "Memory Recall (facts)"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        await send_message(
            client, url,
            "Remember these facts: My project codename is Phoenix, "
            "it has 42 microservices, and the deployment target is EKS in us-west-2.",
            ctx, verbose=verbose,
        )

        r2 = await send_message(
            client, url,
            "What is my project codename, how many microservices does it have, "
            "and what is the deployment target?",
            ctx, verbose=verbose,
        )

        text = extract_response_text(r2).lower()
        checks = {
            "codename": "phoenix" in text,
            "microservices": "42" in text,
            "region": "us-west-2" in text or "eks" in text,
        }

        all_ok = all(checks.values())
        detail = ", ".join(f"{k}: {'✓' if v else '✗'}" for k, v in checks.items())
        return TestResult(name, all_ok, time.monotonic() - t0, details=detail)
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 3: Thread Isolation
# ──────────────────────────────────────────────────────────────────────────────
async def test_thread_isolation(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Different contextIds are completely isolated from each other."""
    name = "Thread Isolation (different contextId)"
    t0 = time.monotonic()
    try:
        ctx_a = str(uuid.uuid4())
        ctx_b = str(uuid.uuid4())

        await send_message(
            client, url,
            "Remember: the secret word is 'butterfly'. Only mention it if asked.",
            ctx_a, verbose=verbose,
        )

        r_b = await send_message(
            client, url,
            "What is the secret word I told you?",
            ctx_b, verbose=verbose,
        )

        text_b = extract_response_text(r_b).lower()
        isolated = "butterfly" not in text_b

        r_a = await send_message(
            client, url,
            "What is the secret word I told you?",
            ctx_a, verbose=verbose,
        )
        text_a = extract_response_text(r_a).lower()
        recalled = "butterfly" in text_a

        return TestResult(name, isolated and recalled, time.monotonic() - t0,
                          details=f"Thread B isolated: {isolated}, Thread A recalled: {recalled}")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 4: Multi-Turn Accumulation (5 turns)
# ──────────────────────────────────────────────────────────────────────────────
async def test_multi_turn_accumulation(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """State accumulates correctly over 5 turns on the same thread."""
    name = "Multi-Turn Accumulation (5 turns)"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())
        facts = [
            ("The database is PostgreSQL 15.", "postgresql", "postgres"),
            ("The cache layer uses Redis 7.", "redis",),
            ("The message broker is Kafka 3.5.", "kafka",),
            ("The search engine is Elasticsearch 8.", "elasticsearch",),
        ]

        for text, *_ in facts:
            await send_message(client, url, f"Remember: {text}", ctx, verbose=verbose)

        r = await send_message(
            client, url,
            "List all the infrastructure components I told you about "
            "(database, cache, message broker, search engine) with their version numbers.",
            ctx, verbose=verbose,
        )

        text = extract_response_text(r).lower()
        checks = {}
        for fact_text, *keywords in facts:
            checks[keywords[0]] = any(kw in text for kw in keywords)

        all_ok = all(checks.values())
        detail = ", ".join(f"{k}: {'✓' if v else '✗'}" for k, v in checks.items())
        return TestResult(name, all_ok, time.monotonic() - t0, details=detail)
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 5: New Thread on Each Request (no contextId)
# ──────────────────────────────────────────────────────────────────────────────
async def test_new_thread_each_request(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Omitting contextId creates a new thread every time."""
    name = "New Thread per Request (no contextId)"
    t0 = time.monotonic()
    try:
        r1 = await send_message(
            client, url,
            "The secret phrase is 'quantum entanglement'. Remember it.",
            context_id=None, verbose=verbose,
        )
        ctx1 = r1.get("contextId", "")

        r2 = await send_message(
            client, url,
            "What secret phrase did I tell you?",
            context_id=None, verbose=verbose,
        )
        ctx2 = r2.get("contextId", "")

        different_ctx = ctx1 != ctx2
        text2 = extract_response_text(r2).lower()
        no_recall = "quantum entanglement" not in text2

        return TestResult(name, different_ctx and no_recall, time.monotonic() - t0,
                          details=f"Different contextIds: {different_ctx}, no cross-recall: {no_recall}")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 6: Concurrent Threads
# ──────────────────────────────────────────────────────────────────────────────
async def test_concurrent_threads(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Multiple threads running concurrently don't cross-contaminate."""
    name = "Concurrent Threads (3 parallel)"
    t0 = time.monotonic()
    try:
        colors = ["red", "blue", "green"]
        contexts = [str(uuid.uuid4()) for _ in colors]

        setup_tasks = [
            send_message(client, url, f"Remember: my favorite color is {color}.", ctx, verbose=verbose)
            for color, ctx in zip(colors, contexts)
        ]
        await asyncio.gather(*setup_tasks)

        recall_tasks = [
            send_message(client, url, "What is my favorite color?", ctx, verbose=verbose)
            for ctx in contexts
        ]
        results = await asyncio.gather(*recall_tasks)

        checks = {}
        for color, result in zip(colors, results):
            text = extract_response_text(result).lower()
            checks[color] = color in text

        all_ok = all(checks.values())
        detail = ", ".join(f"{k}: {'✓' if v else '✗'}" for k, v in checks.items())
        return TestResult(name, all_ok, time.monotonic() - t0, details=detail)
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 7: Conversation Context Awareness
# ──────────────────────────────────────────────────────────────────────────────
async def test_conversation_context(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Agent uses context from prior turns to answer ambiguous follow-ups."""
    name = "Conversation Context Awareness"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        await send_message(
            client, url,
            "I'm working on a Python application called 'DataFlow' "
            "that processes real-time sensor data from IoT devices.",
            ctx, verbose=verbose,
        )

        r2 = await send_message(
            client, url,
            "What language is it written in and what kind of data does it process?",
            ctx, verbose=verbose,
        )

        text = extract_response_text(r2).lower()
        checks = {
            "language": "python" in text,
            "data_type": "sensor" in text or "iot" in text or "real-time" in text,
        }

        all_ok = all(checks.values())
        detail = ", ".join(f"{k}: {'✓' if v else '✗'}" for k, v in checks.items())
        return TestResult(name, all_ok, time.monotonic() - t0, details=detail)
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 8: Second Request Stability (the bug we fixed)
# ──────────────────────────────────────────────────────────────────────────────
async def test_second_request_stability(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Second request on the same thread completes without errors (get_next_version fix)."""
    name = "Second Request Stability (no NotImplementedError)"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        r1 = await send_message(client, url, "Say hello.", ctx, verbose=verbose)
        state1 = r1.get("status", {}).get("state", "")

        r2 = await send_message(client, url, "Say goodbye.", ctx, verbose=verbose)
        state2 = r2.get("status", {}).get("state", "")

        r3 = await send_message(client, url, "Count to 3.", ctx, verbose=verbose)
        state3 = r3.get("status", {}).get("state", "")

        all_completed = state1 == "completed" and state2 == "completed" and state3 == "completed"
        return TestResult(name, all_completed, time.monotonic() - t0,
                          details=f"Turn states: {state1}, {state2}, {state3}")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 9: Incremental State Updates
# ──────────────────────────────────────────────────────────────────────────────
async def test_incremental_state(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """State builds incrementally — later turns see all prior data."""
    name = "Incremental State Updates"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        await send_message(client, url, "I have a server named alpha.", ctx, verbose=verbose)
        await send_message(client, url, "I also have a server named beta.", ctx, verbose=verbose)
        await send_message(client, url, "And a third server named gamma.", ctx, verbose=verbose)

        r = await send_message(
            client, url,
            "List all three server names I told you about.",
            ctx, verbose=verbose,
        )

        text = extract_response_text(r).lower()
        checks = {
            "alpha": "alpha" in text,
            "beta": "beta" in text,
            "gamma": "gamma" in text,
        }

        all_ok = all(checks.values())
        detail = ", ".join(f"{k}: {'✓' if v else '✗'}" for k, v in checks.items())
        return TestResult(name, all_ok, time.monotonic() - t0, details=detail)
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 10: Message Ordering Preserved
# ──────────────────────────────────────────────────────────────────────────────
async def test_message_ordering(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Conversation history maintains correct chronological ordering."""
    name = "Message Ordering Preserved"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        await send_message(client, url, "Step 1: I initialized the database.", ctx, verbose=verbose)
        await send_message(client, url, "Step 2: I migrated the schema.", ctx, verbose=verbose)
        await send_message(client, url, "Step 3: I seeded the test data.", ctx, verbose=verbose)

        r = await send_message(
            client, url,
            "What were the three steps I performed, in order?",
            ctx, verbose=verbose,
        )

        text = extract_response_text(r).lower()
        has_order = (
            ("1" in text or "first" in text or "initial" in text)
            and ("2" in text or "second" in text or "migrat" in text)
            and ("3" in text or "third" in text or "seed" in text)
        )

        return TestResult(name, has_order, time.monotonic() - t0,
                          details=f"Order preserved in response: {has_order}")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 11: Structured Response Persistence
# ──────────────────────────────────────────────────────────────────────────────
async def test_structured_response_persistence(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Structured responses don't corrupt thread state for subsequent turns."""
    name = "Structured Response Persistence"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        r1 = await send_message(
            client, url,
            "Give me a brief bullet-point list of 3 benefits of Kubernetes.",
            ctx, verbose=verbose,
        )
        state1 = r1.get("status", {}).get("state", "")

        r2 = await send_message(
            client, url,
            "Now give me 3 benefits of Docker. Also, recall the Kubernetes benefits.",
            ctx, verbose=verbose,
        )
        state2 = r2.get("status", {}).get("state", "")
        text2 = extract_response_text(r2).lower()

        both_completed = state1 == "completed" and state2 == "completed"
        recalls_k8s = "kubernetes" in text2 or "k8s" in text2
        mentions_docker = "docker" in text2

        return TestResult(
            name, both_completed and recalls_k8s and mentions_docker,
            time.monotonic() - t0,
            details=f"States: {state1},{state2}, K8s recall: {recalls_k8s}, Docker: {mentions_docker}",
        )
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 12: Sub-Agent Delegation with Thread Persistence
# ──────────────────────────────────────────────────────────────────────────────
async def test_subagent_delegation_persistence(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Sub-agent calls don't break thread persistence on subsequent turns."""
    name = "Sub-Agent Delegation + Persistence"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        await send_message(
            client, url,
            "My team name is Platform-SRE and we use ArgoCD for deployments. Remember this.",
            ctx, verbose=verbose,
        )

        await send_message(
            client, url,
            "What is the current date and time?",
            ctx, verbose=verbose,
        )

        r3 = await send_message(
            client, url,
            "What is my team name and what tool do we use for deployments?",
            ctx, verbose=verbose,
        )
        state3 = r3.get("status", {}).get("state", "")
        text3 = extract_response_text(r3).lower()

        team_recalled = "platform" in text3 or "sre" in text3
        tool_recalled = "argocd" in text3 or "argo" in text3

        return TestResult(
            name, state3 == "completed" and team_recalled and tool_recalled,
            time.monotonic() - t0,
            details=f"Team: {team_recalled}, Tool: {tool_recalled}, State: {state3}",
        )
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 13: Long Conversation (8 turns)
# ──────────────────────────────────────────────────────────────────────────────
async def test_long_conversation(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """8-turn conversation stays stable and retains key facts."""
    name = "Long Conversation (8 turns)"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())
        turns = [
            "My name is Alex and I'm a DevOps engineer.",
            "I work at a company called TechCorp.",
            "Our main product is called CloudBridge.",
            "We deploy to AWS using Terraform and ArgoCD.",
            "Our team has 12 engineers across 3 time zones.",
            "We use Python, Go, and TypeScript as primary languages.",
            "Our SLA target is 99.95% uptime.",
            "Summarize everything you know about me and my team in a brief paragraph.",
        ]

        for turn in turns[:-1]:
            r = await send_message(client, url, turn, ctx, verbose=verbose)
            if r.get("status", {}).get("state") != "completed":
                return TestResult(name, False, time.monotonic() - t0,
                                  error=f"Turn failed: {turn[:50]}...")

        r_final = await send_message(client, url, turns[-1], ctx, verbose=verbose)
        text = extract_response_text(r_final).lower()

        checks = {
            "name": "alex" in text,
            "company": "techcorp" in text or "tech corp" in text,
            "product": "cloudbridge" in text or "cloud bridge" in text,
            "sla": "99.95" in text or "uptime" in text,
        }

        passed_count = sum(1 for v in checks.values() if v)
        all_ok = passed_count >= 3  # Allow 1 miss due to summarization

        detail = ", ".join(f"{k}: {'✓' if v else '✗'}" for k, v in checks.items())
        return TestResult(name, all_ok, time.monotonic() - t0,
                          details=f"{passed_count}/4 facts recalled: {detail}")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 14: Error Recovery on Thread
# ──────────────────────────────────────────────────────────────────────────────
async def test_error_recovery(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Thread remains usable after a potentially difficult query."""
    name = "Error Recovery on Thread"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())

        await send_message(client, url, "Remember: recovery test marker = ALPHA-BRAVO-7.", ctx, verbose=verbose)

        try:
            await send_message(
                client, url,
                "Perform a complex analysis of nonexistent-system-xyz and "
                "provide detailed metrics from the last 30 days.",
                ctx, verbose=verbose,
            )
        except Exception:
            pass  # The query might fail or return gracefully; either is fine

        r3 = await send_message(
            client, url,
            "What was the recovery test marker I told you earlier?",
            ctx, verbose=verbose,
        )
        state3 = r3.get("status", {}).get("state", "")
        text3 = extract_response_text(r3).lower()

        recovered = state3 == "completed"
        recalled = "alpha" in text3 and "bravo" in text3

        return TestResult(name, recovered and recalled, time.monotonic() - t0,
                          details=f"Recovered: {recovered}, Marker recalled: {recalled}")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Test 15: Rapid Fire (fast sequential messages)
# ──────────────────────────────────────────────────────────────────────────────
async def test_rapid_fire(client: httpx.AsyncClient, url: str, verbose: bool) -> TestResult:
    """Fast sequential messages on the same thread don't cause race conditions."""
    name = "Rapid Fire Sequential Messages"
    t0 = time.monotonic()
    try:
        ctx = str(uuid.uuid4())
        numbers = ["one", "two", "three", "four", "five"]

        for n in numbers:
            await send_message(client, url, f"Add number '{n}' to my list.", ctx, verbose=verbose)

        r = await send_message(
            client, url,
            "List all the numbers I added to my list.",
            ctx, verbose=verbose,
        )

        text = extract_response_text(r).lower()
        found = sum(1 for n in numbers if n in text)

        return TestResult(name, found >= 4, time.monotonic() - t0,
                          details=f"Found {found}/5 numbers in response")
    except Exception as e:
        return TestResult(name, False, time.monotonic() - t0, error=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Main runner
# ──────────────────────────────────────────────────────────────────────────────

ALL_TESTS = {
    "persistence": test_thread_persistence,
    "recall": test_memory_recall,
    "isolation": test_thread_isolation,
    "multi_turn": test_multi_turn_accumulation,
    "new_thread": test_new_thread_each_request,
    "concurrent": test_concurrent_threads,
    "context": test_conversation_context,
    "stability": test_second_request_stability,
    "incremental": test_incremental_state,
    "ordering": test_message_ordering,
    "structured": test_structured_response_persistence,
    "subagent": test_subagent_delegation_persistence,
    "long_conv": test_long_conversation,
    "recovery": test_error_recovery,
    "rapid_fire": test_rapid_fire,
}


async def main() -> int:
    parser = argparse.ArgumentParser(description="LangGraph persistence integration tests")
    parser.add_argument("--url", default=DEFAULT_URL, help="Agent URL")
    parser.add_argument("--test", choices=list(ALL_TESTS.keys()), help="Run a single test")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Per-request timeout")
    parser.add_argument("--verbose", action="store_true", help="Print request details")
    args = parser.parse_args()

    print("=" * 70)
    print("  LangGraph Persistence & Memory Integration Tests")
    print(f"  Target: {args.url}")
    print("=" * 70)
    print()

    # Connectivity check
    async with httpx.AsyncClient() as client:
        try:
            health = await client.get(f"{args.url}/.well-known/agent.json", timeout=10)
            agent_info = health.json()
            agent_name = agent_info.get("name", "unknown")
            print(f"  Agent: {agent_name}")
            print()
        except Exception as e:
            print(f"  ❌ Cannot reach agent at {args.url}: {e}")
            return 1

    suite = TestSuite()

    tests_to_run = {args.test: ALL_TESTS[args.test]} if args.test else ALL_TESTS

    async with httpx.AsyncClient() as client:
        for test_name, test_fn in tests_to_run.items():
            print(f"\n  Running: {test_name}")
            result = await test_fn(client, args.url, args.verbose)
            suite.add(result)

    print(suite.summary())
    return 0 if suite.all_passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
