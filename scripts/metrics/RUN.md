# Backfill Scripts — Run Guide

One-time backfill scripts to populate MongoDB with historical data from Langfuse and Slack. Run these **once** after deploying the enhanced statistics feature. After backfill, the Slack bot writes directly to MongoDB going forward.

## Prerequisites

Python 3.10+ with these packages:

```bash
pip install pymongo requests slack-sdk
```

`mongosh` is required for the web feedback migration script.

## Environment Variables

### MongoDB (required by all scripts)

```bash
export MONGODB_URI="mongodb://..."       # Full URI including credentials
export MONGODB_DATABASE="caipe"          # Default: caipe
```

### Langfuse (required by `backfill_feedback_from_langfuse.py`)

```bash
export LANGFUSE_HOST="https://langfuse.sdp.dev.svc.splunk8s.io"
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
```

### Slack (required by `backfill_slack_interactions.py`)

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export FORGE_BOT_USER_ID="U02BWJLGEJ2"  # Bot user ID (hermes2)
export BACKFILL_DAYS="90"                # Lookback period, default: 90
```

## Execution Order

Run in this order — each step depends on the previous:

### Step 1: Migrate web feedback + tag source

Copies `messages.feedback` embedded data into the standalone `feedback` collection, removes the embedded field from `messages`, and tags existing web conversations/users with `source: "web"`.

```bash
mongosh "$MONGODB_URI" --eval "var dbName='$MONGODB_DATABASE'" scripts/metrics/backfill_web_feedback.js
```

**Expected output:**

```
Backfilling web feedback from caipe.messages -> caipe.feedback ...
Done. N web feedback documents now in feedback collection.
Removed embedded feedback from N messages.
Tagged N existing conversations as source: "web".
Tagged N existing users as source: "web".
```

**Verify:**

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
print("feedback (web): " + db.feedback.countDocuments({source: "web"}));
print("messages with embedded feedback: " + db.messages.countDocuments({"feedback": {$exists: true}}));
print("conversations without source: " + db.conversations.countDocuments({source: {$exists: false}}));
'
```

- `feedback (web)` should match the number of messages that had feedback
- `messages with embedded feedback` should be **0**
- `conversations without source` should be **0**

### Step 2: Backfill Slack feedback from Langfuse

Fetches all "all slack channels" scores from Langfuse and writes them to the `feedback` collection with `source: "slack"`.

```bash
# Option A: Fetch from Langfuse and write directly to MongoDB
python scripts/metrics/backfill_feedback_from_langfuse.py

# Option B: Fetch and save locally first (recommended for first run)
python scripts/metrics/backfill_feedback_from_langfuse.py --dump-json /tmp/langfuse_scores.json
python scripts/metrics/backfill_feedback_from_langfuse.py --from-json /tmp/langfuse_scores.json

# Dry run (preview without writing)
python scripts/metrics/backfill_feedback_from_langfuse.py --from-json /tmp/langfuse_scores.json --dry-run
```

**Expected output:**

```
Loading scores from /tmp/langfuse_scores.json...
Loaded N scores from file
Converted N feedback docs (0 skipped, no trace_id)
Done. Inserted: N, Skipped (already exists): M
```

**Verify:**

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
print("feedback total: " + db.feedback.countDocuments());
print("  web: " + db.feedback.countDocuments({source: "web"}));
print("  slack: " + db.feedback.countDocuments({source: "slack"}));
db.feedback.aggregate([{$match: {source: "slack"}}, {$group: {_id: "$rating", count: {$sum: 1}}}]).forEach(function(r) { print("  " + r._id + ": " + r.count); });
'
```

### Step 3: Backfill Slack interactions, conversations, and users

Crawls Slack channel history for threads where the bot replied. For each thread, resolves user profiles (email + name via `users.info` API) and writes to three collections:

- **`conversations`**: One doc per thread (`_id: "slack-{thread_ts}"`, `source: "slack"`, `message_count` = Forge-involved messages only)
- **`users`**: One doc per unique user (keyed by email, `source: "slack"`)
- **`slack_interactions`**: Sidecar with escalation, interaction_type, channel metadata

```bash
# All channels the bot is a member of (full backfill)
python scripts/metrics/backfill_slack_interactions.py

# Specific channels only
python scripts/metrics/backfill_slack_interactions.py --channels C010J2FQFLK,C07MU724GN9

# Save to JSON first (recommended — avoids re-crawling Slack on retry)
python scripts/metrics/backfill_slack_interactions.py --dump-json /tmp/slack_interactions.json
python scripts/metrics/backfill_slack_interactions.py --from-json /tmp/slack_interactions.json

# Dry run
python scripts/metrics/backfill_slack_interactions.py --from-json /tmp/slack_interactions.json --dry-run
```

**Expected output:**

```
Backfilling N channels, lookback=90 days

[1/N] #channel-name (CXXXXXXXX)...
  Checked M threads, K had bot replies

Resolved P unique user profiles

Total interactions found: K
Done.
  conversations: K inserted, 0 skipped
  users: P upserted
  slack_interactions: K inserted, 0 skipped
```

**Verify:**

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
print("=== conversations ===");
print("total: " + db.conversations.countDocuments());
db.conversations.aggregate([{$group: {_id: "$source", count: {$sum: 1}}}]).forEach(function(r) { print("  " + r._id + ": " + r.count); });
var mc = db.conversations.aggregate([{$match: {source: "slack"}}, {$group: {_id: null, total: {$sum: "$message_count"}}}]).toArray()[0];
if (mc) print("  slack message_count total: " + mc.total);

print("\n=== users ===");
print("total: " + db.users.countDocuments());
db.users.aggregate([{$group: {_id: "$source", count: {$sum: 1}}}]).forEach(function(r) { print("  " + (r._id || "null") + ": " + r.count); });

print("\n=== slack_interactions ===");
print("total: " + db.slack_interactions.countDocuments());
print("escalated: " + db.slack_interactions.countDocuments({escalated: true}));
print("resolved: " + db.slack_interactions.countDocuments({escalated: false}));
'
```

## Notes

- All scripts are **idempotent** — safe to re-run. They use `$setOnInsert` / `whenMatched: "keepExisting"` / dedup checks.
- The Slack backfill has built-in rate limiting (`slack_call_with_retry` with exponential backoff). It will pause automatically if rate-limited.
- User profile resolution calls `users.info` per unique user with a 0.6s delay and in-memory caching. For ~100 users this takes ~1 minute.
- The `--dump-json` / `--from-json` workflow is recommended for the Slack backfill — it avoids re-crawling the Slack API if you need to re-run the MongoDB write phase.
- `message_count` on Slack conversations counts only Forge-involved messages (bot replies + original asker messages), not all thread participants.
- Escalation = a human other than the original asker replied in the thread after Forge responded.
