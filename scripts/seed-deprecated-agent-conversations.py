#!/usr/bin/env python3
# assisted-by claude code claude-sonnet-4-6
"""Seed MongoDB with supervisor-agent-era conversations for local testing.

Inserts two conversations that trigger the deprecated-agent UI paths:

  A) participants=[] — old supervisor-era conversations that pre-date the
     dynamic-agent participants model.  ChatContainer shows a deprecation
     notice with a CTA to start a new conversation.

  B) participants=[{type: agent, id: <non-existent-uuid>}] — a conversation
     that references an agent which has since been deleted.  ChatContainer
     renders the full read-only history with a banner.

Usage:
  python scripts/seed-deprecated-agent-conversations.py [--owner YOUR_EMAIL]

The script is idempotent: re-running it updates the existing documents rather
than inserting duplicates.  Pass --drop to wipe and re-insert from scratch.

Prerequisites:
  pip install pymongo
  docker-compose (mongodb service) running on host port 28017
"""

import argparse
import sys
import uuid
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Config — defaults match docker-compose/docker-compose.yaml
# ---------------------------------------------------------------------------
MONGO_URI = "mongodb://admin:changeme@localhost:27017/caipe?authSource=admin"
DB_NAME = "caipe"

# Fixed UUIDs so re-runs are idempotent
CONV_UNLINKED_ID = "00000000-dead-beef-cafe-000000000001"
CONV_DELETED_AGENT_ID = "00000000-dead-beef-cafe-000000000002"
FAKE_AGENT_ID = "ffffffff-dead-beef-cafe-000000000000"  # won't exist in dynamic_agents

NOW = datetime.now(timezone.utc)


def make_sharing():
    return {
        "is_public": False,
        "shared_with": [],
        "shared_with_teams": [],
        "share_link_enabled": False,
    }


def make_conversation(conv_id: str, title: str, participants: list, owner: str):
    return {
        "_id": conv_id,
        "title": title,
        "client_type": "webui",
        "owner_id": owner,
        "participants": participants,
        "created_at": NOW,
        "updated_at": NOW,
        "metadata": {
            "client_type": "webui",
            "total_messages": 0,
        },
        "sharing": make_sharing(),
        "tags": [],
        "is_archived": False,
        "is_pinned": False,
        "deleted_at": None,
    }


def make_message(conversation_id: str, owner: str, role: str, content: str, msg_id: str):
    return {
        "message_id": msg_id,
        "conversation_id": conversation_id,
        "owner_id": owner,
        "role": role,
        "content": content,
        "created_at": NOW,
        "updated_at": NOW,
        "stream_events": [],
        "metadata": {
            "turn_id": f"turn-{uuid.uuid4()}",
            "is_final": True,
            "source": "web",
        },
    }


