#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Backfill historical Slack feedback from Langfuse → MongoDB feedback collection.

One-time script that pulls scores with name="all slack channels" from the
Langfuse REST API and upserts them into the `feedback` MongoDB collection.

Modes:
  --dump-json FILE    Fetch from Langfuse and save raw scores to a JSON file (no MongoDB needed)
  --from-json FILE    Load scores from a previously dumped JSON file instead of hitting Langfuse
  (default)           Fetch from Langfuse and write directly to MongoDB

Required env vars (when fetching from Langfuse):
  LANGFUSE_HOST       e.g. https://langfuse.sdp.dev.svc.splunk8s.io
  LANGFUSE_PUBLIC_KEY
  LANGFUSE_SECRET_KEY

Required env vars (when writing to MongoDB):
  MONGODB_URI         e.g. mongodb://localhost:27017
  MONGODB_DATABASE    e.g. caipe

Usage:
  # Fetch from Langfuse and save locally:
  python backfill_feedback_from_langfuse.py --dump-json data/langfuse_scores.json

  # Load from local file and write to MongoDB:
  python backfill_feedback_from_langfuse.py --from-json data/langfuse_scores.json

  # Fetch and write directly:
  python backfill_feedback_from_langfuse.py

  # Dry run (from file or live):
  python backfill_feedback_from_langfuse.py --from-json data/langfuse_scores.json --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests


def get_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: {name} environment variable is required", file=sys.stderr)
        sys.exit(1)
    return val


def fetch_langfuse_scores(host: str, public_key: str, secret_key: str):
    """Paginate through Langfuse /api/public/scores for 'all slack channels'."""
    url = f"{host.rstrip('/')}/api/public/scores"
    page = 1
    limit = 100
    total_fetched = 0

    while True:
        params = {"name": "all slack channels", "page": page, "limit": limit}
        print(f"  Fetching page {page}...", end="", flush=True)
        resp = requests.get(url, params=params, auth=(public_key, secret_key), timeout=30)
        resp.raise_for_status()
        data = resp.json()

        scores = data.get("data", [])
        if not scores:
            print(" 0 scores (done)")
            break

        total_fetched += len(scores)
        meta = data.get("meta", {})
        total_items = meta.get("totalItems", "?")
        total_pages = meta.get("totalPages", 1)
        print(f" {len(scores)} scores (page {page}/{total_pages}, {total_fetched}/{total_items} total)")

        yield from scores

        if page >= total_pages:
            break
        page += 1


def map_rating(value: str) -> str:
    return "positive" if value == "thumbs_up" else "negative"


def score_to_feedback_doc(score: dict) -> dict | None:
    """Convert a Langfuse score to a feedback document. Returns None if invalid."""
    trace_id = score.get("traceId")
    if not trace_id:
        return None

    metadata = score.get("metadata") or {}
    feedback_value = score.get("stringValue") or score.get("value", "")
    comment = score.get("comment")

    created_at = datetime.now(timezone.utc)
    if score.get("createdAt"):
        try:
            created_at = datetime.fromisoformat(score["createdAt"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass

    return {
        "trace_id": trace_id,
        "source": "slack",
        "rating": map_rating(feedback_value),
        "value": feedback_value,
        "comment": comment,
        "user_email": metadata.get("user_email"),
        "user_id": metadata.get("user_id"),
        "message_id": None,
        "conversation_id": None,
        "channel_id": metadata.get("channel_id"),
        "channel_name": metadata.get("channel_name"),
        "thread_ts": None,
        "slack_permalink": metadata.get("slack_permalink"),
        "created_at": created_at.isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="Backfill Slack feedback from Langfuse")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing to MongoDB")
    parser.add_argument("--dump-json", metavar="FILE", help="Fetch from Langfuse and save raw scores to JSON file")
    parser.add_argument("--from-json", metavar="FILE", help="Load scores from a previously dumped JSON file")
    args = parser.parse_args()

    # --- Mode 1: Dump raw Langfuse scores to JSON ---
    if args.dump_json:
        host = get_env("LANGFUSE_HOST")
        public_key = get_env("LANGFUSE_PUBLIC_KEY")
        secret_key = get_env("LANGFUSE_SECRET_KEY")

        print(f"Fetching scores from {host}...")
        all_scores = list(fetch_langfuse_scores(host, public_key, secret_key))
        print(f"Fetched {len(all_scores)} total scores")

        outpath = Path(args.dump_json)
        outpath.parent.mkdir(parents=True, exist_ok=True)
        with open(outpath, "w") as f:
            json.dump(all_scores, f, indent=2, default=str)
        print(f"Saved to {outpath}")
        return

    # --- Load scores: from JSON file or live from Langfuse ---
    if args.from_json:
        print(f"Loading scores from {args.from_json}...")
        with open(args.from_json) as f:
            scores = json.load(f)
        print(f"Loaded {len(scores)} scores from file")
    else:
        host = get_env("LANGFUSE_HOST")
        public_key = get_env("LANGFUSE_PUBLIC_KEY")
        secret_key = get_env("LANGFUSE_SECRET_KEY")
        print(f"Fetching scores from {host}...")
        scores = list(fetch_langfuse_scores(host, public_key, secret_key))
        print(f"Fetched {len(scores)} total scores")

    # --- Convert to feedback docs ---
    docs = []
    skipped_no_trace = 0
    for score in scores:
        doc = score_to_feedback_doc(score)
        if doc is None:
            skipped_no_trace += 1
        else:
            docs.append(doc)

    print(f"Converted {len(docs)} feedback docs ({skipped_no_trace} skipped, no trace_id)")

    if args.dry_run:
        # Print summary
        from collections import Counter
        ratings = Counter(d["rating"] for d in docs)
        channels = Counter(d["channel_name"] or "unknown" for d in docs)
        print(f"\nRatings: {dict(ratings)}")
        print("\nTop channels:")
        for ch, count in channels.most_common(15):
            print(f"  {ch}: {count}")
        values = Counter(d["value"] for d in docs)
        print(f"\nFeedback values: {dict(values)}")
        return

    # --- Write to MongoDB ---
    from pymongo import MongoClient

    mongodb_uri = get_env("MONGODB_URI")
    mongodb_db = get_env("MONGODB_DATABASE")

    client = MongoClient(mongodb_uri)
    db = client[mongodb_db]
    feedback_coll = db["feedback"]

    inserted = 0
    skipped_existing = 0

    for doc in docs:
        existing = feedback_coll.find_one({"trace_id": doc["trace_id"], "source": "slack"})
        if existing:
            skipped_existing += 1
            continue

        # Convert created_at back to datetime for MongoDB
        if isinstance(doc["created_at"], str):
            doc["created_at"] = datetime.fromisoformat(doc["created_at"])

        feedback_coll.insert_one(doc)
        inserted += 1

    print(f"Done. Inserted: {inserted}, Skipped (already exists): {skipped_existing}")
    client.close()


if __name__ == "__main__":
    main()
