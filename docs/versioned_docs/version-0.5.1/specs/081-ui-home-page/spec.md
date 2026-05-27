---
sidebar_position: 2
sidebar_label: Specification
title: "2026-03-03: UI Home Page — Dashboard Landing Experience"
---

# UI Home Page — Dashboard Landing Experience

**Status**: Implemented
**Category**: Features & Enhancements
**Date**: March 3, 2026
**Updated**: March 4, 2026

## Motivation

The CAIPE UI currently redirects `/` to `/skills` via a client-side `router.replace()` in `app/page.tsx`. This creates several issues:

1. **No orientation for new users**: Landing directly on the skills gallery gives no context about the platform's other capabilities (Chat, Knowledge Bases, Insights). Users don't know what they can do.
2. **No shared content discovery**: Conversations shared with a user (via individuals or teams) are invisible unless the user already has the direct URL. The `getSharedConversations()` API exists and is wired up in `api-client.ts` but is unused in the UI.
3. **No "pick up where you left off"**: Users must navigate to Chat and use the sidebar to find their most recent conversation. There is no quick-access surface for resuming work.
4. **Underutilized sharing infrastructure**: The `is_public` field exists on the `Conversation` type (`sharing.is_public`) in both `types/a2a.ts` and `types/mongodb.ts`, but the `ShareDialog` component does not surface a toggle for it. There is no way for users to share conversations with everyone.
5. **App feels like a "skills catalog"**: Emphasizing skills as the landing page positions the product as a workflow catalog rather than an AI platform with multiple capabilities.

## Testing Strategy

### Unit Tests (Jest) — 2156 tests across 91 suites

- Home page integration tests: AuthGuard, page structure, footer, welcome banner, capability cards, recent chats, shared conversations, insights widget, localStorage mode, auth guard, error handling
- Component tests: ConversationCard, RecentChats, SharedConversations, InsightsWidget, CapabilityCards, WelcomeBanner
- AppHeader: Home tab visibility, link, active/inactive styling
- ShareDialog: Public toggle rendering, ARIA, toggle on/off, store update, error handling

### Manual Verification

- Log in and verify all sections render on `/`
- Share a conversation with a user, verify it appears on their home page
- Mark a conversation public, verify any other user sees it
- Test across all 8 themes for visual consistency
- Test with MongoDB disabled — shared sections hidden, capabilities and recent chats still shown

## Related

- Existing: `ui/src/components/chat/ShareDialog.tsx` (added `is_public` toggle)
- Existing: `ui/src/lib/api-client.ts` (`getSharedConversations`, `getUserStats`)
- Existing: `ui/src/app/(app)/insights/page.tsx` (full insights; widget links here)
- Existing: `ui/src/types/mongodb.ts` (`Conversation.sharing.is_public`)

- Architecture: [architecture.md](./architecture.md)
