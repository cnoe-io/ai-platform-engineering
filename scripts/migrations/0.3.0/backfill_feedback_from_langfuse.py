#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Backfill historical Slack feedback from Langfuse → MongoDB feedback collection.

One-time script that pulls scores with name="all slack channels" from the
Langfuse REST API and upserts them into the `feedback` MongoDB collection.

Key behaviours:
  - Deduplicates by slack_permalink before writing: when multiple Langfuse
    scores point to the same Slack message, only the best record is kept
    (specific reason > thumbs_up > thumbs_down, latest timestamp tiebreaker).
  - Parses message_id from the permalink URL path.
  - Resolves thread_ts and conversation_id when --interactions-json is provided
    (uses the slack_interactions.json message-to-thread lookup).
  - MongoDB upsert on (slack_permalink, source) prevents duplicates on re-runs.

Modes:
  --dump-json FILE    Fetch from Langfuse and save raw scores to a JSON file (no MongoDB needed)
  --from-json FILE    Load scores from a previously dumped JSON file instead of hitting Langfuse
  (default)           Fetch from Langfuse and write directly to MongoDB

Incremental mode:
  --incremental       When used with --dump-json, only fetch scores newer than the latest
                      timestamp already in the file, then merge them in.

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

  # Load from local file and write to MongoDB (with interactions for linkage):
  python backfill_feedback_from_langfuse.py --from-json data/langfuse_scores.json \
    --interactions-json data/slack_interactions.json

  # Dry run:
  python backfill_feedback_from_langfuse.py --from-json data/langfuse_scores.json --dry-run
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

SPECIFIC_REASONS = {"needs_detail", "too_verbose", "wrong_answer", "other", "retry"}


def get_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: {name} environment variable is required", file=sys.stderr)
        sys.exit(1)
    return val


def fetch_langfuse_scores(host: str, public_key: str, secret_key: str, from_timestamp: str | None = None):
    """Paginate through Langfuse /api/public/scores for 'all slack channels'."""
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
    timestamps = []
    for s in scores:
        ts = s.get("createdAt")
        if ts:
            try:
                timestamps.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except (ValueError, AttributeError):
                continue  # skip malformed timestamps
    return max(timestamps).isoformat() if timestamps else None


def load_json_file(path: Path) -> tuple[list[dict], dict]:
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, list):
        return raw, {}
    return raw.get("scores", []), raw.get("_meta", {})


