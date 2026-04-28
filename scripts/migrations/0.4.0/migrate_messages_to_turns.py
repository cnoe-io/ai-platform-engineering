#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Phase 4a: Migrate messages → turns + stream_events

Reads messages from the existing ``messages`` collection, pairs user/assistant
messages into turns, normalises the ``a2a_events`` / ``sse_events`` blobs into
the new ``stream_events`` collection, and writes turn documents to the new
``turns`` collection.

Design goals:
  - Idempotent: running multiple times is safe.  Turns and events are upserted
    keyed by deterministic IDs derived from the source message IDs.
  - Non-destructive: the original ``messages`` collection is never modified.
  - --dry-run: prints what would be written without touching MongoDB.

A2A event type mapping:
  artifact.name="tool_notification_start"  -> type: "tool_start"
  artifact.name="tool_notification_end"    -> type: "tool_end"
  artifact.name="execution_plan_update"    -> type: "plan_update"
  artifact.name="streaming_result"         -> type: "content"
  artifact.name="final_result"             -> type: "content"
  (anything else)                          -> type: "a2a_raw"

SSE event type mapping:
  event.type is used directly (already normalised on the frontend).

Required environment variables:
  MONGODB_URI          e.g. mongodb://localhost:27017
  MONGODB_DATABASE     e.g. caipe  (default: caipe)

Usage:
  # Preview changes without writing:
  python migrate_messages_to_turns.py --dry-run

  # Migrate all conversations:
  python migrate_messages_to_turns.py

  # Migrate a single conversation for testing:
  python migrate_messages_to_turns.py --conversation-id <id>

  # Verbose logging (print every turn processed):
  python migrate_messages_to_turns.py --verbose
"""

import argparse
import ast
import hashlib
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

try:
    from pymongo import MongoClient, UpdateOne
    from pymongo.errors import PyMongoError
except ImportError:
    print("ERROR: pymongo is required.  Install it with: pip install pymongo", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# A2A event type mappings
# ---------------------------------------------------------------------------

# Top-level event types that are already normalized (pass through as-is).
A2A_EVENT_TYPE_PASSTHROUGH: set[str] = {
    "tool_start",
    "tool_end",
    "execution_plan",
    "task",
    "status",
}

# artifact.name → stream_events type (used when top-level type is "artifact").
A2A_ARTIFACT_TYPE_MAP: dict[str, str] = {
    "tool_notification_start": "tool_start",
    "tool_notification_end": "tool_end",
    "execution_plan_update": "plan_update",
    "execution_plan_status_update": "plan_update",
    "streaming_result": "content",
    "partial_result": "content",
    "final_result": "content",
}

SSE_TYPE_PASSTHROUGH = {
    "tool_start",
    "tool_end",
    "content",
    "plan_update",
    "warning",
    "input_required",
    "metadata",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_required_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: {name} environment variable is required", file=sys.stderr)
        sys.exit(1)
    return val


def stable_turn_id(conversation_id: str, sequence: int) -> str:
    """Deterministic turn ID so re-runs upsert the same document."""
    raw = f"turn:{conversation_id}:{sequence}"
    return str(uuid.UUID(hashlib.sha256(raw.encode()).hexdigest()[:32]))


def stable_event_id(turn_id: str, source: str, sequence: int) -> str:
    """Deterministic event ID."""
    raw = f"event:{turn_id}:{source}:{sequence}"
    return str(uuid.UUID(hashlib.sha256(raw.encode()).hexdigest()[:32]))


def parse_dt(value) -> Optional[datetime]:
    """Coerce a value to a timezone-aware datetime or return None."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            pass
    return None


def _parse_artifact(raw_artifact) -> dict:
    """
    Coerce the artifact field to a plain dict.

    Legacy documents stored the artifact as a Python repr string
    (e.g. "{'name': 'streaming_result', 'parts': [...]}") rather than
    a proper sub-document.  ast.literal_eval handles that case safely.
    """
    if isinstance(raw_artifact, dict):
        return raw_artifact
    if isinstance(raw_artifact, str):
        try:
            parsed = ast.literal_eval(raw_artifact)
            if isinstance(parsed, dict):
                return parsed
        except (ValueError, SyntaxError):
            pass
    return {}


