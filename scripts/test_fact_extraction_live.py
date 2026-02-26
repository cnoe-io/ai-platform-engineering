#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Live integration test for automatic fact extraction with recall verification.

Sends a multi-turn conversation containing extractable facts (user preferences,
infrastructure details, team context) to the running supervisor, waits for
background fact extraction to complete, then verifies the agent can recall
those facts in a follow-up conversation on a NEW thread.

Usage:
    uv run python scripts/test_fact_extraction_live.py
    uv run python scripts/test_fact_extraction_live.py --base-url http://0.0.0.0:8000
    uv run python scripts/test_fact_extraction_live.py --skip-recall
"""

import argparse
import asyncio
import sys
import uuid

import httpx

BASE_URL = "http://0.0.0.0:8000"
TIMEOUT = 120
USER_ID = f"test-user-{uuid.uuid4().hex[:8]}"

FACT_KEYWORDS = [
    "argocd",
    "prod-us-west-2",
    "platform-apps",
    "sre",
    "helm",
    "gitops",
    "50 applications",
    "concise",
]


async def send_message(
    client: httpx.AsyncClient,
    url: str,
    text: str,
    context_id: str | None = None,
    user_id: str = USER_ID,
) -> dict:
    """Send a blocking A2A message/send request."""
    msg: dict = {
        "role": "user",
        "parts": [{"kind": "text", "text": text}],
        "messageId": str(uuid.uuid4()),
        "metadata": {"user_id": user_id},
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

    print(f"\n{'='*70}")
    print(f"  SENDING: {text[:120]}...")
    print(f"{'='*70}")

    resp = await client.post(url, json=payload, timeout=TIMEOUT)
    data = resp.json()

    if "error" in data:
        print(f"  ERROR: {data['error']}")
        return data

    result = data.get("result", {})
    response_text = extract_text(result)
    print(f"  RESPONSE ({len(response_text)} chars): {response_text[:300]}...")
    return result


def extract_text(result: dict) -> str:
    """Pull final text from A2A result artifacts."""
    for artifact in result.get("artifacts", []):
        if artifact.get("name") in ("final_result", "streaming_result"):
            parts = []
            for part in artifact.get("parts", []):
                if part.get("kind") == "text":
                    parts.append(part["text"])
            if parts:
                return " ".join(parts)

    all_parts = []
    for artifact in result.get("artifacts", []):
        for part in artifact.get("parts", []):
            if part.get("kind") == "text":
                all_parts.append(part["text"])
    return " ".join(all_parts) if all_parts else "(no text found)"


def check_recall(response_text: str, keywords: list[str]) -> tuple[int, int, list[str], list[str]]:
    """Check how many keywords appear in the response."""
    text_lower = response_text.lower()
    found = [kw for kw in keywords if kw.lower() in text_lower]
    missed = [kw for kw in keywords if kw.lower() not in text_lower]
    return len(found), len(keywords), found, missed


async def phase_1_seed_facts(client: httpx.AsyncClient, url: str) -> str:
    """Phase 1: Send messages with extractable facts on one thread."""
    context_id = str(uuid.uuid4())

    print(f"\n{'#'*70}")
    print(f"  PHASE 1: SEED FACTS (Thread: {context_id[:12]}...)")
    print(f"  User ID: {USER_ID}")
    print(f"{'#'*70}")

    messages = [
        (
            "Hi! I'm a platform engineer on the SRE team. "
            "My name is Alex and I work primarily with ArgoCD and Kubernetes. "
            "Our main production cluster is called 'prod-us-west-2' "
            "and we use the 'platform-apps' namespace for our deployments."
        ),
        (
            "I prefer concise responses with code examples when possible. "
            "Our team uses Helm charts for all deployments and we follow "
            "GitOps practices with ArgoCD. We have about 50 applications "
            "managed in our production cluster."
        ),
        (
            "We also use Prometheus and Grafana for monitoring, "
            "and our CI/CD pipeline runs on GitHub Actions. "
            "I usually work with Python 3.11 for scripting and automation."
        ),
    ]

    for i, msg_text in enumerate(messages, 1):
        print(f"\n>>> Turn {i}/{len(messages)}")
        await send_message(client, url, msg_text, context_id=context_id)

        if i < len(messages):
            wait = 10
            print(f"\n  Waiting {wait}s for background fact extraction...")
            await asyncio.sleep(wait)

    return context_id


async def phase_2_verify_recall(
    client: httpx.AsyncClient,
    url: str,
) -> bool:
    """Phase 2: Start a NEW thread and ask the agent to recall facts."""
    new_context_id = str(uuid.uuid4())

    print(f"\n{'#'*70}")
    print(f"  PHASE 2: VERIFY RECALL (New Thread: {new_context_id[:12]}...)")
    print(f"  Same User ID: {USER_ID}")
    print(f"{'#'*70}")

    recall_prompt = (
        "What do you remember about me and my infrastructure setup? "
        "What facts do you know about my team, tools, and preferences? "
        "Please list everything you know."
    )

    result = await send_message(
        client, url, recall_prompt, context_id=new_context_id
    )
    response_text = extract_text(result)

    found_count, total, found, missed = check_recall(response_text, FACT_KEYWORDS)
    recall_pct = (found_count / total) * 100 if total else 0

    print(f"\n{'='*70}")
    print("  RECALL RESULTS")
    print(f"{'='*70}")
    print(f"  Keywords found: {found_count}/{total} ({recall_pct:.0f}%)")
    print(f"  Found: {found}")
    print(f"  Missed: {missed}")

    passed = recall_pct >= 50
    if passed:
        print(f"\n  PASS: Agent recalled {recall_pct:.0f}% of seeded facts")
    else:
        print(f"\n  FAIL: Agent only recalled {recall_pct:.0f}% of seeded facts (need >=50%)")

    return passed


async def phase_3_verify_isolation(
    client: httpx.AsyncClient,
    url: str,
) -> bool:
    """Phase 3: Verify a different user sees NO facts from our test user."""
    new_context_id = str(uuid.uuid4())
    other_user = f"other-user-{uuid.uuid4().hex[:8]}"

    print(f"\n{'#'*70}")
    print(f"  PHASE 3: VERIFY USER ISOLATION (User: {other_user})")
    print(f"{'#'*70}")

    result = await send_message(
        client,
        url,
        "What do you know about my infrastructure? List all facts about me.",
        context_id=new_context_id,
        user_id=other_user,
    )
    response_text = extract_text(result)

    found_count, total, found, _ = check_recall(response_text, FACT_KEYWORDS)

    if found_count <= 1:
        print(f"\n  PASS: Different user sees {found_count}/{total} facts (isolation works)")
        return True
    else:
        print(f"\n  FAIL: Different user sees {found_count}/{total} facts: {found}")
        return False


async def run_test(base_url: str, skip_recall: bool = False) -> int:
    """Run the full fact extraction test suite."""
    url = base_url.rstrip("/")

    print(f"\n{'#'*70}")
    print("  FACT EXTRACTION LIVE TEST WITH RECALL VERIFICATION")
    print(f"  Server:  {url}")
    print(f"  User ID: {USER_ID}")
    print(f"{'#'*70}")

    results = {}

    async with httpx.AsyncClient() as client:
        await phase_1_seed_facts(client, url)
        results["seed"] = True

        extraction_wait = 20
        print(f"\n  Waiting {extraction_wait}s for all background fact extraction to complete...")
        await asyncio.sleep(extraction_wait)

        if not skip_recall:
            results["recall"] = await phase_2_verify_recall(client, url)
            results["isolation"] = await phase_3_verify_isolation(client, url)

    print(f"\n{'#'*70}")
    print("  TEST SUMMARY")
    print(f"{'#'*70}")

    all_passed = True
    for name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
        if not passed:
            all_passed = False

    print(f"\n  Overall: {'ALL PASSED' if all_passed else 'SOME FAILED'}")
    print("\n  Check logs for extraction details:")
    print("    docker logs caipe-supervisor 2>&1 | grep -i 'fact'")
    print("    docker logs caipe-supervisor 2>&1 | grep -i 'memory'")
    print(f"    docker logs caipe-supervisor 2>&1 | grep -i '{USER_ID}'")

    return 0 if all_passed else 1


def main():
    parser = argparse.ArgumentParser(
        description="Test fact extraction with recall verification"
    )
    parser.add_argument("--base-url", default=BASE_URL, help="Agent base URL")
    parser.add_argument(
        "--skip-recall",
        action="store_true",
        help="Skip recall and isolation phases (seed only)",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(run_test(args.base_url, skip_recall=args.skip_recall)))


if __name__ == "__main__":
    main()
