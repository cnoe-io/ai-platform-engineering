#!/usr/bin/env python3
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Backfill historical Slack interactions from the Slack API → MongoDB.

Crawls channel history for threads where the bot replied, then upserts
into the ``conversations`` collection (with embedded ``slack_meta``)
and the ``users`` collection.

Modes:
  --dump-json FILE    Fetch from Slack and save interaction data to a JSON file (no MongoDB needed)
  --from-json FILE    Load interactions from a previously dumped JSON file instead of hitting Slack
  (default)           Fetch from Slack and write directly to MongoDB

Required env vars (when fetching from Slack):
  SLACK_BOT_TOKEN       xoxb-...
  FORGE_BOT_USER_ID     Bot's Slack user ID (obtain via `slack auth.test`)
  BACKFILL_DAYS         Lookback period in days (default: 90)

Required env vars (when writing to MongoDB):
  MONGODB_URI           mongodb://...
  MONGODB_DATABASE      caipe (default)

Usage:
  # Fetch from Slack and save locally:
  python backfill_slack_interactions.py --dump-json data/slack_interactions.json

  # Load from local file and write to MongoDB:
  python backfill_slack_interactions.py --from-json data/slack_interactions.json

  # Dry run (from file or live):
  python backfill_slack_interactions.py --from-json data/slack_interactions.json --dry-run

  # Limit to specific channels:
  python backfill_slack_interactions.py --channels C123,C456 --dump-json data/slack_interactions.json
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError


def get_env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def get_required_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: {name} environment variable is required", file=sys.stderr)
        sys.exit(1)
    return val


def slack_call_with_retry(func, *args, max_retries=5, **kwargs):
    """Call a Slack API method with automatic rate-limit retry."""
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except SlackApiError as e:
            if e.response.get("error") == "ratelimited":
                retry_after = int(e.response.headers.get("Retry-After", 10))
                print(f"  Rate limited, waiting {retry_after}s (attempt {attempt + 1}/{max_retries})...")
                time.sleep(retry_after)
            else:
                raise
    raise RuntimeError(f"Rate limited {max_retries} times, giving up")


def fetch_channel_history(client: WebClient, channel_id: str, oldest: float):
    """Paginate through channel history."""
    cursor = None
    while True:
        try:
            resp = slack_call_with_retry(
                client.conversations_history,
                channel=channel_id, oldest=str(oldest), limit=200, cursor=cursor,
            )
            yield from resp.get("messages", [])
            cursor = resp.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break
            time.sleep(1.2)
        except SlackApiError as e:
            print(f"  Error fetching history for {channel_id}: {e}")
            break


def fetch_thread_replies(client: WebClient, channel_id: str, thread_ts: str):
    """Get all replies in a thread."""
    try:
        resp = slack_call_with_retry(
            client.conversations_replies,
            channel=channel_id, ts=thread_ts, limit=200,
        )
        return resp.get("messages", [])
    except (SlackApiError, RuntimeError) as e:
        print(f"  Error fetching replies for {thread_ts}: {e}")
        return []


def get_bot_channels(client: WebClient) -> list[dict]:
    """Get all channels the bot is a member of."""
    channels = []
    cursor = None
    while True:
        resp = slack_call_with_retry(
            client.conversations_list,
            types="public_channel,private_channel", limit=200, cursor=cursor,
        )
        for ch in resp.get("channels", []):
            if ch.get("is_member"):
                channels.append({"id": ch["id"], "name": ch.get("name", ch["id"])})
        cursor = resp.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(1.2)
    return channels


def resolve_user_profile(client: WebClient, user_id: str, cache: dict) -> dict:
    """Resolve a Slack user ID to {email, name}. Results are cached."""
    if user_id in cache:
        return cache[user_id]

    profile = {"email": None, "name": None, "slack_user_id": user_id}
    try:
        resp = slack_call_with_retry(client.users_info, user=user_id)
        user = resp.get("user", {})
        p = user.get("profile", {})
        profile["email"] = p.get("email")
        profile["name"] = p.get("real_name") or p.get("display_name") or user.get("real_name")
        time.sleep(0.6)
    except (SlackApiError, RuntimeError) as e:
        print(f"  Warning: could not resolve user {user_id}: {e}")

    cache[user_id] = profile
    return profile


