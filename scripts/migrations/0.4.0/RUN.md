# 0.4.0 Migration — Run Guide

One-time migration scripts to convert the legacy `messages`-based data model to the new `turns` + `stream_events` schema introduced in 0.4.0. Also normalises the `conversations` schema and merges `slack_sessions` metadata into `conversations.slack_meta`.

Run these **once** after deploying v0.4.0.

## What Changed in 0.4.0

- **`messages` collection** is replaced by **`turns`** (paired user/assistant messages) and **`stream_events`** (normalised A2A/SSE events per turn).
- **`conversations`** now requires a `source` field (`"web"` or `"slack"`) and consistent `slack_meta` sub-document for Slack conversations.
- **`slack_sessions`** metadata (`context_id`, `trace_id`) is embedded directly in `conversations.slack_meta` instead of a separate collection.
- The new `PersistedLangGraphAgent` writes AG-UI events to `stream_events` with `agui_type` in the data payload. These migrations handle **historical** data written before AG-UI persistence existed.

## Prerequisites

Python 3.10+ with pymongo:

```bash
pip install pymongo
```

## Environment Variables

```bash
export MONGODB_URI="mongodb://..."       # Full URI including credentials
export MONGODB_DATABASE="caipe"          # Default: caipe
```

## Execution Order

Run in this order — Step 1 creates the `turns`/`stream_events` collections that later steps reference.

### Step 1: Migrate messages to turns + stream_events

Reads from `messages`, pairs user/assistant messages into turns, normalises `a2a_events`/`sse_events` blobs into `stream_events`, and writes to `turns`.

```bash
# Preview (recommended first)
python scripts/migrations/0.4.0/migrate_messages_to_turns.py --dry-run

# Run for a single conversation to verify
python scripts/migrations/0.4.0/migrate_messages_to_turns.py --conversation-id <id> --verbose

# Full migration
python scripts/migrations/0.4.0/migrate_messages_to_turns.py --verbose
```

**Expected output:**

```
Connecting to MongoDB (database: caipe)...
Ensured indexes on turns and stream_events collections.
Processing N conversation(s)...

  [OK] conv-abc123: 6 msgs -> 3 turns, 12 events
  [OK] slack-1234.5678: 4 msgs -> 2 turns, 8 events

Done.
  Conversations processed : N
  Wrote turns             : X
  Wrote stream_events     : Y
```

**Verify:**

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
print("=== turns ===");
print("total: " + db.turns.countDocuments());
db.turns.aggregate([{$group: {_id: "$metadata.source", count: {$sum: 1}}}]).forEach(function(r) { print("  " + (r._id || "null") + ": " + r.count); });

print("\n=== stream_events ===");
print("total: " + db.stream_events.countDocuments());
db.stream_events.aggregate([{$group: {_id: "$type", count: {$sum: 1}}}]).forEach(function(r) { print("  " + r._id + ": " + r.count); });
db.stream_events.aggregate([{$group: {_id: "$source", count: {$sum: 1}}}]).forEach(function(r) { print("  source=" + r._id + ": " + r.count); });

print("\n=== sanity check ===");
var turnConvs = db.turns.distinct("conversation_id").length;
var msgConvs = db.messages.distinct("conversation_id").length;
print("conversations with turns: " + turnConvs + " / conversations with messages: " + msgConvs);
'
```

- `conversations with turns` should equal `conversations with messages`.

### Step 2: Normalise conversations schema

Ensures every conversation has a `source` field and consistent metadata. Sets `source: "slack"` for Slack conversations (detected by `_id` prefix or `slack_meta` presence) and `source: "web"` for everything else.

```bash
# Preview
python scripts/migrations/0.4.0/migrate_conversations_schema.py --dry-run

# Run
python scripts/migrations/0.4.0/migrate_conversations_schema.py --verbose
```

**Expected output:**

```
Connecting to MongoDB (database: caipe)...
Found N conversation(s) to inspect.

Done.
  Conversations inspected  : N
  Already correct (skipped): X
  Updated (web source)     : Y
  Updated (slack source)   : Z
