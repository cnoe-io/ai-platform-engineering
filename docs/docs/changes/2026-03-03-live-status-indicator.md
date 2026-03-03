# Live Status Indicator on Sidebar Conversations

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: March 3, 2026

## Overview

Added a live status indicator to the sidebar chat history items. When a conversation is actively streaming (receiving an AI response), its icon changes from a chat bubble to a green pulsing antenna, always visible without hovering — even when the sidebar is collapsed.

## Problem Statement

The streaming state of a conversation was only visible inside the chat panel (A2AStreamPanel "Live" label) or as a subtle dot in the AppHeader. Users working with multiple conversations had no way to tell from the sidebar which chats were actively processing. This made it hard to track in-flight requests, especially in collapsed sidebar mode where only icons are visible.

## Decision

Surface the existing per-conversation streaming state directly in the sidebar using a visually distinct green antenna icon with a pulse animation.

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Green antenna icon with pulse (chosen)** | Highly visible, uses existing state, no new deps | Adds visual complexity | Selected |
| Small colored dot on existing icon | Minimal change | Easy to miss, especially when collapsed | Rejected |
| Text-only "Live" badge | Simple | Not visible when sidebar is collapsed | Rejected |
| Spinner/loading icon | Familiar pattern | Doesn't convey "broadcasting/live" semantics | Rejected |

## Solution Architecture

### Data Flow

The feature hooks into the existing `streamingConversations` Map in the Zustand chat store (`chat-store.ts`). No new state was introduced.

```
chat-store.ts                          Sidebar.tsx
┌──────────────────────┐    subscribe   ┌──────────────────────┐
│ streamingConversations│ ────────────> │ isConversationStreaming│
│   Map<id, state>     │               │   (conv.id) → bool   │
└──────────────────────┘               └──────────┬───────────┘
                                                  │
                                          ┌───────▼───────┐
                                          │ isLive = true  │
                                          │ → Radio icon   │
                                          │ → pulse + ping │
                                          │ → emerald bg   │
                                          │ → "Live" text  │
                                          └───────────────┘
```

### Visual Changes

When `isLive` is true for a conversation item:

| Element | Default | Live |
|---|---|---|
| Icon | `MessageSquare` (gray/primary) | `Radio` (emerald, animate-pulse) |
| Dot | None | Green ping dot (top-right corner) |
| Background | `bg-muted` / `bg-primary/10` | `bg-emerald-500/10` |
| Border | transparent / `border-primary/30` | `border-emerald-500/30` |
| Date text | `formatDate(updatedAt)` | "Live" (emerald-600/400, bold) |

All changes are purely conditional — when streaming ends, the item reverts to its existing appearance with no additional cleanup.

### Collapsed Sidebar

The icon container is rendered outside the `!collapsed` guard in the sidebar layout, so the green antenna and ping dot are visible in icon-only mode.

## Components Changed

- `ui/src/components/layout/Sidebar.tsx`
  - Added `Radio` import from lucide-react
  - Added `isConversationStreaming` from the chat store
  - Added `isLive` check per conversation map iteration
  - Conditional icon rendering (Radio vs MessageSquare)
  - Conditional styling (emerald background/border/text)
  - Ping dot overlay with `animate-ping` animation

## Related

- Spec: `.specify/specs/live-status-indicator.md`
- Branch: `prebuild/feat/live-status-indicator`
