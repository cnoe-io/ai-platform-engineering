---
slug: release-0.5.52-patch
title: "Release 0.5.52 — Deep Links, Session Refresh Fix, Slack Escalation Fix, Configurable Metrics Port"
date: 2026-07-15
authors: [sriaradhyula, cisco-erilutz, subbaksh]
tags: [release]
---

> Released: 2026-07-15
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.5.52`
> Previous release: 0.5.51

## Highlights

0.5.52 adds deep links across the Agents surface so resource editors can be shared and bookmarked, fixes a session expiry bug that was logging users out despite a successful silent refresh, corrects Slack escalation and message-delete failures caused by a missing `agent_id`, and makes the dynamic-agents Prometheus metrics port configurable.

<!-- truncate -->

## New Features

### Deep links for agent resources

The Agents surface now uses URL-backed deep links throughout, so resource editors can be shared, refreshed, and navigated with browser history.

- Agents: `?tab=agents&agent=<id>&step=<step>`
- MCP Servers: `?tab=mcp-servers&server=<id>`
- LLM Models: `?tab=llm-models&model=<id>`

([#2212](https://github.com/cnoe-io/ai-platform-engineering/pull/2212))

### Dynamic-agents Prometheus metrics port configurable

A new `METRICS_PORT` env var (and corresponding Helm value) lets the dynamic-agents Prometheus `/metrics` endpoint be served on a dedicated port, separate from the main API port. This unblocks running the main API port under strict mTLS while keeping the metrics endpoint accessible to Prometheus without mTLS.

([#2135](https://github.com/cnoe-io/ai-platform-engineering/pull/2135))

## Bug Fixes

### Session silent-refresh failures no longer force logout

`TokenExpiryGuard` was treating any transient silent-refresh failure as a terminal logout trigger. Users in `caipe-preview` environments were being kicked out and forced to sign in again despite the UI banner claiming a refresh was in progress. The guard now tolerates transient failures and only forces logout after exhausting retries.

([#2220](https://github.com/cnoe-io/ai-platform-engineering/pull/2220))

### Slack escalation and message-delete no longer fail with HTTP 400

`_resolve_conversation_id` performs a get-or-create lookup keyed by `thread_ts`, but the conversation-creation API validates that `agent_id` is non-empty before reaching the lookup. The Slack bot's "Get help" escalation and message-delete handlers were calling `_resolve_conversation_id` without passing `agent_id`, causing an HTTP 400 on every call. The `agent_id` is now passed correctly in both handlers.

([#2222](https://github.com/cnoe-io/ai-platform-engineering/pull/2222))

### Admin view-as access preview repaired

The Admin **View as** flow now provides an accurate read-only access preview. The previous implementation was showing an opaque user ID or blank page. The fix uses access simulation (not session impersonation) — the signed-in admin session is unchanged, no target-user token is minted, and no session state is altered.

([#2206](https://github.com/cnoe-io/ai-platform-engineering/pull/2206))

### Unlinked access modal scrolls instead of overflowing

The "Unlinked Access" modal (Platform Settings tab) now wraps its scopes list and add-scope form in a scrollable container (`max-h-[65vh] overflow-y-auto`) instead of growing the dialog past the viewport.

([#2224](https://github.com/cnoe-io/ai-platform-engineering/pull/2224))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.5.51.

---

## Upgrade Guide: 0.5.51 → 0.5.52

No values changes required unless you want to configure a dedicated metrics port:

```yaml
dynamic-agents:
  env:
    METRICS_PORT: "9090"
```

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.5.52 \
  -f your-values.yaml
```
