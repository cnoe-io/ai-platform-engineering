#!/usr/bin/env python3
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Multi-turn integration test for orphaned tool call repair.

Sends multiple turns to the supervisor using the same contextId to build up
conversation history with sub-agent delegations. This is the scenario that
triggers orphaned tool calls when streams are cancelled or sub-agents time out.

The test verifies:
  1. All turns complete without "Recovery retry failed" errors
  2. The orphan repair mechanism activates when needed

Prerequisites:
  - Supervisor running on localhost:8000
  - Sub-agents (GitHub, ArgoCD/AWS, Jira) running and reachable

Usage:
    PYTHONPATH=. uv run python integration/test_orphan_repair_multiturn.py
    PYTHONPATH=. uv run python integration/test_orphan_repair_multiturn.py --turns 3
    PYTHONPATH=. uv run python integration/test_orphan_repair_multiturn.py --url http://localhost:8000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid

import httpx

DEFAULT_URL = "http://localhost:8000"
DEFAULT_TIMEOUT = 120


TURNS = [
    # Turn 1-3: Hit three different sub-agents to build up tool_call history
    "List 5 recent open PRs for cnoe-io/ai-platform-engineering with their full titles and authors",
    "List all ArgoCD apps in the caipe-preview namespace with their sync and health status",
    "Show me the 5 most recent Jira tickets assigned to me with summary and status",
    # Turn 4: Cross-reference forces LLM to retain all prior context
    "Compare the PRs, ArgoCD apps, and Jira tickets. Are any PRs related to the ArgoCD apps or Jira tickets?",
    # Turn 5: Another large sub-agent call to push context further
    "List all open PRs across cnoe-io/ai-platform-engineering and cnoe-io/cnoe-agent-utils repos",
    # Turn 6: Summarization pressure — asks about everything seen so far
    "Give me a detailed status report combining all GitHub PRs, ArgoCD apps, and Jira tickets you found",
    # Turn 7-8: Keep pushing with more sub-agent delegations
    "Check if there are any failing or degraded ArgoCD apps across all namespaces",
    "What Jira tickets are in the current sprint?",
    # Turn 9: Context window introspection
    "What is your current context window usage?",
    # Turn 10: Final cross-reference to stress summarization boundary
    "Based on everything we discussed, what are the top 3 action items I should focus on?",
]


async def send_streaming_message(
    client: httpx.AsyncClient,
    base_url: str,
    text: str,
    context_id: str,
    turn: int,
    timeout: int,
) -> dict:
    """Send one A2A streaming message and collect results."""
    payload = {
        "jsonrpc": "2.0",
        "id": f"turn-{turn}",
        "method": "message/stream",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": text}],
                "messageId": str(uuid.uuid4()),
                "contextId": context_id,
            }
        },
    }

    text_parts: list[str] = []
    status_updates: list[str] = []
    error_events: list[dict] = []
    event_count = 0
    t0 = time.monotonic()

    def _parse_sse_line(line: str) -> None:
        nonlocal event_count
        if not line.startswith("data: "):
            return
        try:
            data = json.loads(line[6:])
        except json.JSONDecodeError:
            return
        event_count += 1
        result = data.get("result", {})
        kind = result.get("kind", "")

        if kind == "artifact-update":
            for p in result.get("artifact", {}).get("parts", []):
                t = p.get("text", p.get("data", ""))
                if t:
                    text_parts.append(str(t))
        elif kind == "status-update":
            state = result.get("status", {}).get("state", "")
            if state:
                status_updates.append(state)
        elif kind == "error":
            error_events.append(data)

    try:
        async with client.stream(
            "POST",
            base_url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            timeout=timeout,
        ) as resp:
            async for raw_line in resp.aiter_lines():
                _parse_sse_line(raw_line)

    except httpx.ReadTimeout:
        pass
    except Exception as exc:
        error_events.append({"exception": str(exc)})

    elapsed = time.monotonic() - t0
    full_text = "".join(text_parts)

    return {
        "turn": turn,
        "events": event_count,
        "text_len": len(full_text),
        "statuses": status_updates,
        "errors": error_events,
        "completed": "completed" in status_updates,
        "failed": "failed" in status_updates,
        "elapsed_s": round(elapsed, 1),
        "preview": full_text[:200],
        "has_recovery_failed": "Recovery retry failed" in full_text,
        "has_fallback": "fallback streaming" in full_text.lower(),
    }


