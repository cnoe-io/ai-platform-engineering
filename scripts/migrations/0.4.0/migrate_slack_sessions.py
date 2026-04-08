#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Phase 4c: Merge slack_sessions → conversations.slack_meta

The ``slack_sessions`` collection (written by MongoDBSessionStore) stores
per-thread A2A context IDs, Langfuse trace IDs, and channel metadata indexed
by ``thread_ts``.  The new schema embeds this data directly inside
``conversations.slack_meta``.

This script:
  1. Reads every document from ``slack_sessions``.
  2. Derives the matching conversation ID as ``"slack-{thread_ts}"``.
  3. Merges ``context_id`` and ``trace_id`` into ``conversations.slack_meta``
     (using ``$set`` with dot-notation so existing fields are not overwritten
     unless ``--overwrite`` is passed).
  4. Optionally also sets ``channel_id`` / ``is_skipped`` from the session doc
     if they are missing from the conversation.
  5. Reports sessions that have no matching conversation.

Design goals:
  - Idempotent: running multiple times is safe.
  - Non-destructive: does not delete ``slack_sessions`` documents.
  - --dry-run: prints what would be changed without writing.
  - --overwrite: re-sets values even if they already exist (useful if
    slack_sessions has newer data).

Required environment variables:
  MONGODB_URI          e.g. mongodb://localhost:27017
  MONGODB_DATABASE     e.g. caipe  (default: caipe)

Usage:
  python migrate_slack_sessions.py --dry-run
  python migrate_slack_sessions.py
  python migrate_slack_sessions.py --verbose
  python migrate_slack_sessions.py --overwrite  # force-update existing values
"""

import argparse
import os
import sys
from datetime import datetime, timezone

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


def build_merge_updates(session_doc: dict, conv_slack_meta: dict, overwrite: bool) -> dict:
    """
    Compute the $set payload to apply to the conversation document.

    Parameters
    ----------
    session_doc   : raw document from slack_sessions
    conv_slack_meta: current value of conversations.slack_meta (may be empty dict)
    overwrite     : if True, always write; if False, only write missing fields
    """
    updates: dict = {}

    fields_to_merge = {
        "context_id": session_doc.get("context_id"),
        "trace_id": session_doc.get("trace_id"),
        "channel_id": session_doc.get("channel_id"),
        "is_skipped": session_doc.get("is_skipped"),
    }

    for field, value in fields_to_merge.items():
        if value is None:
            # Nothing to merge
            continue
        existing = conv_slack_meta.get(field)
        if existing is None or overwrite:
            # Only set if field is missing (or overwrite mode)
            if existing != value:
                updates[f"slack_meta.{field}"] = value

    return updates


def main():
    parser = argparse.ArgumentParser(
        description="Phase 4c: Merge slack_sessions → conversations.slack_meta"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to MongoDB",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-set slack_meta fields even if they already have a value",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print details for every session processed",
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
    sessions_coll = db["slack_sessions"]
    conversations_coll = db["conversations"]

    if args.dry_run:
        print("DRY-RUN mode: no data will be written.\n")
    if args.overwrite:
        print("OVERWRITE mode: existing slack_meta fields will be updated.\n")

    total_sessions = sessions_coll.count_documents({})
    print(f"Found {total_sessions} slack_session document(s) to process.\n")

    stats = {
        "processed": 0,
        "merged": 0,
        "no_changes": 0,
        "no_conversation": 0,
        "errors": 0,
    }

    for idx, session in enumerate(sessions_coll.find({}), start=1):
        stats["processed"] += 1
        thread_ts = session.get("thread_ts")

        if not thread_ts:
            if args.verbose:
                print(f"  [SKIP] session {session.get('_id')}: no thread_ts")
            stats["errors"] += 1
            continue

        conversation_id = f"slack-{thread_ts}"

        # Look up the matching conversation
        conv = conversations_coll.find_one(
            {"_id": conversation_id},
            {"slack_meta": 1, "source": 1}
        )

        if conv is None:
            if args.verbose:
                print(f"  [MISSING] session thread_ts={thread_ts}: "
                      f"no conversation {conversation_id!r}")
            stats["no_conversation"] += 1
            continue

        current_slack_meta = conv.get("slack_meta") or {}

        updates = build_merge_updates(session, current_slack_meta, args.overwrite)

        if not updates:
            stats["no_changes"] += 1
            if args.verbose:
                print(f"  [SKIP] {conversation_id}: nothing to merge")
            continue

        # Add updated_at timestamp
        all_updates = {**updates, "updated_at": datetime.now(timezone.utc)}

        if args.dry_run:
            print(f"  [DRY-RUN] {conversation_id}: would set {updates}")
        else:
            try:
                conversations_coll.update_one(
                    {"_id": conversation_id},
                    {"$set": all_updates},
                )
                if args.verbose:
                    print(f"  [OK] {conversation_id}: merged {list(updates.keys())}")
            except PyMongoError as e:
                print(f"  [ERROR] {conversation_id}: {e}", file=sys.stderr)
                stats["errors"] += 1
                continue

        stats["merged"] += 1

        if not args.verbose and idx % 200 == 0:
            print(f"  Progress: {idx}/{total_sessions} sessions...")

    action = "Would merge" if args.dry_run else "Merged"
    print("\nDone.")
    print(f"  Sessions processed                 : {stats['processed']}")
    print(f"  {action}                            : {stats['merged']}")
    print(f"  Skipped (nothing to change)        : {stats['no_changes']}")
    print(f"  Skipped (no matching conversation) : {stats['no_conversation']}")
    if stats["errors"]:
        print(f"  Errors                             : {stats['errors']}")

    client.close()


if __name__ == "__main__":
    main()