def process_channel(client: WebClient, channel_id: str, channel_name: str,
                    bot_user_id: str, oldest: float, user_cache: dict) -> list[dict]:
    """Process a single channel and return interaction docs."""
    docs = []
    threads_checked = 0

    for msg in fetch_channel_history(client, channel_id, oldest):
        thread_ts = msg.get("ts")
        reply_count = msg.get("reply_count", 0)
        if reply_count == 0:
            continue

        threads_checked += 1
        replies = fetch_thread_replies(client, channel_id, thread_ts)
        time.sleep(0.6)

        bot_replied = any(r.get("user") == bot_user_id for r in replies)
        if not bot_replied:
            continue

        original_user = msg.get("user", "unknown")

        # Resolve user profile (email + name)
        profile = resolve_user_profile(client, original_user, user_cache)

        # Detect escalation: human reply that is NOT the bot and NOT the original asker
        escalated = any(
            r.get("user") != bot_user_id
            and r.get("user") != original_user
            and not r.get("bot_id")
            for r in replies
        )

        # Determine interaction type
        is_dm = channel_id.startswith("D")
        has_mention = any(f"<@{bot_user_id}>" in (r.get("text", "") or "") for r in replies)
        interaction_type = "dm" if is_dm else ("mention" if has_mention else "qanda")

        # Collect individual Forge-involved messages (bot + original asker only)
        # Each entry has a timestamp and role so we can write per-message docs
        forge_messages = []
        for r in replies:
            r_user = r.get("user")
            r_ts = r.get("ts")
            if r_user == bot_user_id:
                forge_messages.append({
                    "ts": r_ts,
                    "role": "assistant",
                })
            elif r_user == original_user:
                forge_messages.append({
                    "ts": r_ts,
                    "role": "user",
                })

        doc = {
            "thread_ts": thread_ts,
            "channel_id": channel_id,
            "channel_name": channel_name,
            "user_id": original_user,
            "user_email": profile["email"],
            "user_name": profile["name"],
            "timestamp": datetime.fromtimestamp(float(thread_ts), tz=timezone.utc).isoformat(),
            "interaction_type": interaction_type,
            "trace_id": None,
            "context_id": None,
            "escalated": escalated,
            "message_count": sum(1 for m in forge_messages if m["role"] == "assistant"),
            "forge_messages": forge_messages,
            "response_time_ms": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        docs.append(doc)

    if threads_checked > 0:
        print(f"  Checked {threads_checked} threads, {len(docs)} had bot replies")

    return docs


def main():
    parser = argparse.ArgumentParser(description="Backfill Slack interactions")
    parser.add_argument("--dry-run", action="store_true", help="Print summary without writing to MongoDB")
    parser.add_argument("--dump-json", metavar="FILE", help="Fetch from Slack and save to JSON file")
    parser.add_argument("--from-json", metavar="FILE", help="Load from a previously dumped JSON file")
    parser.add_argument("--channels", help="Comma-separated channel IDs to backfill (default: all bot channels)")
    args = parser.parse_args()

    # --- Mode: Load from JSON ---
    if args.from_json:
        print(f"Loading interactions from {args.from_json}...")
        with open(args.from_json) as f:
            all_docs = json.load(f)
        print(f"Loaded {len(all_docs)} interactions from file")
    else:
        # --- Fetch from Slack ---
        slack_token = get_required_env("SLACK_BOT_TOKEN")
        bot_user_id = get_required_env("FORGE_BOT_USER_ID")
        backfill_days = int(get_env("BACKFILL_DAYS", "90"))

        slack_client = WebClient(token=slack_token)
        oldest = (datetime.now(timezone.utc) - timedelta(days=backfill_days)).timestamp()

        # Determine channels to crawl
        if args.channels:
            channel_ids = [c.strip() for c in args.channels.split(",")]
            channels = []
            for cid in channel_ids:
                try:
                    info = slack_call_with_retry(slack_client.conversations_info, channel=cid)
                    channels.append({"id": cid, "name": info["channel"].get("name", cid)})
                except (SlackApiError, RuntimeError):
                    channels.append({"id": cid, "name": cid})
        else:
            print("Discovering channels the bot is a member of...")
            channels = get_bot_channels(slack_client)

        print(f"Backfilling {len(channels)} channels, lookback={backfill_days} days\n")

        user_cache = {}  # Slack user ID → {email, name, slack_user_id}
        all_docs = []
        for i, ch in enumerate(channels, 1):
            print(f"[{i}/{len(channels)}] #{ch['name']} ({ch['id']})...")
            docs = process_channel(slack_client, ch["id"], ch["name"], bot_user_id, oldest, user_cache)
            all_docs.extend(docs)

        print(f"\nResolved {len(user_cache)} unique user profiles")

        print(f"\nTotal interactions found: {len(all_docs)}")

    # --- Mode: Dump to JSON ---
    if args.dump_json:
        outpath = Path(args.dump_json)
        outpath.parent.mkdir(parents=True, exist_ok=True)
        with open(outpath, "w") as f:
            json.dump(all_docs, f, indent=2, default=str)
        print(f"Saved to {outpath}")
        return

    # --- Dry run: print summary ---
    if args.dry_run:
        from collections import Counter
        types = Counter(d["interaction_type"] for d in all_docs)
        escalated = sum(1 for d in all_docs if d["escalated"])
        resolved = len(all_docs) - escalated
        channels = Counter(d["channel_name"] or "unknown" for d in all_docs)

        print(f"\nInteraction types: {dict(types)}")
        print(f"Escalated: {escalated}, Resolved (no escalation): {resolved}")
        if all_docs:
            print(f"Resolution rate: {resolved / len(all_docs) * 100:.1f}%")
        print("\nTop channels:")
        for ch, count in channels.most_common(20):
            print(f"  #{ch}: {count}")
        return

    # --- Write to MongoDB ---
    # Populates 3 collections:
    #   conversations  — one doc per Slack thread (source: "slack") with embedded slack_meta
    #   users          — one doc per unique Slack user, powers user counts / DAU / MAU
    #   messages       — one lightweight doc per thread (role: "assistant", metadata.source: "slack")
    #                    so that the Message Activity chart picks up Slack data
    from pymongo import MongoClient

    mongodb_uri = get_required_env("MONGODB_URI")
    mongodb_db = get_env("MONGODB_DATABASE", "caipe")

    mongo_client = MongoClient(mongodb_uri)
    db = mongo_client[mongodb_db]
    conversations_coll = db["conversations"]
    users_coll = db["users"]
    messages_coll = db["messages"]

    conv_inserted = 0
    conv_skipped = 0
    msg_inserted = 0
    users_seen = set()

    for doc in all_docs:
        thread_ts = doc["thread_ts"]
        channel_id = doc["channel_id"]
        channel_name = doc.get("channel_name") or channel_id
        user_id = doc["user_id"]
        user_email = doc.get("user_email") or user_id  # fall back to Slack ID if no email
        user_name = doc.get("user_name") or user_id
        conv_id = f"slack-{thread_ts}"

        # Parse timestamp
        ts = doc["timestamp"]
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)

        # --- conversations collection (with embedded slack_meta) ---
        conv_doc = {
            "_id": conv_id,
            "title": f"#{channel_name} thread",
            "owner_id": user_email,
            "source": "slack",
            "channel_id": channel_id,
            "channel_name": channel_name,
            "message_count": doc.get("message_count", 0),
            "created_at": ts,
            "updated_at": ts,
            "sharing": {
                "is_public": False,
                "shared_with": [],
                "shared_with_teams": [],
                "share_link_enabled": False,
            },
            "tags": [],
            "is_archived": False,
            "slack_meta": {
                "thread_ts": thread_ts,
                "channel_id": channel_id,
                "channel_name": channel_name,
                "user_id": user_id,
                "user_email": user_email,
                "interaction_type": doc.get("interaction_type", "unknown"),
                "escalated": doc.get("escalated", False),
                "trace_id": doc.get("trace_id"),
                "context_id": doc.get("context_id"),
                "response_time_ms": doc.get("response_time_ms"),
            },
        }

        result = conversations_coll.update_one(
            {"_id": conv_id},
            {"$setOnInsert": conv_doc},
            upsert=True,
        )
        if result.upserted_id:
            conv_inserted += 1
        else:
            conv_skipped += 1

        # --- users collection ---
        # Use email as the canonical key. If the user later logs in via the UI,
        # the UI's auth flow will update their name (it won't be $setOnInsert).
        if user_email not in users_seen:
            users_seen.add(user_email)
            users_coll.update_one(
                {"email": user_email},
                {
                    "$setOnInsert": {
                        "email": user_email,
                        "name": user_name,
                        "role": "user",
                        "source": "slack",
                        "slack_user_id": user_id,
                        "created_at": ts,
                    },
                    "$max": {"last_login": ts},  # keep the latest timestamp
                },
                upsert=True,
            )

        # --- messages collection (one per Forge-involved message in thread) ---
        # Powers the Message Activity chart and Top Agents stats.
        # Each message gets its own doc with the Slack reply timestamp.
        for fm in doc.get("forge_messages", []):
            fm_ts = fm.get("ts", thread_ts)
            msg_created = datetime.fromtimestamp(float(fm_ts), tz=timezone.utc)
            message_id = f"slack-{thread_ts}-{fm_ts}"

            msg_doc = {
                "message_id": message_id,
                "conversation_id": conv_id,
                "owner_id": user_email,
                "role": fm.get("role", "assistant"),
                "content": None,
                "metadata": {
                    "source": "slack",
                },
                "created_at": msg_created,
                "updated_at": msg_created,
            }

            result = messages_coll.update_one(
                {"message_id": message_id},
                {"$setOnInsert": msg_doc},
                upsert=True,
            )
            if result.upserted_id:
                msg_inserted += 1

    print("Done.")
    print(f"  conversations: {conv_inserted} inserted, {conv_skipped} skipped")
    print(f"  messages: {msg_inserted} inserted")
    print(f"  users: {len(users_seen)} upserted")
    mongo_client.close()


if __name__ == "__main__":
    main()
