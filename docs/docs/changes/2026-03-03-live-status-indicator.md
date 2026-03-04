# Live Status, Input Required & Unviewed Message Indicators on Sidebar Conversations

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: March 3, 2026

## Overview

Added three-phase status indicators to sidebar chat history items:

1. **Live** (green antenna) — While a conversation is actively streaming, its icon changes to a green pulsing antenna with a ping dot.
2. **Input needed** (amber question) — When the agent requests user input (HITL), an amber pulsing question icon with "Input needed" text appears until the user responds or navigates to the conversation.
3. **Unviewed** (blue dot) — After streaming ends on a conversation the user isn't currently viewing, a blue dot and "New response" text appear until the user clicks into that conversation.

All indicators are always visible without hovering, even when the sidebar is collapsed.

## Problem Statement

The streaming state of a conversation was only visible inside the chat panel (A2AStreamPanel "Live" label) or as a subtle dot in the AppHeader. Users working with multiple conversations had no way to tell from the sidebar which chats were actively processing or had completed with new responses. This made it hard to track in-flight requests and discover completed responses, especially in collapsed sidebar mode where only icons are visible.

## Decision

Surface per-conversation streaming, input-required, and unviewed state directly in the sidebar with three distinct visual treatments:

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Green antenna (live) + amber question (input) + blue dot (unviewed)** | Clear three-phase lifecycle, always visible, leverages existing A2A `input-required` state | Adds new store state for both unviewed and input-required tracking | Selected |
| Single green dot for all states | Simpler | No distinction between states | Rejected |
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
│ inputRequiredConvs     │ ──────────────> │ isConversationInputReq() │
│   Set<id>             │                 │   → isInputRequired      │
├───────────────────────┤                 ├──────────────────────────┤
│ unviewedConversations  │ ──────────────> │ hasUnviewedMessages()    │
│   Set<id>             │                 │   → isUnviewed           │
└───────────┬───────────┘                 └──────────┬───────────────┘
            │                                        │
            │  addA2AEvent(UserInputMetaData)        │  Render priority:
            │  ──► add to inputRequired              │  1. isLive → green antenna
            │                                        │  2. isInputRequired → amber ?
            │  setConversationStreaming(id, state)    │  3. isUnviewed → blue dot
            │  ──► clear inputRequired               │  4. default → MessageSquare
            │                                        │
            │  setConversationStreaming(id, null)     │
            │  ──► if not active → add to unviewed   │
            │                                        │
            │  setActiveConversation(id)             │
            │  ──► remove from unviewed + inputReq   │
            └────────────────────────────────────────┘
```

### Visual States

| Element | Default | Live (streaming) | Input needed (HITL) | Unviewed (new response) |
|---|---|---|---|---|
| Icon | `MessageSquare` (gray) | `Radio` (emerald, pulse) | `MessageCircleQuestion` (amber, pulse) | `MessageSquare` (blue) |
| Dot | None | Green ping dot | Amber ping dot | Solid blue dot |
| Background | `bg-muted` | `bg-emerald-500/10` | `bg-amber-500/10` | `bg-blue-500/5` |
| Border | transparent | `border-emerald-500/30` | `border-amber-500/30` | `border-blue-500/25` |
| Date text | `formatDate(updatedAt)` | "Live" (emerald, bold) | "Input needed" (amber, bold) | "New response" (blue, bold) |

### State Lifecycle

1. User sends a message → conversation starts streaming → **Live** indicator appears
2. Agent requests user input (HITL) → **Input needed** indicator appears (amber)
3. User submits input → streaming resumes → back to **Live**, input-required flag cleared
4. Streaming completes while user is on a different conversation → **Unviewed** indicator appears
5. User clicks the conversation → unviewed and input-required flags are cleared → **Default** appearance

If streaming completes while the user is already viewing that conversation, no unviewed indicator is shown (they saw the response arrive in real time).

### Refresh Guard

Two-layer warning system for users who try to refresh or close while chats are streaming:

1. **In-app banner** (`LiveStreamBanner`): A thin emerald bar appears at the top of the app whenever any conversation is actively streaming, showing "N live chat(s) receiving response(s) — **refreshing will interrupt**". Proactive and always visible — users see it *before* they hit Cmd-R.

2. **Native browser dialog** (`beforeunload`): If the user does try to refresh/close, the browser's confirmation dialog appears. A descriptive `returnValue` message is set (e.g. "You have 1 live chat receiving a response. Refreshing will interrupt it."), though modern browsers replace it with generic text. Data is still saved regardless of the user's choice.

### Collapsed Sidebar

The icon container is rendered outside the `!collapsed` guard, so both the green antenna (live) and blue dot (unviewed) are visible in icon-only mode.

### Chat Tab Notification Badges

The "Chat" tab in the AppHeader nav pills shows a count badge to surface live/input/unviewed status across all pages (Skills, Knowledge Bases, Admin):

- **Green pulsing badge** (with ping animation): Count of conversations actively streaming
- **Amber pulsing badge**: Count of conversations waiting for user input (HITL)
- **Blue solid badge**: Count of unviewed responses
- **No badge**: Idle — nothing requires attention

Priority: green > amber > blue (only the highest-priority badge is shown).

## Components Changed

- `ui/src/components/layout/AppHeader.tsx`
  - Added `streamingConversations`, `inputRequiredConversations`, and `unviewedConversations` from the chat store
  - Chat tab link now has `relative` positioning and conditionally renders green (streaming), amber (input-required), or blue (unviewed) count badges

- `ui/src/store/chat-store.ts`
  - Added `unviewedConversations: Set<string>` and `inputRequiredConversations: Set<string>` to store state
  - Added `markConversationUnviewed`, `clearConversationUnviewed`, `hasUnviewedMessages` actions
  - Added `markConversationInputRequired`, `clearConversationInputRequired`, `isConversationInputRequired` actions
  - Updated `addA2AEvent` to mark conversation as input-required when `UserInputMetaData` artifact arrives
  - Updated `setConversationStreaming` to clear input-required when streaming starts (user submitted input) and mark unviewed when streaming ends on non-active conversation
  - Updated `setActiveConversation` to clear both unviewed and input-required flags on navigation
  - Updated `beforeunload` handler to trigger native browser confirmation when streaming is active

- `ui/src/components/layout/Sidebar.tsx`
  - Added `Radio` and `MessageCircleQuestion` imports from lucide-react
  - Added `isConversationStreaming`, `isConversationInputRequired`, and `hasUnviewedMessages` from the chat store
  - Added `isLive`, `isInputRequired`, and `isUnviewed` checks per conversation item
  - Four-state conditional rendering for icon, background, border, and date text
  - Amber ping dot and "Input needed" text for input-required conversations
  - Blue dot badge and "New response" text for unviewed conversations

- `ui/src/components/layout/LiveStreamBanner.tsx` (new)
  - Thin emerald banner at top of app when streaming conversations exist
  - Shows count and descriptive message ("N live chat(s) — refreshing will interrupt")
  - Auto-hides when no streams are active; accessible with `role="status"` and `aria-live="polite"`

- `ui/src/app/(app)/layout.tsx`
  - Added `LiveStreamBanner` between `AppHeader` and page content

## Related

- Spec: `.specify/specs/live-status-indicator.md`
- Branch: `prebuild/feat/live-status-indicator`
- PR: [#892](https://github.com/cnoe-io/ai-platform-engineering/pull/892)
