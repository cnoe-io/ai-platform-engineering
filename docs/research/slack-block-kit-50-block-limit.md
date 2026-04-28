# Slack Block Kit 50-Block Limit Analysis

**Date:** 2026-04-16
**Branch:** `release/0.4.0`
**Status:** Open — no fix implemented yet

## Background

A colleague reported that the previous (A2A/supervisor) iteration of the Slack bot hit Slack's `invalid_blocks` error when posting a PagerDuty investigation report (~10,444 chars). The root cause was exceeding Slack's hard limit of 50 blocks per message in `chat_postMessage`.

This analysis checks whether the current AG-UI iteration has the same flaw.

## Finding: The flaw still exists

`_post_final_response()` in `ai.py:~540` builds one Slack block per 3000-char text chunk with **no cap on the total block count**. There are no safeguards anywhere in the codebase.

## All Slack API calls that send blocks

| File | Line (approx) | API Call | Risk |
|------|--------------|----------|------|
| `ai.py` | ~365-371 | `chat_postMessage` | Low — 1 block ("working..." message) |
| `ai.py` | ~484-495 | `chat_update` / `chat_postMessage` | Medium — HITL form blocks |
| `ai.py` | ~523 | `chat_stopStream` | Low — error blocks (2-4 blocks) |
| `ai.py` | ~561-571 | `chat_stopStream` | Low — final stream stop (2 blocks) |
| `ai.py` | ~594-606 | `chat_postMessage` via `_post_final_response` | **High** — unbounded text blocks |
| `ai.py` | ~616-630 | `chat_update` / `chat_postMessage` | Low — error blocks (4 blocks) |
| `ai.py` | ~671 | `chat_postMessage` | Low — invoke error path |

## Missing safeguards

| Safeguard | Present? |
|-----------|----------|
| Block count check before API call | No |
| Truncation to 50 blocks | No |
| Splitting across multiple messages | No |
| Text length limit per block | Yes — `split_text_into_blocks()` enforces 3000 chars/block |
| Warning/logging when approaching limit | No |

## Risk areas

### HIGH: `_post_final_response()` (ai.py ~540-555)

```python
def _post_final_response(...):
    text_chunks = slack_formatter.split_text_into_blocks(final_text)
    final_blocks = []
    for chunk in text_chunks:
        final_blocks.append({"type": "markdown", "text": chunk})
    final_blocks.extend(_build_stream_final_blocks(...))  # +2 blocks
    slack_client.chat_postMessage(..., blocks=final_blocks, ...)
```

Trigger conditions: bot user (B-prefix user_id), stream-not-started fallback, or `stopStream` failure fallback.

A 150K+ char response would produce >50 blocks. While uncommon, long multi-step investigation reports with code/logs can reach this territory.

### MEDIUM: `format_hitl_form_blocks()`

Generates 6 + N blocks where N = number of form fields. A misconfigured agent sending 45+ fields would exceed the limit.

### LOW: Streaming path

`appendStream` uses streaming chunks (markdown_text, task_update, plan_update), not Block Kit blocks. The 50-block limit does not apply to appendStream calls. The `stopStream` call only passes 2 footer blocks. Safe.

## Recommended fix

Add a block limit enforcer in `slack_formatter.py`:

1. After building `final_blocks` in `_post_final_response()`, check `len(final_blocks) > 50`.
2. If exceeded, either:
   - **Truncate** to 48 text blocks + 2 footer blocks (with a "truncated" indicator), or
   - **Split** across multiple `chat_postMessage` calls (only the last gets footer blocks).
3. Add a reusable `enforce_block_limit(blocks, max=50)` utility for all API call sites.
4. Cap HITL form fields to ~40 to stay under limit.