def normalize_a2a_event(raw: dict, turn_id: str, conversation_id: str, seq: int) -> dict:
    """Convert a serialised A2A event to a stream_events document."""
    raw_type = raw.get("type", "")
    artifact = _parse_artifact(raw.get("artifact"))
    artifact_name = artifact.get("name", "")

    # Top-level type is already normalised for tool_start/tool_end/etc.
    # For "artifact" events derive the type from artifact.name instead.
    if raw_type in A2A_EVENT_TYPE_PASSTHROUGH:
        event_type = raw_type
    else:
        event_type = A2A_ARTIFACT_TYPE_MAP.get(artifact_name, "a2a_raw")

    # Namespace: prefer sourceAgent field
    namespace: list[str] = []
    if raw.get("sourceAgent"):
        namespace = [raw["sourceAgent"]]

    # Data payload
    data: dict = {}
    if artifact:
        data["artifact_name"] = artifact.get("name", "")
        parts = artifact.get("parts") or []
        if parts:
            data["parts"] = parts
        if artifact.get("metadata"):
            data["artifact_metadata"] = artifact["metadata"]
    if raw.get("displayContent"):
        data["display_content"] = raw["displayContent"]
    if raw.get("status"):
        data["status"] = raw["status"]

    ts = parse_dt(raw.get("timestamp")) or datetime.now(timezone.utc)

    event_id = stable_event_id(turn_id, f"a2a:{raw_type}:{artifact_name}", seq)

    return {
        "_id": event_id,
        "turn_id": turn_id,
        "conversation_id": conversation_id,
        "sequence": seq,
        "type": event_type,
        "timestamp": ts,
        "namespace": namespace,
        "data": data,
        "source": "a2a",
        "created_at": datetime.now(timezone.utc),
    }


def normalize_sse_event(raw: dict, turn_id: str, conversation_id: str, seq: int) -> dict:
    """Convert a serialised SSE event to a stream_events document."""
    event_type = raw.get("type", "sse_raw")
    if event_type not in SSE_TYPE_PASSTHROUGH:
        event_type = "sse_raw"

    namespace: list[str] = []
    raw_ns = raw.get("namespace")
    if isinstance(raw_ns, list):
        namespace = raw_ns
    elif isinstance(raw_ns, str):
        namespace = [raw_ns]

    # Data payload
    data: dict = {}
    for field in ("toolData", "warningData", "inputRequiredData", "content",
                  "displayContent", "metadata", "contextId"):
        if raw.get(field) is not None:
            data[field] = raw[field]

    ts = parse_dt(raw.get("timestamp")) or datetime.now(timezone.utc)

    event_id = stable_event_id(turn_id, f"sse:{event_type}", seq)

    return {
        "_id": event_id,
        "turn_id": turn_id,
        "conversation_id": conversation_id,
        "sequence": seq,
        "type": event_type,
        "timestamp": ts,
        "namespace": namespace,
        "data": data,
        "source": "sse",
        "created_at": datetime.now(timezone.utc),
    }


def build_turn_document(
    conversation_id: str,
    sequence: int,
    user_msg: dict,
    assistant_msg: Optional[dict],
    source: str,
    agent_id: Optional[str],
) -> dict:
    """Assemble a turns collection document from raw message docs."""
    turn_id = stable_turn_id(conversation_id, sequence)
    now = datetime.now(timezone.utc)

    user_created = parse_dt(user_msg.get("created_at")) or now
    user_doc = {
        "message_id": user_msg.get("message_id") or str(user_msg.get("_id", "")),
        "content": user_msg.get("content") or "",
        "sender_email": user_msg.get("sender_email") or user_msg.get("owner_id"),
        "created_at": user_created,
    }

    assistant_doc: Optional[dict] = None
    if assistant_msg:
        asst_created = parse_dt(assistant_msg.get("created_at")) or now
        metadata = assistant_msg.get("metadata") or {}
        is_final = metadata.get("is_final", True)
        is_interrupted = metadata.get("is_interrupted", False)
        turn_status_raw = metadata.get("turn_status")

        if turn_status_raw:
            status = turn_status_raw
        elif is_interrupted:
            status = "interrupted"
        elif is_final:
            status = "completed"
        else:
            status = "streaming"

        assistant_doc = {
            "message_id": assistant_msg.get("message_id") or str(assistant_msg.get("_id", "")),
            "content": assistant_msg.get("content") or "",
            "created_at": asst_created,
            "completed_at": asst_created if is_final else None,
            "status": status,
        }

    return {
        "_id": turn_id,
        "conversation_id": conversation_id,
        "sequence": sequence,
        "user_message": user_doc,
        "assistant_message": assistant_doc,
        "metadata": {
            "source": source,
            "agent_id": agent_id,
            "trace_id": None,  # populated by migrate_slack_sessions.py for Slack convs
        },
        "created_at": user_created,
        "updated_at": now,
    }


