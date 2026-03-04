---
title: "2026-03-03: UI Home Page — Dashboard Landing Experience"
---

# UI Home Page — Dashboard Landing Experience

**Status**: 🟡 Proposal
**Category**: Features & Enhancements
**Date**: March 3, 2026

## Problem Statement

The CAIPE UI currently redirects `/` to `/skills` via a client-side `router.replace()` in `app/page.tsx`. This creates several issues:

1. **No orientation for new users**: Landing directly on the skills gallery gives no context about the platform's other capabilities (Chat, Knowledge Bases, Insights). Users don't know what they can do.
2. **No shared content discovery**: Conversations shared with a user (via individuals or teams) are invisible unless the user already has the direct URL. The `getSharedConversations()` API exists and is wired up in `api-client.ts` but is unused in the UI.
3. **No "pick up where you left off"**: Users must navigate to Chat and use the sidebar to find their most recent conversation. There is no quick-access surface for resuming work.
4. **Underutilized sharing infrastructure**: The `is_public` field exists on the `Conversation` type (`sharing.is_public`) in both `types/a2a.ts` and `types/mongodb.ts`, but the `ShareDialog` component does not surface a toggle for it. There is no way for users to share conversations with everyone.
5. **App feels like a "skills catalog"**: Emphasizing skills as the landing page positions the product as a workflow catalog rather than an AI platform with multiple capabilities.

## Decision

Replace the `/` redirect with a proper dashboard-style home page that serves as the primary entry point. The page will surface recent chats, shared conversations (by individual, team, and everyone), platform capability cards, and a personal insights widget.

### Why a Home Page at `/`

The home page should live at `/` (not `/dashboard` or `/home`) because:

- `/` is the natural entry point; the logo in AppHeader already links to `/`
- It eliminates the redirect hop (better performance, no flash)
- It follows standard web application conventions

## Alternatives Considered

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Dashboard home page at `/` (chosen)** | Natural entry point, eliminates redirect, surfaces shared content and capabilities | New page to build and maintain | **Selected** |
| Enhanced `/skills` page with dashboard widgets | No new route, incremental change | Conflates skill catalog with dashboard; skills page already has its own UX (gallery + runner); becomes cluttered | Rejected |
| Separate `/dashboard` route, keep `/` redirect | Doesn't change existing flow | Extra redirect still exists; two "home" concepts confuse users; logo click goes to redirect, not dashboard | Rejected |
| Keep current redirect, add shared chats to sidebar | Minimal change | Sidebar is per-chat-page only; doesn't help new users orient; doesn't surface capabilities | Rejected |

## Solution Architecture

### Page Structure

```
┌──────────────────────────────────────────────────┐
│  AppHeader  [Home] [Skills] [Chat] [KB] [Admin]  │
├──────────────────────────────────────────────────┤
│  Welcome Banner                                  │
│  "Welcome back, {name}"                          │
├──────────────────────────────────────────────────┤
│  Capability Cards (Chat | Skills | KB)           │
├──────────────────────────────────────────────────┤
│  Recent Chats (grid)      │  Insights Widget     │
├──────────────────────────────────────────────────┤
│  Shared Conversations (tabbed)                   │
│  [With me] [Team] [Everyone]                     │
└──────────────────────────────────────────────────┘
```

### Navigation Change

A "Home" pill will be added as the first item in AppHeader's navigation pills. The `getActiveTab()` function will be updated to return `"home"` when the pathname is exactly `/`.

### Data Flow

```mermaid
flowchart TD
    HomePage["HomePage Component"] -->|mount| FetchRecent["apiClient.getConversations()"]
    HomePage -->|mount| FetchShared["apiClient.getSharedConversations()"]
    HomePage -->|mount| FetchStats["apiClient.getUserStats()"]

    FetchRecent -->|"owned + shared, sorted by updatedAt"| RecentChats["RecentChats Section"]
    FetchShared -->|"shared via user or team"| SharedTabs["SharedConversations Tabs"]
    FetchStats -->|"UserStats object"| InsightsWidget["InsightsWidget"]

    SharedTabs --> TabMe["Shared with me"]
    SharedTabs --> TabTeam["Shared with team"]
    SharedTabs --> TabEveryone["Shared with everyone (is_public)"]

    RecentChats -->|click| ChatPage["/chat/uuid"]
    TabMe -->|click| ChatPage
    TabTeam -->|click| ChatPage
    TabEveryone -->|click| ChatPage
```

