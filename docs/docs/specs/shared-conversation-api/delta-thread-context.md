# Delta Thread Context for Slack Bot

## Status: Planned

## Problem

When a user posts a follow-up message in a Slack thread, the bot calls
`build_thread_context` which fetches **all** messages from the Slack API and
embeds them as a text blob in the user message. This blob then gets stored in
LangGraph checkpoints. On every subsequent turn the entire prior history is
re-embedded, causing **quadratic growth** in checkpoint storage.

Additionally, the Slack API is called on every follow-up just to reconstruct
history that the agent already has in its checkpoint chain.

### What checkpoints already store

LangGraph checkpoints contain all messages exchanged **with the agent** — but
they do *not* contain messages posted by other humans or bots in the Slack
thread that the agent wasn't part of. `build_thread_context` fills that gap by
providing the full thread context.

## Solution: Option C — Delta Context as Message Preamble

Instead of always sending the full thread history, only send **new messages
since the bot's last interaction** on follow-up turns.

### How it works

**First turn** (`created=true` from idempotency API):
- Full `build_thread_context` output — same as today.
- Needed because the agent has no checkpoint history yet and there may be
  pre-bot messages in the thread.

**Follow-up turns** (`created=false`):
- Fetch only messages **newer than `last_processed_ts`** from Slack.
- Filter out the bot's own messages (agent has those in checkpoints).
- Cap to last N messages (configurable via env var, default 50).
- If no new non-bot messages exist, send just the raw user message.
- Otherwise prepend a preamble:

```
Since your last message, the following conversation took place (last N messages):
---
Alice: I think we should try the new approach
Bob: Agreed, let me check the docs
---
Current question: @CAIPE can you help with this?
```

**After each turn**: Store `last_processed_ts` in conversation metadata via a
new PATCH endpoint so we know where to resume from next time.

### Root messages vs thread replies

| Scenario | Thread context? | Delta applies? |
|---|---|---|
| @mention in channel (no thread) | No — message is the thread root | No — first turn, no prior context |
| @mention inside a thread (first bot interaction) | Yes — full `build_thread_context` | No — `created=true`, full context |
| @mention inside a thread (follow-up) | Yes — delta only | **Yes** — `created=false` |
| Q&A (auto-respond, root only) | No — only fires for `not is_thread` | No |
| DM (no thread) | No | No |
| DM inside thread (follow-up) | Yes — delta only | **Yes** — `created=false` |

## Implementation Plan

### 1. `slack_context.py` — New function + env var

- Extract constant:
  ```python
  SLACK_THREAD_HISTORY_LIMIT = int(os.environ.get(
      "SLACK_INTEGRATION_THREAD_HISTORY_LIMIT", "50"
  ))
  ```
- Update `fetch_thread_history`: use the constant instead of hardcoded `100`.
  Add optional `oldest` param to support delta fetches via Slack's
  `conversations_replies(oldest=...)`.
- New function:
  ```python
  def build_delta_context(
      app,
      channel_id: str,
      thread_ts: str,
      current_message: str,
      bot_user_id: str,
      since_ts: str,
      cap: int = SLACK_THREAD_HISTORY_LIMIT,
  ) -> str:
  ```
  - Calls `fetch_thread_history` with `oldest=since_ts`
  - Filters out our bot's messages (agent has those in checkpoints)
  - If no new non-bot messages → returns just `current_message`
  - Otherwise returns preamble + messages + current question
  - Caps to last `cap` messages

### 2. `sse_client.py` — Return metadata + new PATCH method

- **`create_conversation` return**: include `metadata` from the conversation
  doc so callers can read `last_processed_ts`:
  ```python
  return {
      "conversation_id": conversation_id,
      "created": created,
      "metadata": conversation.get("metadata", {}),
  }
  ```
- **New method**:
  ```python
  def update_conversation_metadata(
      self, conversation_id: str, metadata: Dict[str, Any]
  ) -> None:
  ```
  Calls `PATCH /api/chat/conversations/{id}/metadata` with Bearer auth.
  Merges provided keys into existing metadata.

### 3. `app.py` — Reorder handler flow

Current flow in `handle_mention` and `handle_dm_message`:
```
1. build_thread_context (always full)
2. create_conversation
3. _call_ai(message_text=context_message)
```

New flow:
```
1. create_conversation → {created, metadata}
2. Build context:
   - if created=true AND event has thread_ts:
       context_message = build_thread_context(full, capped)
   - elif created=false AND event has thread_ts:
       since_ts = metadata.get("last_processed_ts", thread_ts)
       context_message = build_delta_context(since_ts)
   - else:
       context_message = message_text  (root message, no thread)
3. _call_ai(message_text=context_message)
4. update_conversation_metadata(conversation_id, {
       "last_processed_ts": event["ts"]
   })
```

Q&A handler — no change (only fires for root messages, never has thread
context).

### 4. New API endpoint: `PATCH /api/chat/conversations/[id]/metadata`

**Route**: `ui/src/app/api/chat/conversations/[id]/metadata/route.ts`

```
PATCH /api/chat/conversations/{id}/metadata
Authorization: Bearer <jwt>
Body: { "metadata": { "last_processed_ts": "1776686296.562309" } }
```

- Uses `getAuthFromBearerOrSession` (supports Bearer JWT from Slack bot)
- Shallow-merges `body.metadata` into existing `conversation.metadata`
- **Only allows updating `metadata`** — nothing else
- Returns updated conversation

### 5. Types: `ui/src/types/mongodb.ts`

Add:
```typescript
export interface PatchConversationMetadataRequest {
  metadata: Record<string, unknown>;
}
```

## What doesn't change

- `build_thread_context` — stays as-is, used for first-turn full context
- Q&A handler — only processes root messages, no thread context
- Button handlers (`_resolve_conversation_id`) — don't touch message context
- `ai.py` alert handler — alert threads are bot-initiated, different pattern
- `client_context` dict — unchanged, still carries channel info

## Edge cases

- **`last_processed_ts` missing on existing conversations** — falls back to
  `thread_ts` (thread root), giving full history. Same behavior as today.
  Graceful degradation.
- **Bot restart / metadata lost** — metadata is in MongoDB, survives restarts.
- **Multiple users posting between bot turns** — all captured in the delta.
  Only the bot's own messages are filtered out.
- **Other bots posting in thread** — kept in delta (only our bot filtered).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SLACK_INTEGRATION_THREAD_HISTORY_LIMIT` | `50` | Max messages to include in thread context (both full and delta modes) |
