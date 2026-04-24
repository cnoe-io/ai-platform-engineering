#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Step 4: Migrate slack_meta to flat metadata keys.

Flattens the legacy ``slack_meta`` sub-document into ``metadata.*`` keys so
that both the admin dashboard and the Slack bot can query a single consistent
schema.

For each Slack conversation (detected by ``source: "slack"``, ``slack_meta``
presence, or ``_id`` prefix ``"slack-"``):

  1. Copies ``slack_meta.*`` keys into ``metadata.*`` **without overwriting**
     existing values (the bot may have already PATCHed newer data).
  2. Sets ``client_type: "slack"`` if missing.
  3. Preserves ``slack_meta`` as-is (non-destructive).

Design goals:
  - Idempotent: safe to run multiple times.
  - Non-destructive: ``slack_meta`` is never removed.
  - ``--dry-run``: prints what would change without touching MongoDB.

Required environment variables:
  MONGODB_URI          e.g. mongodb://localhost:27017
  MONGODB_DATABASE     e.g. caipe  (default: caipe)

Usage:
  python migrate_slack_meta_to_metadata.py --dry-run
  python migrate_slack_meta_to_metadata.py
  python migrate_slack_meta_to_metadata.py --verbose
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


# Keys from slack_meta that should be promoted to metadata.*
PROMOTABLE_KEYS = (
  "thread_ts",
  "channel_id",
  "channel_name",
  "user_id",
  "user_email",
  "interaction_type",
  "escalated",
  "response_time_ms",
  "trace_id",
  "context_id",
)


def get_required_env(name: str) -> str:
  """Read a required environment variable or exit."""
  val = os.environ.get(name)
  if not val:
    print(f"ERROR: {name} environment variable is required", file=sys.stderr)
    sys.exit(1)
  return val


def is_slack_conversation(doc: dict) -> bool:
  """Determine whether a conversation belongs to the Slack source."""
  if doc.get("source") == "slack":
    return True
  if doc.get("client_type") == "slack":
    return True
  if str(doc.get("_id", "")).startswith("slack-"):
    return True
  if doc.get("slack_meta"):
    return True
  return False


def compute_updates(doc: dict) -> dict | None:
  """Return a ``$set`` payload for fields that need updating, or None."""
  if not is_slack_conversation(doc):
    return None

  slack_meta = doc.get("slack_meta")
  if not isinstance(slack_meta, dict) or not slack_meta:
    # No slack_meta to migrate — only ensure client_type
    if doc.get("client_type") != "slack":
      return {"client_type": "slack", "updated_at": datetime.now(timezone.utc)}
    return None

  updates: dict = {}
  metadata = doc.get("metadata") or {}

  # Promote slack_meta keys into metadata.* without overwriting
  for key in PROMOTABLE_KEYS:
    if key in slack_meta and key not in metadata:
      updates[f"metadata.{key}"] = slack_meta[key]

  # Also promote any unexpected keys (future-proof)
  for key, val in slack_meta.items():
    if key not in PROMOTABLE_KEYS and key not in metadata:
      updates[f"metadata.{key}"] = val

  # Ensure client_type
  if doc.get("client_type") != "slack":
    updates["client_type"] = "slack"

  if not updates:
    return None

  updates["updated_at"] = datetime.now(timezone.utc)
  return updates


def main() -> None:
  parser = argparse.ArgumentParser(description="Step 4: Migrate slack_meta to flat metadata keys")
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
    client: MongoClient = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
  except PyMongoError as e:
    print(f"ERROR: Cannot connect to MongoDB: {e}", file=sys.stderr)
    sys.exit(1)

  db = client[mongodb_db]
  conversations = db["conversations"]

  if args.dry_run:
    print("DRY-RUN mode: no data will be written.\n")

  # Only inspect conversations that might be Slack
  query = {
    "$or": [
      {"source": "slack"},
      {"client_type": "slack"},
      {"slack_meta": {"$exists": True}},
    ]
  }
  total = conversations.count_documents(query)
  print(f"Found {total} Slack conversation(s) to inspect.\n")

  stats = {
    "inspected": 0,
    "already_correct": 0,
    "updated": 0,
    "errors": 0,
  }

  cursor = conversations.find(query)

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
          print(f"  [SKIP] {conv_id}: already migrated")
        continue

      if args.dry_run:
        print(f"  [DRY-RUN] {conv_id}: would set {updates}")
      else:
        conversations.update_one({"_id": conv_id}, {"$set": updates})
        if args.verbose:
          print(f"  [OK] {conv_id}: set {updates}")

      stats["updated"] += 1

    except Exception as e:
      print(f"  [ERROR] {conv_id}: {e}", file=sys.stderr)
      stats["errors"] += 1

  action = "Would update" if args.dry_run else "Updated"
  print("\nDone.")
  print(f"  Conversations inspected  : {stats['inspected']}")
  print(f"  Already correct (skipped): {stats['already_correct']}")
  print(f"  {action}                 : {stats['updated']}")
  if stats["errors"]:
    print(f"  Errors                   : {stats['errors']}")

  client.close()


if __name__ == "__main__":
  main()