### ShareDialog Enhancement

The existing `ShareDialog` component (`src/components/chat/ShareDialog.tsx`) will be updated to include a "Share with everyone" toggle that sets `sharing.is_public` on the conversation. The backend field already exists and is handled by the sharing API; only the UI toggle is missing.

### Graceful Degradation

When MongoDB is unavailable (`storageMode !== 'mongodb'`):

| Section | Behavior |
|---------|----------|
| Welcome Banner | Shown (uses session user name) |
| Capability Cards | Shown (static content, no API) |
| Recent Chats | Shown (loaded from localStorage via chat store) |
| Shared with me | Hidden (requires MongoDB) |
| Shared with team | Hidden (requires MongoDB) |
| Shared with everyone | Hidden (requires MongoDB) |
| Insights Widget | Hidden (requires MongoDB) |

## Components Changed

### New Components

| Component | Path | Purpose |
|-----------|------|---------|
| `WelcomeBanner` | `src/components/home/WelcomeBanner.tsx` | Personalized greeting with user name |
| `CapabilityCards` | `src/components/home/CapabilityCards.tsx` | Chat / Skills / KB feature cards |
| `RecentChats` | `src/components/home/RecentChats.tsx` | Grid of recent conversation cards |
| `SharedConversations` | `src/components/home/SharedConversations.tsx` | Tabbed view: with me / team / everyone |
| `InsightsWidget` | `src/components/home/InsightsWidget.tsx` | Personal stats summary |
| `ConversationCard` | `src/components/home/ConversationCard.tsx` | Reusable card for conversation entries |

### Modified Components

| Component | Path | Change |
|-----------|------|--------|
| `Home` | `src/app/page.tsx` | Replace `router.replace("/skills")` redirect with home page rendering |
| `AppHeader` | `src/components/layout/AppHeader.tsx` | Add "Home" nav pill; update `getActiveTab()` to detect `/` |
| `ShareDialog` | `src/components/chat/ShareDialog.tsx` | Add "Share with everyone" toggle for `is_public` |

### Existing APIs Used (No Backend Changes)

| API | Client Method | Already Exists | Currently Used |
|-----|--------------|----------------|----------------|
| `GET /api/chat/conversations` | `getConversations()` | Yes | Yes (Sidebar) |
| `GET /api/chat/shared` | `getSharedConversations()` | Yes | **No** (unused) |
| `GET /api/users/me/stats` | `getUserStats()` | Yes | Yes (Insights page) |
| `POST /api/chat/conversations/:id/share` | `shareConversation()` | Yes | Yes (ShareDialog) |

## Testing

### Unit Tests (Jest)

- ConversationCard renders title, relative timestamp, and shared badge
- RecentChats shows empty state when no conversations exist
- SharedConversations tabs switch correctly between views
- InsightsWidget renders stats and handles zero-activity state
- CapabilityCards hides KB card when `ragEnabled` is false
- AppHeader highlights "Home" pill when pathname is `/`

### Integration / E2E

- Home page fetches and renders conversations on mount
- Clicking a conversation card navigates to `/chat/<uuid>`
- "Share with everyone" toggle in ShareDialog updates `is_public` and conversation appears in public tab
- MongoDB-disabled mode hides shared sections and insights

### Manual Verification

- Log in and verify all sections render on `/`
- Share a conversation with a user, verify it appears on their home page
- Mark a conversation public, verify any other user sees it
- Test across all 8 themes for visual consistency

## Related

- Spec: `ui/.specify/specs/ui-home-page.md`
- Existing: `ui/src/components/chat/ShareDialog.tsx` (needs `is_public` toggle)
- Existing: `ui/src/lib/api-client.ts` (`getSharedConversations` — line 255, `getUserStats` — line 327)
- Existing: `ui/src/app/(app)/insights/page.tsx` (full insights; widget links here)
- Existing: `ui/src/types/mongodb.ts` (`Conversation.sharing.is_public` — line 48)