def seed(owner: str, drop: bool = False):
    try:
        from pymongo import MongoClient
        from pymongo.errors import ConnectionFailure
    except ImportError:
        print("ERROR: pymongo not installed.  Run: pip install pymongo", file=sys.stderr)
        sys.exit(1)

    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except ConnectionFailure as exc:
        print(f"ERROR: Could not connect to MongoDB at {MONGO_URI}: {exc}", file=sys.stderr)
        print("Is docker-compose up with the mongodb service?", file=sys.stderr)
        sys.exit(1)

    db = client[DB_NAME]
    conversations = db["conversations"]
    messages = db["messages"]

    if drop:
        for cid in [CONV_UNLINKED_ID, CONV_DELETED_AGENT_ID]:
            conversations.delete_one({"_id": cid})
            messages.delete_many({"conversation_id": cid})
        print("Dropped existing seed documents.")

    # ── Scenario A: participants=[] ──────────────────────────────────────────
    conv_a = make_conversation(
        CONV_UNLINKED_ID,
        "Old Supervisor Chat (no agent participant)",
        [],  # <- triggers !selectedAgentId branch
        owner,
    )
    conversations.replace_one({"_id": CONV_UNLINKED_ID}, conv_a, upsert=True)
    print(f"Upserted conversation A  →  /chat/{CONV_UNLINKED_ID}")

    msg_a1 = make_message(CONV_UNLINKED_ID, owner, "user",
                          "What is the on-call rotation for platform SREs?",
                          f"msg-a-user-{CONV_UNLINKED_ID[:8]}")
    msg_a2 = make_message(CONV_UNLINKED_ID, owner, "assistant",
                          "The on-call rotation is managed in PagerDuty. "
                          "You can view it at https://your-org.pagerduty.com/schedules.",
                          f"msg-a-asst-{CONV_UNLINKED_ID[:8]}")
    msg_a3 = make_message(CONV_UNLINKED_ID, owner, "user",
                          "How do I escalate a P1 incident?",
                          f"msg-a-user2-{CONV_UNLINKED_ID[:8]}")
    msg_a4 = make_message(CONV_UNLINKED_ID, owner, "assistant",
                          "For a P1 incident: 1) Page the on-call SRE via PagerDuty, "
                          "2) Create an incident channel in Slack, "
                          "3) Notify the engineering lead.",
                          f"msg-a-asst2-{CONV_UNLINKED_ID[:8]}")

    for msg in [msg_a1, msg_a2, msg_a3, msg_a4]:
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_UNLINKED_ID},
            msg,
            upsert=True,
        )
    conversations.update_one(
        {"_id": CONV_UNLINKED_ID},
        {"$set": {"metadata.total_messages": 4}},
    )
    print(f"  Inserted 4 messages for conversation A")

    # ── Scenario B: deleted agent participant ────────────────────────────────
    conv_b = make_conversation(
        CONV_DELETED_AGENT_ID,
        "Old Supervisor Chat (deleted agent)",
        [{"type": "agent", "id": FAKE_AGENT_ID}],  # <- agent returns 404
        owner,
    )
    conversations.replace_one({"_id": CONV_DELETED_AGENT_ID}, conv_b, upsert=True)
    print(f"Upserted conversation B  →  /chat/{CONV_DELETED_AGENT_ID}")

    msg_b1 = make_message(CONV_DELETED_AGENT_ID, owner, "user",
                          "How do I rotate my LLM API keys?",
                          f"msg-b-user-{CONV_DELETED_AGENT_ID[:8]}")
    msg_b2 = make_message(CONV_DELETED_AGENT_ID, owner, "assistant",
                          "You can rotate your LLM keys via the Credentials page under Settings. "
                          "Click 'Rotate Key' next to the provider you want to update.",
                          f"msg-b-asst-{CONV_DELETED_AGENT_ID[:8]}")
    msg_b3 = make_message(CONV_DELETED_AGENT_ID, owner, "user",
                          "Will existing running jobs be affected?",
                          f"msg-b-user2-{CONV_DELETED_AGENT_ID[:8]}")
    msg_b4 = make_message(CONV_DELETED_AGENT_ID, owner, "assistant",
                          "Existing in-flight requests will complete using the old key. "
                          "New requests after rotation will use the new key automatically.",
                          f"msg-b-asst2-{CONV_DELETED_AGENT_ID[:8]}")

    for msg in [msg_b1, msg_b2, msg_b3, msg_b4]:
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_DELETED_AGENT_ID},
            msg,
            upsert=True,
        )
    conversations.update_one(
        {"_id": CONV_DELETED_AGENT_ID},
        {"$set": {"metadata.total_messages": 4}},
    )
    print(f"  Inserted 4 messages for conversation B")

    print()
    print("Done.  Log in to the UI as:", owner)
    print()
    print("  Scenario A (no agent participant — deprecation notice):")
    print(f"    http://localhost:3000/chat/{CONV_UNLINKED_ID}")
    print()
    print("  Scenario B (deleted agent — read-only history + banner):")
    print(f"    http://localhost:3000/chat/{CONV_DELETED_AGENT_ID}")
    print()
    print("NOTE: The conversations will appear in the sidebar only when you")
    print("are logged in as the owner email above.")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--owner", default="user@example.com",
                        help="Owner email (must match your Keycloak login). "
                             "Default: user@example.com")
    parser.add_argument("--drop", action="store_true",
                        help="Drop existing seed documents before reinserting.")
    args = parser.parse_args()

    seed(owner=args.owner, drop=args.drop)


if __name__ == "__main__":
    main()
