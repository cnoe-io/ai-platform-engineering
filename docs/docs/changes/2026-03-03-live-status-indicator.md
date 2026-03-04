# Live Status & Unviewed Message Indicators on Sidebar Conversations

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: March 3, 2026

## Overview

Added two-phase status indicators to sidebar chat history items:

1. **Live** (green antenna) — While a conversation is actively streaming, its icon changes to a green pulsing antenna with a ping dot.
2. **Unviewed** (blue dot) — After streaming ends on a conversation the user isn't currently viewing, a blue dot and "New response" text appear until the user clicks into that conversation.

Both indicators are always visible without hovering, even when the sidebar is collapsed.

## Problem Statement

The streaming state of a conversation was only visible inside the chat panel (A2AStreamPanel "Live" label) or as a subtle dot in the AppHeader. Users working with multiple conversations had no way to tell from the sidebar which chats were actively processing or had completed with new responses. This made it hard to track in-flight requests and discover completed responses, especially in collapsed sidebar mode where only icons are visible.

## Decision

Surface per-conversation streaming and unviewed state directly in the sidebar with two distinct visual treatments:

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Green antenna (live) + blue dot (unviewed)** | Clear two-phase lifecycle, always visible | Adds new store state for unviewed tracking | Selected |
| Single green dot for both states | Simpler | No distinction between "in progress" vs "done, go read it" | Rejected |
| Browser notifications for completed responses | Works even when tab is backgrounded | Intrusive, requires permission, OS-dependent | Rejected |
| Badge with unread count | Precise information | Over-engineered for this use case; count not meaningful | Rejected |

## Solution Architecture

### Data Flow

```
chat-store.ts                              Sidebar.tsx
┌───────────────────────┐    subscribe     ┌──────────────────────────┐
│ streamingConversations │ ──────────────> │ isConversationStreaming() │
│   Map<id, state>      │                 │   → isLive               │
├───────────────────────┤                 ├──────────────────────────┤
│ unviewedConversations  │ ──────────────> │ hasUnviewedMessages()    │
│   Set<id>             │                 │   → isUnviewed           │
└───────────┬───────────┘                 └──────────┬───────────────┘
            │                                        │
            │  setConversationStreaming(id, null)     │  Render priority:
            │  ──► if not active → add to unviewed   │  1. isLive → green antenna
            │                                        │  2. isUnviewed → blue dot
            │  setActiveConversation(id)             │  3. default → MessageSquare
            │  ──► remove from unviewed              │
            └────────────────────────────────────────┘
```

### Visual States

| Element | Default | Live (streaming) | Unviewed (new response) |
|---|---|---|---|
| Icon | `MessageSquare` (gray) | `Radio` (emerald, pulse) | `MessageSquare` (blue) |
| Dot | None | Green ping dot | Solid blue dot |
| Background | `bg-muted` | `bg-emerald-500/10` | `bg-blue-500/5` |
| Border | transparent | `border-emerald-500/30` | `border-blue-500/25` |
| Date text | `formatDate(updatedAt)` | "Live" (emerald, bold) | "New response" (blue, bold) |

### State Lifecycle

1. User sends a message → conversation starts streaming → **Live** indicator appears
2. Streaming completes while user is on a different conversation → **Unviewed** indicator appears
3. User clicks the conversation → unviewed flag is cleared → **Default** appearance

If streaming completes while the user is already viewing that conversation, no unviewed indicator is shown (they saw the response arrive in real time).

### Refresh Guard

If the user tries to refresh or close the tab while any conversation is actively streaming, the browser's native confirmation dialog appears ("Changes you made may not be saved"). This uses the standard `beforeunload` + `preventDefault` pattern — no custom modal, no annoyance when nothing is streaming. Data is still saved regardless of the user's choice.

### Collapsed Sidebar

The icon container is rendered outside the `!collapsed` guard, so both the green antenna (live) and blue dot (unviewed) are visible in icon-only mode.

## Components Changed

- `ui/src/store/chat-store.ts`
  - Added `unviewedConversations: Set<string>` to store state
  - Added `markConversationUnviewed`, `clearConversationUnviewed`, `hasUnviewedMessages` actions
  - Updated `setConversationStreaming` to mark non-active conversations as unviewed when streaming ends
  - Updated `setActiveConversation` to clear the unviewed flag on navigation
  - Updated `beforeunload` handler to trigger native browser confirmation when streaming is active

- `ui/src/components/layout/Sidebar.tsx`
  - Added `Radio` import from lucide-react
  - Added `isConversationStreaming` and `hasUnviewedMessages` from the chat store
  - Added `isLive` and `isUnviewed` checks per conversation item
  - Three-state conditional rendering for icon, background, border, and date text
  - Blue dot badge and "New response" text for unviewed conversations

## Related

- Spec: `.specify/specs/live-status-indicator.md`
- Branch: `prebuild/feat/live-status-indicator`
- PR: [#892](https://github.com/cnoe-io/ai-platform-engineering/pull/892)
