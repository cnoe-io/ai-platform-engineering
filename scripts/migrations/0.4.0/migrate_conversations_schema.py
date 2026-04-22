#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Phase 4b: Normalise conversations schema

Ensures every conversation document in the ``conversations`` collection
has a well-formed ``source`` field and a consistent metadata structure:

  1. Conversations whose ``_id`` starts with ``"slack-"`` (or that already
     have ``source: "slack"``) are left as ``source: "slack"``.
  2. All other conversations without a ``source`` field get ``source: "web"``.
  3. Conversations that already have the correct ``source`` are skipped
     (idempotent).
  4. Any legacy top-level fields that belong in ``metadata`` (e.g.
     ``channel_id``, ``channel_name``) are moved there if ``metadata`` exists
     but is missing those keys, without overwriting existing values.

Design goals:
  - Idempotent: safe to run multiple times.
  - Non-destructive: never removes data.
  - --dry-run: prints what would change without touching MongoDB.

Required environment variables:
  MONGODB_URI          e.g. mongodb://localhost:27017
  MONGODB_DATABASE     e.g. caipe  (default: caipe)

Usage:
  python migrate_conversations_schema.py --dry-run
  python migrate_conversations_schema.py
  python migrate_conversations_schema.py --verbose
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Optional

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
except ImportError:
    print("ERROR: pymongo is required.  Install it with: pip install pymongo", file=sys.stderr)
    sys.exit(1)


def get_required_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: {name} environment variable is required", file=sys.stderr)
        sys.exit(1)
    return val


def is_slack_conversation(doc: dict) -> bool:
    """Determine whether a conversation belongs to the Slack source."""
    conv_id = str(doc.get("_id", ""))
    existing_source = doc.get("source")

    # Explicit source already set
    if existing_source == "slack":
        return True
    if existing_source == "web":
        return False

    # Infer from ID convention used by InteractionTracker
    if conv_id.startswith("slack-"):
        return True

    # Infer from presence of slack_meta
    if doc.get("slack_meta"):
        return True

    return False


def compute_updates(doc: dict) -> Optional[dict]:
    """
    Return a MongoDB ``$set`` payload for the fields that need updating,
    or None if the document is already correct.
    """
    updates: dict = {}
    expected_source = "slack" if is_slack_conversation(doc) else "web"

    # 1. Fix missing or wrong source
    current_source = doc.get("source")
    if current_source != expected_source:
        updates["source"] = expected_source

    # 2. Ensure metadata sub-document exists with basic keys
    metadata = doc.get("metadata") or {}
    metadata_updates: dict = {}

    if "total_messages" not in metadata:
        # Populate from message_count field if available (legacy schema)
        message_count = doc.get("message_count")
        if message_count is not None:
            metadata_updates["metadata.total_messages"] = message_count

    if metadata_updates:
        updates.update(metadata_updates)

    # 3. For Slack conversations: ensure slack_meta has required fields
    if expected_source == "slack":
        slack_meta = doc.get("slack_meta") or {}
        slack_updates: dict = {}

        # Promote legacy top-level fields into slack_meta if missing
        for field in ("channel_id", "channel_name", "thread_ts"):
            if field not in slack_meta and doc.get(field):
                slack_updates[f"slack_meta.{field}"] = doc[field]

        if "escalated" not in slack_meta:
            slack_updates["slack_meta.escalated"] = False

        updates.update(slack_updates)

    if not updates:
        return None

    updates["updated_at"] = datetime.now(timezone.utc)
    return updates


def main():
    parser = argparse.ArgumentParser(
        description="Phase 4b: Normalise conversations schema (source field + metadata)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to MongoDB",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print details for every conversation processed",
    )
    args = parser.parse_args()

    mongodb_uri = get_required_env("MONGODB_URI")
    mongodb_db = os.environ.get("MONGODB_DATABASE", "caipe")

    print(f"Connecting to MongoDB (database: {mongodb_db})...")
    try:
        client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
    except PyMongoError as e:
        print(f"ERROR: Cannot connect to MongoDB: {e}", file=sys.stderr)
        sys.exit(1)

    db = client[mongodb_db]
    conversations_coll = db["conversations"]

    if args.dry_run:
        print("DRY-RUN mode: no data will be written.\n")

    total = conversations_coll.count_documents({})
    print(f"Found {total} conversation(s) to inspect.\n")

    stats = {
        "inspected": 0,
        "already_correct": 0,
        "updated_web": 0,
        "updated_slack": 0,
        "errors": 0,
    }

    cursor = conversations_coll.find({})

    for idx, doc in enumerate(cursor, start=1):
        conv_id = doc.get("_id")
        stats["inspected"] += 1

        if not args.verbose and idx % 500 == 0:
            print(f"  Progress: {idx}/{total} conversations...")

        try:
            updates = compute_updates(doc)

            if updates is None:
                stats["already_correct"] += 1
                if args.verbose:
                    print(f"  [SKIP] {conv_id}: already correct (source={doc.get('source')!r})")
                continue

            source_value = updates.get("source") or doc.get("source", "web")

            if args.dry_run:
                print(f"  [DRY-RUN] {conv_id}: would set {updates}")
            else:
                conversations_coll.update_one(
                    {"_id": conv_id},
                    {"$set": updates},
                )
                if args.verbose:
                    print(f"  [OK] {conv_id}: set {updates}")

            if source_value == "slack":
                stats["updated_slack"] += 1
            else:
                stats["updated_web"] += 1

        except Exception as e:
            print(f"  [ERROR] {conv_id}: {e}", file=sys.stderr)
            stats["errors"] += 1

    action = "Would update" if args.dry_run else "Updated"
    print("\nDone.")
    print(f"  Conversations inspected : {stats['inspected']}")
    print(f"  Already correct (skipped): {stats['already_correct']}")
    print(f"  {action} (web source)   : {stats['updated_web']}")
    print(f"  {action} (slack source) : {stats['updated_slack']}")
    if stats["errors"]:
        print(f"  Errors                  : {stats['errors']}")

    client.close()


if __name__ == "__main__":
    main()