# ---------------------------------------------------------------------------
# Core migration logic
# ---------------------------------------------------------------------------

def pair_messages(messages: list[dict]) -> list[tuple[dict, Optional[dict]]]:
    """
    Pair messages into (user, assistant) turns.

    Rules:
    - Each user message starts a new turn.
    - The immediately following assistant message completes it.
    - Consecutive user messages each get their own turn (no assistant response).
    - An orphan assistant message at the start is attached as a turn with a
      synthetic empty user message so data is not lost.
    - Consecutive assistant messages after one user message: only the first is
      paired; subsequent ones become orphan turns.
    """
    pairs: list[tuple[dict, Optional[dict]]] = []
    i = 0

    # Handle leading assistant messages (orphans — no prior user message)
    while i < len(messages) and messages[i].get("role") == "assistant":
        pairs.append(({"role": "user", "content": "", "orphan": True,
                       "created_at": messages[i].get("created_at"),
                       "message_id": f"synthetic-{i}"},
                      messages[i]))
        i += 1

    while i < len(messages):
        msg = messages[i]
        if msg.get("role") == "user":
            # Look ahead for the next assistant message
            assistant: Optional[dict] = None
            if i + 1 < len(messages) and messages[i + 1].get("role") == "assistant":
                assistant = messages[i + 1]
                pairs.append((msg, assistant))
                i += 2
            else:
                # No assistant response (orphan user message)
                pairs.append((msg, None))
                i += 1
        elif msg.get("role") == "assistant":
            # Consecutive assistant messages — treat as orphan turn
            pairs.append(({"role": "user", "content": "", "orphan": True,
                           "created_at": msg.get("created_at"),
                           "message_id": f"synthetic-{i}"},
                          msg))
            i += 1
        else:
            # Unknown role — skip
            i += 1

    return pairs


