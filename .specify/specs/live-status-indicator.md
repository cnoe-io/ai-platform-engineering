# Spec: Live Status Indicator

## Overview

Show a green pulsing antenna icon on sidebar chat items that are actively streaming, always visible without hovering, so users can immediately see which conversations are live.

## Motivation

When a user sends a message and a response is being streamed, there is no visual indication on the chat history sidebar that a conversation is actively processing. The streaming state is only visible inside the chat panel itself (via the A2AStreamPanel "Live" label) or in the AppHeader status dot. If a user navigates away from the active conversation or has multiple conversations in flight, there is no way to tell from the sidebar which ones are still live.

This feature provides at-a-glance awareness of streaming activity directly in the chat list — critical for multi-conversation workflows and collapsed sidebar states.

## Scope

### In Scope
- Show a green `Radio` (antenna) icon replacing the `MessageSquare` icon when a conversation is streaming
- Add a pulsing green dot overlay for additional visibility
- Replace the date text with "Live" in green when streaming
- Apply an emerald-tinted background/border to live conversation items
- Ensure the indicator is visible in both expanded and collapsed sidebar states
- Automatically revert to normal appearance when streaming ends

### Out of Scope
- Sound or browser notification for live status
- Showing streaming progress percentage
- Per-agent streaming indicators
- Persisting live status across page reloads (streaming state is ephemeral)

## Design

### Architecture

The feature leverages the existing `streamingConversations` Map in the Zustand chat store. No new state management is needed — the `isConversationStreaming(conversationId)` method already exists and is used elsewhere (ChatPanel, ContextPanel, AppHeader).

In the Sidebar component, each conversation item now checks its streaming status and conditionally renders:

```
If isConversationStreaming(conv.id):
  Icon:       Radio (lucide-react) with animate-pulse + ping dot
  Background: bg-emerald-500/10, border-emerald-500/30
  Date text:  "Live" in emerald-600/400
Else:
  Icon:       MessageSquare (existing behavior)
  Background: Existing active/shared/default styling
  Date text:  formatDate(conv.updatedAt) (existing behavior)
```

The icon container (`shrink-0 w-8 h-8`) is rendered outside the `!collapsed` guard, so the green antenna is always visible even when the sidebar is collapsed.

### Components Affected
- [ ] Agents (`ai_platform_engineering/agents/`)
- [ ] Multi-Agents (`ai_platform_engineering/multi_agents/`)
- [ ] MCP Servers
- [ ] Knowledge Bases (`ai_platform_engineering/knowledge_bases/`)
- [x] UI (`ui/`)
  - `ui/src/components/layout/Sidebar.tsx`
- [x] Documentation (`docs/`)
  - ADR: `docs/docs/changes/2026-03-03-live-status-indicator.md`
- [ ] Helm Charts (`charts/`)

## Acceptance Criteria

- [x] Streaming conversations show a green pulsing antenna icon instead of the chat bubble
- [x] A green ping dot appears at the top-right corner of the icon for additional visibility
- [x] The conversation item has an emerald-tinted background and border when streaming
- [x] The date text is replaced with "Live" in green when streaming
- [x] The indicator is visible when the sidebar is collapsed (icon-only mode)
- [x] The indicator disappears automatically when streaming completes or is cancelled
- [x] Non-streaming conversations retain their existing appearance (active, shared, default)
- [x] No regressions in existing sidebar behavior (navigation, archive, share)
- [x] TypeScript compiles clean

## Implementation Plan

### Phase 1: Core Feature ✅
- [x] Import `Radio` icon from lucide-react
- [x] Import `isConversationStreaming` from the chat store
- [x] Add `isLive` check per conversation item
- [x] Conditionally render `Radio` with pulse animation vs `MessageSquare`
- [x] Add ping dot overlay on live items
- [x] Apply emerald background/border styling for live items
- [x] Replace date text with "Live" label when streaming

### Phase 2: Documentation ✅
- [x] Create spec in `.specify/specs/`
- [x] Create ADR in `docs/docs/changes/`

## Testing Strategy

- Unit tests: N/A (pure UI rendering based on existing store state)
- Integration tests: N/A (no new state logic)
- Manual verification:
  - Start a new conversation and send a message
  - Verify the sidebar item shows the green antenna icon with pulse while streaming
  - Verify "Live" text replaces the date
  - Verify the indicator disappears when the response completes
  - Collapse the sidebar and verify the green icon is still visible
  - Open a second conversation and verify both show correctly (only the streaming one is green)

## Rollout Plan

1. Deploy via PR merge to main (branch: `prebuild/feat/live-status-indicator`)
2. No backend changes required — purely frontend
3. No configuration or feature flags needed

## Related

- ADR: `docs/docs/changes/2026-03-03-live-status-indicator.md`
- Branch: `prebuild/feat/live-status-indicator`
