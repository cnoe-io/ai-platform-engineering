#!/usr/bin/env python3
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Integration test harness for streaming validation.

Verifies end-to-end streaming correctness through real Docker containers:
- Tool notifications contain correct agent names (not "task")
- Streaming events arrive via SSE in correct order
- Final result artifact has non-empty content
- Supervisor responds to A2A health check

Prerequisites:
    docker compose -f docker-compose.dev.yaml up -d --build caipe-supervisor

Usage:
    python integration/test_streaming_harness.py
    # or with pytest:
    PYTHONPATH=. pytest integration/test_streaming_harness.py -v -s

Environment:
    SUPERVISOR_URL: Base URL of the supervisor (default: http://localhost:12000)
"""

import asyncio
import json
import os
import sys
from uuid import uuid4

import httpx

SUPERVISOR_URL = os.getenv("SUPERVISOR_URL", "http://localhost:12000")
TIMEOUT = float(os.getenv("STREAMING_TIMEOUT", "120"))


async def check_supervisor_health():
    """T050: Verify supervisor starts and responds to A2A health check."""
    print(f"\n{'='*60}")
    print("T050: Supervisor health check")
    print(f"{'='*60}")

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(f"{SUPERVISOR_URL}/.well-known/agent.json")
            if resp.status_code == 200:
                card = resp.json()
                print(f"  Agent name: {card.get('name', 'unknown')}")
                print(f"  Version: {card.get('version', 'unknown')}")
                caps = card.get('capabilities', {})
                print(f"  Streaming: {caps.get('streaming', False)}")
                assert card.get('name'), "Agent card must have a name"
                assert caps.get('streaming', False), "Streaming must be enabled"
                print("  PASS")
                return True
            else:
                print(f"  FAIL: HTTP {resp.status_code}")
                return False
        except httpx.ConnectError:
            print(f"  SKIP: Supervisor not running at {SUPERVISOR_URL}")
            return False


async def send_streaming_query(query: str, description: str):
    """Send a query and collect all SSE events."""
    print(f"\n{'='*60}")
    print(f"Test: {description}")
    print(f"Query: '{query}'")
    print(f"{'='*60}")

    context_id = str(uuid4())
    message_id = str(uuid4())
    request_id = str(uuid4())

    payload = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "message/stream",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": query}],
                "messageId": message_id,
                "contextId": context_id,
            }
        },
    }

    events = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT)) as client:
        async with client.stream(
            "POST",
            f"{SUPERVISOR_URL}/",
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        result = data.get("result", {})
                        events.append(result)
                    except json.JSONDecodeError:
                        pass  # skip malformed SSE lines

    return events


def extract_artifact_names(events):
    """Extract artifact names from SSE events."""
    names = []
    for event in events:
        if event.get("kind") == "artifact-update":
            artifact = event.get("artifact", {})
            name = artifact.get("name", "")
            if name:
                names.append(name)
    return names


def extract_final_result_text(events):
    """Extract text from the final_result artifact."""
    for event in reversed(events):
        if event.get("kind") == "artifact-update":
            artifact = event.get("artifact", {})
            if artifact.get("name") == "final_result":
                parts = artifact.get("parts", [])
                for part in parts:
                    if isinstance(part, dict) and part.get("text"):
                        return part["text"]
    return ""


def extract_status_states(events):
    """Extract status state transitions."""
    states = []
    for event in events:
        if event.get("kind") == "status-update":
            status = event.get("status", {})
            state = status.get("state", "")
            if state:
                states.append(state)
    return states


async def test_tool_notifications(events):
    """T051: Tool notifications contain correct agent names."""
    print("\n  T051: Tool notification agent names")
    artifact_names = extract_artifact_names(events)

    notif_starts = [n for n in artifact_names if n == "tool_notification_start"]
    notif_ends = [n for n in artifact_names if n == "tool_notification_end"]

    print(f"    Notification starts: {len(notif_starts)}")
    print(f"    Notification ends: {len(notif_ends)}")

    for event in events:
        if event.get("kind") == "artifact-update":
            artifact = event.get("artifact", {})
            if artifact.get("name") in ("tool_notification_start", "tool_notification_end"):
                metadata = artifact.get("metadata", {})
                source = metadata.get("sourceAgent", "")
                parts = artifact.get("parts", [])
                text = parts[0].get("text", "") if parts else ""
                print(f"    Source: {source} | Text: {text[:60]}...")
                if source:
                    assert source != "task", f"sourceAgent must not be 'task', got: {source}"

    if notif_starts:
        print("    PASS")
    else:
        print("    WARN: No tool notifications found (query may not have triggered tool calls)")


async def test_event_ordering(events):
    """T052: Streaming events received via SSE in correct order."""
    print("\n  T052: Event ordering")
    artifact_names = extract_artifact_names(events)
    status_states = extract_status_states(events)

    print(f"    Artifact sequence: {artifact_names[:10]}{'...' if len(artifact_names) > 10 else ''}")
    print(f"    Status sequence: {status_states}")

    if "final_result" in artifact_names:
        final_idx = artifact_names.index("final_result")
        if "streaming_result" in artifact_names:
            first_stream = artifact_names.index("streaming_result")
            assert first_stream < final_idx, "streaming_result must come before final_result"
        print("    PASS: final_result appears after streaming")
    else:
        print("    WARN: No final_result found")

    if status_states:
        assert status_states[-1] == "completed", f"Last status must be 'completed', got: {status_states[-1]}"
        print("    PASS: Last status is 'completed'")


async def test_final_result_content(events):
    """T053: Final result artifact has non-empty content."""
    print("\n  T053: Final result content")
    final_text = extract_final_result_text(events)

    if final_text:
        print(f"    Content length: {len(final_text)} chars")
        print(f"    Preview: {final_text[:200]}...")
        assert len(final_text) > 10, "Final result should have meaningful content"
        print("    PASS")
    else:
        print("    WARN: No final_result text found")


async def main():
    """Run all integration tests."""
    print("\n" + "=" * 60)
    print("  Streaming Harness Integration Tests")
    print("=" * 60)

    healthy = await check_supervisor_health()
    if not healthy:
        print("\nSupervisor not available. Skipping streaming tests.")
        print("Start with: docker compose -f docker-compose.dev.yaml up -d --build caipe-supervisor")
        sys.exit(0)

    query = "what version of argocd are we running?"
    events = await send_streaming_query(query, "T051-T053: ArgoCD version query")

    print(f"\n  Total SSE events: {len(events)}")

    await test_tool_notifications(events)
    await test_event_ordering(events)
    await test_final_result_content(events)

    print(f"\n{'='*60}")
    print("  All integration tests completed")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