def save_json_file(path: Path, scores: list[dict], meta: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({"_meta": meta, "scores": scores}, f, indent=2, default=str)


def parse_message_ts_from_permalink(permalink: str) -> str | None:
    if not permalink:
        return None
    m = re.search(r"/p(\d{10})(\d{6})", permalink)
    return f"{m.group(1)}.{m.group(2)}" if m else None


def build_msg_to_thread_map(interactions_path: Path) -> dict[str, str]:
    """Build message_ts -> thread_ts lookup from slack_interactions.json."""
    with open(interactions_path) as f:
        raw = json.load(f)
    interactions = raw.get("interactions", raw) if isinstance(raw, dict) else raw

    msg_to_thread: dict[str, str] = {}
    for ix in interactions:
        thread_ts = str(ix.get("thread_ts", ""))
        if not thread_ts:
            continue
        msg_to_thread[thread_ts] = thread_ts
        for fm in ix.get("forge_messages", []):
            fm_ts = str(fm.get("ts", ""))
            if fm_ts:
                msg_to_thread[fm_ts] = thread_ts
    return msg_to_thread


def map_rating(value: str) -> str:
    return "positive" if value == "thumbs_up" else "negative"


def dedup_scores_by_permalink(scores: list[dict]) -> list[dict]:
    """Group scores by (slack_permalink, user_email), keep the best per group.

    Multiple users can vote on the same bot response — each user's final vote
    counts independently.  Within a single user's votes on the same permalink,
    priority: specific reason > thumbs_up > thumbs_down, then latest createdAt.
    """
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    no_permalink = []

    for s in scores:
        pl = (s.get("metadata") or {}).get("slack_permalink", "")
        user = (s.get("metadata") or {}).get("user_email", "") or (s.get("metadata") or {}).get("user_id", "")
        if pl:
            by_key[(pl, user)].append(s)
        else:
            no_permalink.append(s)

    def sort_key(s):
        val = s.get("stringValue", "")
        priority = 2 if val in SPECIFIC_REASONS else (1 if val == "thumbs_up" else 0)
        try:
            ts = datetime.fromisoformat(s.get("createdAt", "").replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            ts = datetime.min.replace(tzinfo=timezone.utc)
        return (priority, ts)

    deduped = []
    for key, group in by_key.items():
        deduped.append(max(group, key=sort_key))

    total_removed = len(scores) - len(deduped) - len(no_permalink)
    print(f"Dedup by (permalink, user): {len(scores)} scores -> {len(deduped)} unique + {len(no_permalink)} without permalink ({total_removed} duplicates removed)")

    return deduped + no_permalink


def score_to_feedback_doc(
    score: dict,
    msg_to_thread: dict[str, str],
) -> dict | None:
    """Convert a Langfuse score to a feedback document."""
    trace_id = score.get("traceId")
    if not trace_id:
        return None

    metadata = score.get("metadata") or {}
    feedback_value = score.get("stringValue") or score.get("value", "")
    comment = score.get("comment")
    permalink = metadata.get("slack_permalink")

    created_at = datetime.now(timezone.utc)
    if score.get("createdAt"):
        try:
            created_at = datetime.fromisoformat(score["createdAt"].replace("Z", "+00:00"))
        except (ValueError, AttributeError) as e:
            print(f"  Warning: could not parse createdAt '{score.get('createdAt')}': {e}", file=sys.stderr)

    message_id = parse_message_ts_from_permalink(permalink)

    thread_ts = None
    if message_id and msg_to_thread:
        thread_ts = msg_to_thread.get(message_id)

    return {
        "trace_id": trace_id,
        "source": "slack",
        "rating": map_rating(feedback_value),
        "value": feedback_value,
        "comment": comment,
        "user_email": metadata.get("user_email"),
        "user_id": metadata.get("user_id"),
        "message_id": message_id,
        "conversation_id": None,  # resolved during MongoDB write
        "channel_id": metadata.get("channel_id"),
        "channel_name": metadata.get("channel_name"),
        "thread_ts": thread_ts,
        "slack_permalink": permalink,
        "created_at": created_at,
        "updated_at": created_at,
    }


def main():
    parser = argparse.ArgumentParser(description="Backfill Slack feedback from Langfuse")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing to MongoDB")
    parser.add_argument("--dump-json", metavar="FILE", help="Fetch from Langfuse and save raw scores to JSON file")
    parser.add_argument("--from-json", metavar="FILE", help="Load scores from a previously dumped JSON file")
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="When used with --dump-json: only fetch scores newer than the latest timestamp in the file",
    )
    parser.add_argument(
        "--interactions-json",
        metavar="FILE",
        help="Path to slack_interactions.json for thread_ts / conversation_id linkage",
    )
    args = parser.parse_args()

    if args.incremental and not args.dump_json:
        print("ERROR: --incremental requires --dump-json", file=sys.stderr)
        sys.exit(1)

    # --- Mode 1: Dump raw Langfuse scores to JSON ---
    if args.dump_json:
        outpath = Path(args.dump_json)

        existing_scores: list[dict] = []
        existing_meta: dict = {}
        from_timestamp: str | None = None

        if args.incremental:
            if not outpath.exists():
                print(f"ERROR: --incremental specified but {outpath} does not exist.", file=sys.stderr)
                sys.exit(1)
            existing_scores, existing_meta = load_json_file(outpath)
            from_timestamp = existing_meta.get("latest_timestamp") or get_latest_timestamp(existing_scores)
            if not from_timestamp:
                print("WARNING: could not determine latest timestamp — fetching all scores", file=sys.stderr)
            else:
                print(f"Incremental mode: fetching scores newer than {from_timestamp}")

        host = get_env("LANGFUSE_BASE_URL")
        public_key = get_env("LANGFUSE_PUBLIC_KEY")
        secret_key = get_env("LANGFUSE_SECRET_KEY")

        print(f"Fetching scores from {host}...")
        new_scores = list(fetch_langfuse_scores(host, public_key, secret_key, from_timestamp=from_timestamp))
        print(f"Fetched {len(new_scores)} new scores")

        if args.incremental and existing_scores:
            existing_ids = {s.get("id") for s in existing_scores if s.get("id")}
            deduped_new = [s for s in new_scores if s.get("id") not in existing_ids]
            print(f"Merging: {len(existing_scores)} existing + {len(deduped_new)} new")
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
        print(f"Saved {len(all_scores)} scores to {outpath}")
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

    # --- Dedup by permalink (same interaction = same permalink) ---
    scores = dedup_scores_by_permalink(scores)

    # --- Build message_ts -> thread_ts lookup ---
    msg_to_thread: dict[str, str] = {}
    if args.interactions_json:
        path = Path(args.interactions_json)
        if not path.exists():
            print(f"ERROR: {path} not found", file=sys.stderr)
            sys.exit(1)
        msg_to_thread = build_msg_to_thread_map(path)
        print(f"Loaded message->thread lookup: {len(msg_to_thread)} entries")

    # --- Convert to feedback docs ---
    docs = []
    skipped_no_trace = 0
    for score in scores:
        doc = score_to_feedback_doc(score, msg_to_thread)
        if doc is None:
            skipped_no_trace += 1
        else:
            docs.append(doc)

    print(f"Converted {len(docs)} feedback docs ({skipped_no_trace} skipped, no trace_id)")

    if args.dry_run:
        from collections import Counter
        ratings = Counter(d["rating"] for d in docs)
        values = Counter(d["value"] for d in docs)
        linked = sum(1 for d in docs if d["thread_ts"])
        print(f"\nRatings: {dict(ratings)}")
        print(f"Feedback values: {dict(values)}")
        print(f"With thread_ts: {linked}, Without: {len(docs) - linked}")
        if docs:
            pos = ratings.get("positive", 0)
            print(f"Satisfaction rate: {pos / len(docs) * 100:.1f}%")
        return

    # --- Write to MongoDB ---
    from pymongo import MongoClient

    mongodb_uri = get_env("MONGODB_URI")
    mongodb_db = get_env("MONGODB_DATABASE")

    client = MongoClient(mongodb_uri, tlsAllowInvalidCertificates=True)
    db = client[mongodb_db]
    feedback_coll = db["feedback"]
    conversations_coll = db["conversations"]

    # Build thread_ts -> conversation_id lookup
    print("Building thread_ts -> conversation_id lookup...")
    thread_to_conv: dict[str, str] = {}
    for conv in conversations_coll.find(
        {"source": "slack", "slack_meta.thread_ts": {"$ne": None}},
        {"_id": 1, "slack_meta.thread_ts": 1},
    ):
        ts = conv.get("slack_meta", {}).get("thread_ts")
        if ts:
            thread_to_conv[str(ts)] = str(conv["_id"])
    print(f"  Found {len(thread_to_conv)} conversations")

    # Resolve conversation_id on docs that have thread_ts
    for doc in docs:
        if doc["thread_ts"] and doc["thread_ts"] in thread_to_conv:
            doc["conversation_id"] = thread_to_conv[doc["thread_ts"]]

    inserted = 0
    skipped_existing = 0

    for doc in docs:
        # Upsert on (slack_permalink, user_email, source) — each user's vote
        # on a bot response is independent; re-runs update rather than duplicate.
        permalink = doc.get("slack_permalink")
        if permalink:
            result = feedback_coll.update_one(
                {"slack_permalink": permalink, "user_email": doc["user_email"], "source": "slack"},
                {
                    "$set": {
                        "trace_id": doc["trace_id"],
                        "rating": doc["rating"],
                        "value": doc["value"],
                        "comment": doc["comment"],
                        "user_email": doc["user_email"],
                        "user_id": doc["user_id"],
                        "conversation_id": doc["conversation_id"],
                        "channel_id": doc["channel_id"],
                        "channel_name": doc["channel_name"],
                        "thread_ts": doc["thread_ts"],
                        "slack_permalink": permalink,
                        "updated_at": doc["updated_at"],
                    },
                    "$setOnInsert": {
                        "message_id": doc["message_id"],
                        "created_at": doc["created_at"],
                    },
                },
                upsert=True,
            )
            if result.upserted_id:
                inserted += 1
            else:
                skipped_existing += 1
        else:
            # No permalink — fall back to trace_id dedup
            existing = feedback_coll.find_one({"trace_id": doc["trace_id"], "source": "slack"})
            if existing:
                skipped_existing += 1
                continue
            feedback_coll.insert_one(doc)
            inserted += 1

    linked = sum(1 for d in docs if d.get("conversation_id"))
    print(f"\nDone. Inserted: {inserted}, Skipped (already exists): {skipped_existing}")
    print(f"Linked to conversations: {linked}")
    client.close()


if __name__ == "__main__":
    main()