async def main(base_url: str, num_turns: int, timeout: int) -> int:
    context_id = str(uuid.uuid4())

    print("=" * 65)
    print("  ORPHANED TOOL CALL REPAIR — MULTI-TURN INTEGRATION TEST")
    print("=" * 65)
    print(f"  Target:     {base_url}")
    print(f"  Context ID: {context_id}")
    print(f"  Turns:      {num_turns}")
    print(f"  Timeout:    {timeout}s per turn")
    print()

    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(
                f"{base_url}/.well-known/agent-card.json", timeout=10
            )
            card = r.json()
            print(f"  Supervisor: {card['name']}")
        except Exception as exc:
            print(f"  ERROR: supervisor not reachable at {base_url}: {exc}")
            return 1

    turns_to_run = TURNS[:num_turns]
    results: list[dict] = []

    async with httpx.AsyncClient() as client:
        for i, query in enumerate(turns_to_run, 1):
            print(f"\n--- Turn {i}/{len(turns_to_run)} ---")
            print(f"  Query: {query}")

            result = await send_streaming_message(
                client, base_url, query, context_id, i, timeout
            )
            results.append(result)

            status_label = "PASS" if result["completed"] else (
                "FAIL" if result["failed"] else "TIMEOUT"
            )
            print(f"  Status:  {status_label}  ({result['elapsed_s']}s)")
            print(f"  Events:  {result['events']}   Text: {result['text_len']} chars")

            if result["errors"]:
                print(f"  ERRORS:  {result['errors']}")
            if result["has_recovery_failed"]:
                print("  *** RECOVERY FAILED DETECTED ***")
            if result["has_fallback"]:
                print("  *** FALLBACK STREAMING DETECTED ***")
            if result["preview"]:
                print(f"  Preview: {result['preview'][:120]}...")

            if i < len(turns_to_run):
                await asyncio.sleep(2)

    # Summary
    print(f"\n{'=' * 65}")
    print("  SUMMARY")
    print("=" * 65)

    completed = sum(1 for r in results if r["completed"])
    failed = sum(1 for r in results if r["failed"])
    timed_out = sum(
        1 for r in results if not r["completed"] and not r["failed"]
    )
    recovery_failures = sum(1 for r in results if r["has_recovery_failed"])
    fallbacks = sum(1 for r in results if r["has_fallback"])

    print(f"  Total turns:       {len(results)}")
    print(f"  Completed:         {completed}")
    print(f"  Failed:            {failed}")
    print(f"  Timed out:         {timed_out}")
    print(f"  Recovery failures: {recovery_failures}")
    print(f"  Fallback triggers: {fallbacks}")

    if failed or recovery_failures:
        print("\n  RESULT: FAIL")
        print("  Check supervisor logs:")
        print("    docker logs caipe-supervisor 2>&1 | "
              "grep -iE 'orphan|repair|force|fallback|toolResult'")
        return 1

    print("\n  RESULT: PASS")
    print("  Check logs for repair activity (expected if fix is working):")
    print("    docker logs caipe-supervisor 2>&1 | "
          "grep -iE 'orphan|repair|pre-fallback|safe.*cut|boundary'")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Multi-turn integration test for orphan repair"
    )
    parser.add_argument(
        "--url", default=DEFAULT_URL, help=f"Supervisor URL (default: {DEFAULT_URL})"
    )
    parser.add_argument(
        "--turns", type=int, default=10, help="Number of turns to run (default: 10)"
    )
    parser.add_argument(
        "--timeout", type=int, default=DEFAULT_TIMEOUT,
        help=f"Per-turn timeout in seconds (default: {DEFAULT_TIMEOUT})"
    )
    args = parser.parse_args()

    exit_code = asyncio.run(main(args.url, args.turns, args.timeout))
    sys.exit(exit_code)