def migrate_conversation(
    db,
    conversation_id: str,
    conversation_doc: dict,
    dry_run: bool,
    verbose: bool,
    stats: dict,
) -> None:
    """Migrate all messages for one conversation."""
    messages_coll = db["messages"]
    turns_coll = db["turns"]
    events_coll = db["stream_events"]

    # Load messages sorted by created_at
    raw_msgs = list(
        messages_coll.find({"conversation_id": conversation_id}).sort("created_at", 1)
    )

    if not raw_msgs:
        if verbose:
            print(f"  [SKIP] {conversation_id}: no messages")
        return

    source = conversation_doc.get("source", "web")
    agent_id = conversation_doc.get("agent_id")

    # Pair messages into turns
    pairs = pair_messages(raw_msgs)

    turns_to_upsert: list[dict] = []
    events_to_upsert: list[dict] = []

    for seq, (user_msg, assistant_msg) in enumerate(pairs, start=1):
        turn_doc = build_turn_document(
            conversation_id=conversation_id,
            sequence=seq,
            user_msg=user_msg,
            assistant_msg=assistant_msg,
            source=source,
            agent_id=agent_id,
        )
        turn_id = turn_doc["_id"]
        turns_to_upsert.append(turn_doc)

        # Normalise events from assistant message (if any)
        if assistant_msg:
            is_dynamic_agent = bool(agent_id)
            event_seq = 0

            if is_dynamic_agent:
                # SSE events
                for raw_event in (assistant_msg.get("sse_events") or []):
                    event_doc = normalize_sse_event(raw_event, turn_id, conversation_id, event_seq)
                    events_to_upsert.append(event_doc)
                    event_seq += 1
            else:
                # A2A events
                for raw_event in (assistant_msg.get("a2a_events") or []):
                    event_doc = normalize_a2a_event(raw_event, turn_id, conversation_id, event_seq)
                    events_to_upsert.append(event_doc)
                    event_seq += 1

    if dry_run:
        orphan_turns = sum(
            1 for (u, _) in pairs if u.get("orphan")
        )
        incomplete_turns = sum(1 for (_, a) in pairs if a is None)
        print(
            f"  [DRY-RUN] {conversation_id}: {len(raw_msgs)} msgs → "
            f"{len(turns_to_upsert)} turns ({orphan_turns} orphan, "
            f"{incomplete_turns} without assistant), "
            f"{len(events_to_upsert)} stream_events"
        )
        stats["conversations"] += 1
        stats["turns"] += len(turns_to_upsert)
        stats["events"] += len(events_to_upsert)
        return

    # Write turns (upsert by _id so re-runs are safe)
    if turns_to_upsert:
        ops = [
            UpdateOne(
                {"_id": t["_id"]},
                {"$setOnInsert": {k: v for k, v in t.items() if k != "updated_at"},
                 "$set": {"updated_at": t["updated_at"]}},
                upsert=True,
            )
            for t in turns_to_upsert
        ]
        try:
            result = turns_coll.bulk_write(ops, ordered=False)
            stats["turns"] += result.upserted_count + result.modified_count
        except PyMongoError as e:
            print(f"  [ERROR] turns bulk_write for {conversation_id}: {e}", file=sys.stderr)

    # Write stream_events (upsert by _id)
    if events_to_upsert:
        ops = [
            UpdateOne(
                {"_id": e["_id"]},
                {"$setOnInsert": e},
                upsert=True,
            )
            for e in events_to_upsert
        ]
        try:
            result = events_coll.bulk_write(ops, ordered=False)
            stats["events"] += result.upserted_count + result.modified_count
        except PyMongoError as e:
            print(f"  [ERROR] stream_events bulk_write for {conversation_id}: {e}", file=sys.stderr)

    stats["conversations"] += 1

    if verbose:
        print(
            f"  [OK] {conversation_id}: {len(raw_msgs)} msgs → "
            f"{len(turns_to_upsert)} turns, {len(events_to_upsert)} events"
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Phase 4a: Migrate messages → turns + stream_events"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to MongoDB",
    )
    parser.add_argument(
        "--conversation-id",
        metavar="ID",
        help="Only migrate this single conversation (useful for testing)",
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

    if args.dry_run:
        print("DRY-RUN mode: no data will be written.\n")

    # Ensure indexes on new collections (safe to call even if they exist)
    if not args.dry_run:
        try:
            db["turns"].create_index("conversation_id")
            db["turns"].create_index([("conversation_id", 1), ("sequence", 1)], unique=True,
                                     name="turns_conv_seq_unique")
            db["stream_events"].create_index("turn_id")
            db["stream_events"].create_index("conversation_id")
            db["stream_events"].create_index([("turn_id", 1), ("sequence", 1)])
            print("Ensured indexes on turns and stream_events collections.")
        except PyMongoError as e:
            print(f"Warning: could not ensure indexes: {e}", file=sys.stderr)

    # Determine which conversations to process
    conversations_coll = db["conversations"]
    if args.conversation_id:
        conv_docs = list(conversations_coll.find({"_id": args.conversation_id}))
        if not conv_docs:
            print(f"ERROR: Conversation {args.conversation_id!r} not found.", file=sys.stderr)
            sys.exit(1)
    else:
        conv_docs = list(conversations_coll.find({}))

    total = len(conv_docs)
    print(f"Processing {total} conversation(s)...\n")

    stats: dict = {"conversations": 0, "turns": 0, "events": 0, "errors": 0}

    for idx, conv_doc in enumerate(conv_docs, start=1):
        conv_id = conv_doc.get("_id") or conv_doc.get("id")
        if not conv_id:
            stats["errors"] += 1
            continue

        if not args.verbose and idx % 100 == 0:
            print(f"  Progress: {idx}/{total} conversations...")

        try:
            migrate_conversation(
                db=db,
                conversation_id=str(conv_id),
                conversation_doc=conv_doc,
                dry_run=args.dry_run,
                verbose=args.verbose,
                stats=stats,
            )
        except Exception as e:
            print(f"  [ERROR] conversation {conv_id}: {e}", file=sys.stderr)
            stats["errors"] += 1

    action = "Would write" if args.dry_run else "Wrote"
    print("\nDone.")
    print(f"  Conversations processed : {stats['conversations']}")
    print(f"  {action} turns           : {stats['turns']}")
    print(f"  {action} stream_events   : {stats['events']}")
    if stats["errors"]:
        print(f"  Errors                  : {stats['errors']}")

    client.close()


if __name__ == "__main__":
    main()
