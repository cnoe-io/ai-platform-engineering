# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Minimal streaming debug harness.

This script calls the supervisor streaming endpoint and prints a compact view of events.
It is intentionally small and dependency-light.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python test_streaming_debug.py /tmp/<capture>.jsonl", file=sys.stderr)
        raise SystemExit(2)

    p = Path(sys.argv[1])
    if not p.exists():
        print(f"File not found: {p}", file=sys.stderr)
        raise SystemExit(2)

    kinds: Counter[str] = Counter()
    artifacts: Counter[str] = Counter()

    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        res = obj.get("result", {}) or {}
        kind = str(res.get("kind") or "")
        kinds[kind] += 1
        if kind == "artifact-update":
            art = res.get("artifact", {}) or {}
            name = art.get("name")
            if name:
                artifacts[str(name)] += 1

    print("Kind counts:", dict(kinds))
    print("Artifact name counts:", dict(artifacts))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Debug streaming response duplication by tabulating all events."""

import asyncio
import json
from uuid import uuid4
from collections import defaultdict

import httpx
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import (
    SendStreamingMessageRequest,
    MessageStreamParams,
    AgentCard,
)

AGENT_URL = "http://localhost:8000"
SESSION_CONTEXT_ID = uuid4().hex

def create_streaming_payload(text: str) -> dict:
    return {
        "message": {
            "role": "user",
            "parts": [{"type": "text", "text": text}],
            "messageId": uuid4().hex,
            "contextId": SESSION_CONTEXT_ID
        }
    }

async def fetch_agent_card() -> AgentCard:
    """Fetch the agent card."""
    async with httpx.AsyncClient() as httpx_client:
        resolver = A2ACardResolver(httpx_client=httpx_client, base_url=AGENT_URL)
        return await resolver.get_agent_card()

async def test_streaming(message: str):
    """Test streaming and tabulate all events."""
    print(f"\n{'='*80}")
    print(f"Testing: {message}")
    print(f"{'='*80}\n")

    # Track events
    events = []
    content_chunks = []
    duplicates = defaultdict(int)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as httpx_client:
            agent_card = await fetch_agent_card()
            client = A2AClient(agent_card=agent_card, httpx_client=httpx_client)
            client.url = AGENT_URL

            payload = create_streaming_payload(message)
            request = SendStreamingMessageRequest(
                id=uuid4().hex,
                params=MessageStreamParams(**payload)
            )

            print("📡 Streaming events:\n")
            print(f"{'#':<5} {'Event Type':<20} {'Content Preview':<60} {'Length':<8}")
            print("-" * 100)

            event_num = 0
            async for response in client.send_streaming_message(request):
                event_num += 1

                # Extract event details
                event_type = "unknown"
                content = ""

                if hasattr(response, 'root'):
                    root = response.root
                    if hasattr(root, 'event'):
                        event_type = root.event or "unknown"

                    # Try to extract content
                    if hasattr(root, 'artifact'):
                        artifact = root.artifact
                        if hasattr(artifact, 'parts'):
                            for part in artifact.parts:
                                if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                    content = part.root.text
                                elif hasattr(part, 'text'):
                                    content = part.text

                    elif hasattr(root, 'status') and hasattr(root.status, 'message'):
                        msg = root.status.message
                        if hasattr(msg, 'parts'):
                            for part in msg.parts:
                                if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                    content = part.root.text
                                elif hasattr(part, 'text'):
                                    content = part.text

                # Track content
                if content:
                    content_chunks.append(content)
                    duplicates[content] += 1

                # Print row
                content_preview = content[:60].replace('\n', '\\n') if content else "-"
                content_len = len(content) if content else 0
                print(f"{event_num:<5} {event_type:<20} {content_preview:<60} {content_len:<8}")

                # Store full event
                events.append({
                    "num": event_num,
                    "type": event_type,
                    "content": content,
                    "raw": str(response)[:200]
                })

            # Summary
            print("\n" + "="*100)
            print(f"\n📊 SUMMARY:")
            print(f"Total events: {event_num}")
            print(f"Content chunks: {len(content_chunks)}")
            print(f"Unique content: {len(set(content_chunks))}")

            # Show duplicates
            print(f"\n🔁 DUPLICATES:")
            for content, count in duplicates.items():
                if count > 1:
                    preview = content[:80].replace('\n', '\\n')
                    print(f"  {count}x: {preview}...")

            # Combined output
            combined = "".join(content_chunks)
            print(f"\n📝 COMBINED OUTPUT ({len(combined)} chars):")
            print(combined[:500])
            if len(combined) > 500:
                print(f"\n... ({len(combined) - 500} more characters)")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_streaming("get PRs for ai-platform-engineering repo"))

