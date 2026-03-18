---
sidebar_position: 1
id: 087-live-status-indicator-architecture
sidebar_label: Architecture
---

# Architecture: Live Status, Input Required & Unviewed Message Indicators

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Zustand store with three state sets (chosen)** | Reactive, minimal re-renders, clear state transitions, zero backend changes | Client-side only, lost on refresh | Selected |
| Server-sent events for status | Real-time, persists across tabs | Requires backend changes, WebSocket infrastructure | Rejected (overkill) |
| Polling-based status | Simple server implementation | High latency, unnecessary network traffic | Rejected |
| localStorage-persisted state | Survives refresh | Stale state, sync issues across tabs | Deferred |

## Solution Architecture

### State Model (Zustand)

Three independent state collections in `chat-store.ts` track conversation status:

```
streamingConversations: Map<string, StreamState>
  └── Set when streaming starts, cleared when streaming ends
  └── StreamState contains the A2A event stream state

inputRequiredConversations: Set<string>
  └── Set when UserInputMetaData artifact arrives
  └── Cleared when streaming resumes or user navigates to conversation

unviewedConversations: Set<string>
  └── Set when streaming ends on a non-active conversation
  └── Cleared when user navigates to conversation
```

### State Lifecycle

```
User sends message
  └── setConversationStreaming(id, state) ──▶ LIVE
        └── clears inputRequired for this id

Agent requests input (UserInputMetaData artifact)
  └── addA2AEvent() detects artifact ──▶ INPUT REQUIRED
        └── only if conversation is streaming

Streaming ends
  └── setConversationStreaming(id, null)
        ├── Is active conversation? ──▶ clear (no indicator needed)
        └── Not active? ──▶ UNVIEWED (add to unviewedConversations)

User navigates to conversation
  └── setActiveConversation(id)
        ├── clearConversationUnviewed(id)
        └── clearConversationInputRequired(id)
```

### Visual Priority (highest to lowest)

| Priority | State | Icon | Dot | Background | Border | Date Text |
|---|---|---|---|---|---|---|
| 1 | Live (streaming) | Radio (green, animate-pulse) | Green ping | bg-emerald-500/10 | border-emerald-500/30 | "Live" (emerald) |
| 2 | Input required | MessageCircleQuestion (amber, animate-pulse) | Amber ping | bg-amber-500/10 | border-amber-500/30 | "Input needed" (amber) |
| 3 | Unviewed | MessageSquare (blue) | Blue solid | bg-blue-500/5 | border-blue-500/25 | "New response" (blue) |
| 4 | Default | MessageSquare | None | Default | Default | formatDate() |

### AppHeader Badge Priority

The Chat tab in the header shows notification badges following the same priority:

```
Green pulsing dot (any streaming) > Amber dot (any input required) > Blue dot (any unviewed)
```

Each badge includes a count of conversations in that state.

### Refresh Guard

- `beforeunload` event listener prevents accidental page refresh during streaming
- `LiveStreamBanner` component shows "N live chat(s) receiving response(s) -- refreshing will interrupt"
- Banner auto-hides when `streamingConversations.size === 0`
- Only triggers when conversations are actively streaming (non-annoying)

### Sidebar Rendering

The icon container (`shrink-0 w-8 h-8`) is rendered outside the `!collapsed` guard, ensuring indicators are visible in both expanded and collapsed sidebar states.

## Components Changed

| File | Description |
|---|---|
| `ui/src/store/chat-store.ts` | Added `unviewedConversations` Set, `inputRequiredConversations` Set; mark/clear/has actions for both; `beforeunload` handler; `addA2AEvent` marks input-required on `UserInputMetaData`; `setConversationStreaming(id, null)` marks unviewed |
| `ui/src/components/layout/Sidebar.tsx` | Conditional rendering of Radio/MessageCircleQuestion/MessageSquare icons; emerald/amber/blue styling; "Live"/"Input needed"/"New response" text; priority ordering; collapsed-mode support |
| `ui/src/components/layout/AppHeader.tsx` | Chat tab notification badges with green/amber/blue dots and counts; priority ordering |
| `ui/src/components/layout/LiveStreamBanner.tsx` | App-wide banner warning when live chats are active; auto-hides when idle |
| `ui/src/app/(app)/layout.tsx` | Mounts `LiveStreamBanner` between header and content |

## Related

- Spec: [spec.md](./spec.md)
