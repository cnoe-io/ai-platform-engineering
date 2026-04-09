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

Incremental mode:
  --incremental       When used with --dump-json, only fetch scores newer than the latest
                      timestamp already in the file, then merge them in. Enables a
                      "bulk dump now, top-up at cutover" workflow:

                        # Step 1: Full dump (run days/weeks before cutover)
                        python backfill_feedback_from_langfuse.py --dump-json data/langfuse_scores.json

                        # Step 2: Top-up at cutover (only fetches new scores since Step 1)
                        python backfill_feedback_from_langfuse.py --dump-json data/langfuse_scores.json --incremental

                        # Step 3: Load the merged file into MongoDB
                        python backfill_feedback_from_langfuse.py --from-json data/langfuse_scores.json

Required env vars (when fetching from Langfuse):
  LANGFUSE_BASE_URL   e.g. https://langfuse.sdp.dev.svc.splunk8s.io
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


def fetch_langfuse_scores(host: str, public_key: str, secret_key: str, from_timestamp: str | None = None):
    """Paginate through Langfuse /api/public/scores for 'all slack channels'.

    Args:
        from_timestamp: ISO-8601 string. When set, only scores with createdAt > this
                        value are fetched (incremental mode).
    """
    url = f"{host.rstrip('/')}/api/public/scores"
    page = 1
    limit = 100
    total_fetched = 0

    while True:
        params = {"name": "all slack channels", "page": page, "limit": limit}
        if from_timestamp:
            params["fromTimestamp"] = from_timestamp
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


def get_latest_timestamp(scores: list[dict]) -> str | None:
    """Return the latest createdAt ISO string from a list of raw Langfuse score dicts."""
    timestamps = []
    for s in scores:
        ts = s.get("createdAt")
        if ts:
            try:
                timestamps.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except (ValueError, AttributeError):
                pass
    if not timestamps:
        return None
    return max(timestamps).isoformat()


def load_json_file(path: Path) -> tuple[list[dict], dict]:
    """Load a dump file. Returns (scores, metadata).

    The dump format is either:
      - Legacy: a plain JSON array of score objects
      - New: {"_meta": {...}, "scores": [...]}
    """
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, list):
        return raw, {}
    return raw.get("scores", []), raw.get("_meta", {})


def save_json_file(path: Path, scores: list[dict], meta: dict) -> None:
    """Save scores + metadata to a dump file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({"_meta": meta, "scores": scores}, f, indent=2, default=str)


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
        except (ValueError, AttributeError) as e:
            print(f"  Warning: could not parse createdAt '{score.get('createdAt')}': {e}", file=sys.stderr)

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
    parser.add_argument(
        "--incremental",
        action="store_true",
        help=(
            "When used with --dump-json: only fetch scores newer than the latest timestamp "
            "already in the file, then merge. Requires the file to exist from a prior dump."
        ),
    )
    args = parser.parse_args()

    if args.incremental and not args.dump_json:
        print("ERROR: --incremental requires --dump-json", file=sys.stderr)
        sys.exit(1)

    # --- Mode 1: Dump raw Langfuse scores to JSON (with optional incremental top-up) ---
    if args.dump_json:
        outpath = Path(args.dump_json)

        existing_scores: list[dict] = []
        existing_meta: dict = {}
        from_timestamp: str | None = None

        if args.incremental:
            if not outpath.exists():
                print(f"ERROR: --incremental specified but {outpath} does not exist. Run a full dump first.", file=sys.stderr)
                sys.exit(1)
            existing_scores, existing_meta = load_json_file(outpath)
            from_timestamp = existing_meta.get("latest_timestamp") or get_latest_timestamp(existing_scores)
            if not from_timestamp:
                print("WARNING: could not determine latest timestamp from existing file — fetching all scores", file=sys.stderr)
            else:
                print(f"Incremental mode: fetching scores newer than {from_timestamp}")

        host = get_env("LANGFUSE_BASE_URL")
        public_key = get_env("LANGFUSE_PUBLIC_KEY")
        secret_key = get_env("LANGFUSE_SECRET_KEY")

        print(f"Fetching scores from {host}...")
        new_scores = list(fetch_langfuse_scores(host, public_key, secret_key, from_timestamp=from_timestamp))
        print(f"Fetched {len(new_scores)} new scores")

        if args.incremental and existing_scores:
            # Dedup by score ID so a re-run of the incremental step is safe
            existing_ids = {s.get("id") for s in existing_scores if s.get("id")}
            deduped_new = [s for s in new_scores if s.get("id") not in existing_ids]
            print(f"Merging: {len(existing_scores)} existing + {len(deduped_new)} new (deduped from {len(new_scores)} fetched)")
            all_scores = existing_scores + deduped_new
        else:
            all_scores = new_scores

        latest_ts = get_latest_timestamp(all_scores)
        meta = {
            "latest_timestamp": latest_ts,
            "total_scores": len(all_scores),
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        save_json_file(outpath, all_scores, meta)
        print(f"Saved {len(all_scores)} scores to {outpath} (latest_timestamp: {latest_ts})")
        return

    # --- Load scores: from JSON file or live from Langfuse ---
    if args.from_json:
        print(f"Loading scores from {args.from_json}...")
        scores, _ = load_json_file(Path(args.from_json))
        print(f"Loaded {len(scores)} scores from file")
    else:
        host = get_env("LANGFUSE_BASE_URL")
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