```

**Verify:**

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
print("conversations by source:");
db.conversations.aggregate([{$group: {_id: "$source", count: {$sum: 1}}}]).forEach(function(r) { print("  " + (r._id || "MISSING") + ": " + r.count); });
print("without source: " + db.conversations.countDocuments({source: {$exists: false}}));
'
```

- `without source` should be 0.

### Step 3: Merge slack_sessions into conversations

Reads `slack_sessions` and merges `context_id`, `trace_id`, `channel_id`, and `is_skipped` into the matching `conversations.slack_meta` sub-document.

```bash
# Preview
python scripts/migrations/0.4.0/migrate_slack_sessions.py --dry-run

# Run
python scripts/migrations/0.4.0/migrate_slack_sessions.py --verbose

# Force overwrite existing values (if slack_sessions has newer data)
python scripts/migrations/0.4.0/migrate_slack_sessions.py --overwrite
```

**Expected output:**

```
Connecting to MongoDB (database: caipe)...
Found N slack_session document(s) to process.

Done.
  Sessions processed                  : N
  Merged                              : X
  Skipped (nothing to change)         : Y
  Skipped (no matching conversation)  : Z
```

**Verify:**

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
var slack = db.conversations.countDocuments({source: "slack"});
var withTrace = db.conversations.countDocuments({"slack_meta.trace_id": {$ne: null}});
var withContext = db.conversations.countDocuments({"slack_meta.context_id": {$ne: null}});
print("slack conversations: " + slack);
print("  with trace_id: " + withTrace);
print("  with context_id: " + withContext);
'
```

## Data Model

### turns

```json
{
  "_id": "uuid-derived-from-conv-id-and-sequence",
  "conversation_id": "conv-abc123",
  "sequence": 1,
  "user_message": {
    "message_id": "msg-001",
    "content": "How do I deploy to staging?",
    "sender_email": "user@company.com",
    "created_at": "2025-04-01T..."
  },
  "assistant_message": {
    "message_id": "msg-002",
    "content": "To deploy to staging, run...",
    "created_at": "2025-04-01T...",
    "completed_at": "2025-04-01T...",
    "status": "completed"
  },
  "metadata": {
    "source": "web",
    "agent_id": null,
    "trace_id": null
  },
  "created_at": "2025-04-01T...",
  "updated_at": "2025-04-01T..."
}
```

### stream_events

```json
{
  "_id": "uuid-derived-from-turn-and-sequence",
  "turn_id": "uuid-of-parent-turn",
  "conversation_id": "conv-abc123",
  "sequence": 0,
  "type": "tool_start",
  "timestamp": "2025-04-01T...",
  "namespace": ["github-agent"],
  "data": {
    "artifact_name": "tool_notification_start",
    "parts": [...]
  },
  "source": "a2a",
  "created_at": "2025-04-01T..."
}
```

Event types from migration: `tool_start`, `tool_end`, `plan_update`, `content`, `a2a_raw` (A2A source) and `tool_start`, `tool_end`, `content`, `plan_update`, `warning`, `input_required`, `metadata`, `sse_raw` (SSE source).

New AG-UI events written by `PersistedLangGraphAgent` use the same schema but include `data.agui_type` (e.g., `"TEXT_MESSAGE_CONTENT"`, `"TOOL_CALL_START"`, `"STATE_SNAPSHOT"`).

## Notes

- All scripts are **idempotent** — safe to re-run. They use `$setOnInsert` / upsert-by-`_id` patterns.
- All scripts are **non-destructive** — the original `messages` and `slack_sessions` collections are never modified or deleted.
- The `--dry-run` flag is supported on all scripts. Use it first.
- The `messages` collection can be dropped after verifying the migration, but there is no rush — it is simply not read by the v0.4.0 codebase.
- The `slack_sessions` collection can similarly be dropped after Step 3 verification.
- Migrated `stream_events` include a `source` field (`"a2a"` or `"sse"`) for provenance tracking. This field is not written by `TurnPersistence` for new events but is harmless.
