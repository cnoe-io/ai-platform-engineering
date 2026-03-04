# Feature Specification: UI Home Page

**Feature Branch**: `prebuild/feat/ui-home-page`  
**Created**: 2026-03-03  
**Updated**: 2026-03-04  
**Status**: Implemented  
**Input**: User description: "Add a landing/home page that outlines platform capabilities, surfaces recent chats, shared conversations, personal insights, and pick-up-where-you-left-off context"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recent Chats: Pick Up Where You Left Off (Priority: P1)

A logged-in user navigates to the home page and immediately sees their most recent conversations listed with titles, timestamps, and the agent used. They click any conversation to resume it in the chat view. This gives users a fast on-ramp to continue work without needing to open the chat sidebar and scroll.

**Why this priority**: Resuming prior work is the highest-frequency daily action. Users should never feel lost when they open the app.

**Independent Test**: Can be fully tested by logging in, verifying conversations appear sorted by recency, and clicking one to land in `/chat/<uuid>`.

**Acceptance Scenarios**:

1. **Given** a user with 5+ conversations, **When** they navigate to `/`, **Then** they see up to 8 recent conversations sorted by `updatedAt` descending with title, relative timestamp, and agent badge.
2. **Given** a user clicks a conversation card, **When** the click completes, **Then** they are navigated to `/chat/<uuid>` and the conversation loads.
3. **Given** a user with no conversations, **When** they navigate to `/`, **Then** the recent chats section shows an empty state with a "Start a new chat" action.
4. **Given** a user on localStorage mode (no MongoDB), **When** they navigate to `/`, **Then** recent chats still render from local conversations.

---

### User Story 2 - Shared With Me (Priority: P2)

A user sees a dedicated section showing conversations that other users or teams have shared with them. Each entry shows the conversation title, who shared it, and when. This makes shared knowledge discoverable without requiring a separate navigation path.

**Why this priority**: Collaboration is a core value proposition. Users currently have no visibility into conversations shared with them unless they already know the URL.

**Independent Test**: Can be tested by having User A share a conversation with User B, then User B logging in and verifying the shared conversation appears on their home page.

**Acceptance Scenarios**:

1. **Given** User B has 3 conversations shared with them, **When** they visit `/`, **Then** the "Shared with me" section shows those 3 conversations with sharer info.
2. **Given** a conversation is shared with User B's team, **When** User B visits `/`, **Then** that conversation appears in the shared section.
3. **Given** no conversations are shared with the user, **When** they visit `/`, **Then** the section shows an empty state: "No shared conversations yet."
4. **Given** MongoDB is not configured, **When** the user visits `/`, **Then** the shared section is hidden (sharing requires MongoDB).

---

### User Story 3 - Platform Capabilities Overview (Priority: P3)

A new or returning user sees a hero/overview section that explains what the platform can do: Chat with AI agents, run Skills/workflows. Each capability card links to the relevant section. This orients users — especially first-time visitors — and reduces the learning curve.

**Why this priority**: Without orientation, new users don't know what to do. The current redirect to `/skills` gives no context about chat or knowledge bases.

**Independent Test**: Can be tested by navigating to `/` and verifying capability cards render with correct descriptions and links.

**Acceptance Scenarios**:

1. **Given** a user visits `/`, **When** the page loads, **Then** they see capability cards for Chat and Skills with short descriptions and action links.
2. **Given** RAG is enabled in config, **When** the page loads, **Then** the Knowledge Bases card is also visible.
3. **Given** RAG is disabled in config, **When** the page loads, **Then** the Knowledge Bases card is hidden.
4. **Given** a user clicks "Start chatting" on the Chat card, **When** the click completes, **Then** they navigate to `/chat`.

---

### User Story 4 - Shared With Team (Priority: P4)

A user sees conversations shared with their team(s) in a distinct tab. This provides team-level knowledge sharing and makes it easy to find conversations relevant to the user's working group.

**Why this priority**: Team-level sharing builds on the "Shared with me" infrastructure but adds organizational context. Slightly lower priority because individual sharing (P2) covers the core need.

**Independent Test**: Can be tested by sharing a conversation with a team, then verifying a team member sees it in the "Shared with team" tab.

**Acceptance Scenarios**:

1. **Given** a conversation is shared with Team X, **When** a member of Team X visits `/`, **Then** the conversation appears in the team shared tab with the team name.
2. **Given** a user belongs to multiple teams, **When** they visit `/`, **Then** conversations from all their teams appear, grouped or labeled by team.
3. **Given** a user has no team memberships, **When** they visit `/`, **Then** the team tab shows "No conversations shared with your teams."

---

### User Story 5 - Shared With Everyone / Public Conversations (Priority: P5)

Users can mark conversations as "shared with everyone" (public) and all users see these globally-shared conversations in a dedicated tab on the home page. This enables org-wide knowledge sharing — showcasing useful agent interactions, common workflows, or reference conversations.

**Why this priority**: Requires a new sharing mode (`is_public` toggle in ShareDialog) which is additive to existing sharing. The backend field exists but was not surfaced in the UI before this feature.

**Independent Test**: Can be tested by toggling "Share with everyone" on a conversation in ShareDialog, then verifying any other authenticated user sees it on their home page.

**Acceptance Scenarios**:

1. **Given** a conversation owner opens ShareDialog, **When** they toggle "Share with everyone," **Then** the conversation's `is_public` field is set to `true` via the sharing API.
2. **Given** 2 conversations are marked `is_public`, **When** any user visits `/`, **Then** both appear in the "Shared with everyone" tab.
3. **Given** a user un-toggles "Share with everyone," **When** another user refreshes `/`, **Then** the conversation no longer appears in the public tab.

---

### User Story 6 - Personal Insights Summary (Priority: P6)

A small widget on the home page shows the user's personal stats: total conversations, messages this week, favorite agents, and token usage. This gives a quick sense of engagement and highlights which agents the user interacts with most.

**Why this priority**: Nice-to-have that leverages the existing `getUserStats()` API. The full Insights page already exists at `/insights`; this is a lightweight summary with a "View all" link.

**Independent Test**: Can be tested by verifying the widget renders with correct stats from the `/api/users/me/stats` endpoint.

**Acceptance Scenarios**:

1. **Given** a user with activity history, **When** they visit `/`, **Then** the insights widget shows total conversations, messages this week, and top 3 favorite agents.
2. **Given** a new user with no history, **When** they visit `/`, **Then** the widget shows zeros with a friendly "Start chatting to build your insights" message.
3. **Given** MongoDB is not configured, **When** they visit `/`, **Then** the insights widget is hidden.

---

### Edge Cases

- What happens when the conversations API is slow or times out? The page renders immediately with skeleton loaders for the chat sections, then populates when data arrives.
- How does the page handle a user with 100+ shared conversations? Paginate or cap with a "View all" link to the chat sidebar.
- What happens when session expires while on the home page? AuthGuard redirects to `/login?callbackUrl=/` as it does for all protected pages.
- What if the same conversation appears in both "Recent" and "Shared with me"? De-duplicate: show it in "Recent" only, with a shared badge.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `/` route MUST render a home page within the `(app)` route group, inheriting the global `AppHeader` layout.
- **FR-002**: AppHeader MUST include a "Home" navigation pill that links to `/` and highlights when active.
- **FR-003**: The home page MUST show a "Recent chats" section displaying the user's most recent conversations (up to 8) sorted by `updatedAt` descending, each linking to `/chat/<uuid>`.
- **FR-004**: The home page MUST show a "Shared with me" section using the existing `getSharedConversations()` API, displaying conversations shared directly with the user or via team membership.
- **FR-005**: The home page MUST show a "Shared with team" view (tab) filtered to conversations shared with the user's team(s), labeled by team name.
- **FR-006**: The home page MUST show a "Shared with everyone" tab listing conversations where `is_public === true`.
- **FR-007**: ShareDialog MUST surface a "Share with everyone" toggle that sets the `is_public` field on the conversation's sharing object via the existing API.
- **FR-008**: The home page MUST show platform capability cards for Chat and Skills with short descriptions and links. Knowledge Bases card is conditionally shown based on `RAG_ENABLED` config.
- **FR-009**: The home page MUST gracefully degrade when MongoDB is unavailable: show capability cards and local recent chats; hide shared sections and insights widget.
- **FR-010**: The home page MUST show a personal insights summary widget with stats from `getUserStats()` and a "View all" link to `/insights`.
- **FR-011**: All chat sections MUST show loading skeletons while data is being fetched.
- **FR-012**: The home page MUST be wrapped in `AuthGuard` for SSO-protected deployments.
- **FR-013**: Conversation cards MUST show the conversation title, relative timestamp (e.g., "2 hours ago"), and a shared badge when applicable.
- **FR-014**: The home page MUST display a "Powered by caipe.io" footer unconditionally.

### Key Entities

- **Conversation**: The primary entity displayed on the home page. Key attributes: `_id` (UUID), `title`, `owner_id`, `updated_at`, `sharing` (includes `is_public`, `shared_with`, `shared_with_teams`), `metadata.total_messages`.
- **UserStats**: Aggregate stats for the insights widget. Key attributes: `total_conversations`, `messages_this_week`, `conversations_this_week`, `favorite_agents`.
- **Team**: Used to resolve team-shared conversations. Key attributes: `_id`, `name`, `members`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users land on the home page in under 2 seconds (time to interactive), with skeleton loaders appearing within 200ms.
- **SC-002**: Users can resume a recent conversation in 1 click from the home page.
- **SC-003**: Shared conversations are discoverable without requiring the user to know a direct URL — at least 80% of shared conversations are seen by their intended recipients via the home page.
- **SC-004**: New users can understand the platform's core capabilities (Chat, Skills) within 10 seconds of landing on the home page.
- **SC-005**: The page renders correctly in both MongoDB and localStorage modes, hiding MongoDB-dependent sections gracefully.
- **SC-006**: All 8 themes render the home page without visual regressions.

## Design Notes

### Page Layout (Top to Bottom)

```
┌──────────────────────────────────────────────────┐
│  AppHeader (with "Home" pill)                    │
├──────────────────────────────────────────────────┤
│                                                  │
│  Welcome Banner / Hero                           │
│  "Welcome back, {firstName}"                     │
│                                                  │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │   Chat      │ │   Skills    │ │ Knowledge  │ │
│  │   card      │ │   card      │ │ Bases card*│ │
│  └─────────────┘ └─────────────┘ └────────────┘ │
│  Platform Capabilities          * if RAG enabled │
│                                                  │
├──────────────────────────────────────────────────┤
│                                                  │
│  Recent Chats              │  Insights Widget*   │
│  ┌─────┐ ┌─────┐ ┌─────┐  │  Conversations: 42  │
│  │conv1│ │conv2│ │conv3│  │  This week: 7       │
│  └─────┘ └─────┘ └─────┘  │  Top agent: GitHub  │
│  ┌─────┐ ┌─────┐          │  [View all →]       │
│  │conv4│ │conv5│          │  * MongoDB only      │
│  └─────┘ └─────┘          │                     │
│                                                  │
├──────────────────────────────────────────────────┤
│                                                  │
│  Shared Conversations*                           │
│  [Shared with me] [Team] [Everyone]  (tabs)      │
│  ┌─────┐ ┌─────┐ ┌─────┐    * MongoDB only      │
│  │conv │ │conv │ │conv │                         │
│  └─────┘ └─────┘ └─────┘                        │
│                                                  │
├──────────────────────────────────────────────────┤
│        ⚡ Powered by caipe.io                     │
└──────────────────────────────────────────────────┘
```

### Components Created

| Component | Path | Purpose |
|-----------|------|---------|
| `HomePage` | `src/app/(app)/page.tsx` | Dashboard home page at `/` |
| `WelcomeBanner` | `src/components/home/WelcomeBanner.tsx` | Personalized greeting with time-of-day awareness |
| `CapabilityCards` | `src/components/home/CapabilityCards.tsx` | Chat / Skills / KB cards (KB conditional on RAG) |
| `RecentChats` | `src/components/home/RecentChats.tsx` | Recent conversation grid with "New Chat" link |
| `SharedConversations` | `src/components/home/SharedConversations.tsx` | Tabbed shared conversations (me / team / everyone) |
| `InsightsWidget` | `src/components/home/InsightsWidget.tsx` | Stats summary with "View all" link |
| `ConversationCard` | `src/components/home/ConversationCard.tsx` | Reusable card with title, timestamp, shared badge |

### Components Modified

| Component | Path | Change |
|-----------|------|--------|
| `AppHeader` | `src/components/layout/AppHeader.tsx` | Added "Home" nav pill as first tab; updated `getActiveTab()` to detect `/` |
| `ShareDialog` | `src/components/chat/ShareDialog.tsx` | Added "Share with everyone" toggle for `is_public` with `role="switch"` |

### API Endpoints Used (No Backend Changes)

| Endpoint | Client Method | Purpose |
|----------|--------------|---------|
| `GET /api/chat/conversations` | `apiClient.getConversations()` | Recent chats (owned + shared) |
| `GET /api/chat/shared` | `apiClient.getSharedConversations()` | Shared-with-me conversations |
| `GET /api/users/me/stats` | `apiClient.getUserStats()` | Personal insights |
| `POST /api/chat/conversations/:id/share` | `apiClient.shareConversation()` | Update sharing (for `is_public`) |

### Existing Infrastructure Leveraged

- `apiClient.getSharedConversations()` existed but was unused — now powers the shared conversations tabs
- `apiClient.getUserStats()` existed and powered `/insights` — reused for the widget
- `sharing.is_public` field existed on the `Conversation` type — now surfaced via ShareDialog toggle

## Testing Strategy

### Unit Tests (Jest) — 1953 tests across 82 suites

**Home Page (`home-page.test.tsx`)**:
- Page structure: AuthGuard wrapper, `data-testid`, "Powered by caipe.io" footer
- Welcome banner: personalized greeting, no preferences shortcut rendered
- Capability cards: RAG on/off toggling Knowledge Bases card
- Recent chats: MongoDB fetch, empty state, localStorage fallback, `loadConversationsFromServer` call
- Shared conversations: fetch from API, section rendered
- Insights widget: stats fetched and rendered
- localStorage mode: shared & insights sections hidden, capability cards and welcome banner still shown
- Not authenticated: no API fetches
- Error handling: graceful recovery from API failures

**Component Tests**:
- `ConversationCard`: renders title, relative timestamp, shared badge variants, singular/plural messages, link to `/chat/{id}`
- `RecentChats`: loading skeletons, empty state, conversation list, maxItems, new chat link
- `SharedConversations`: tab switching, per-tab empty messages, loading, data display
- `InsightsWidget`: loading, empty, stats grid, top agents (singular/plural), header outside card
- `CapabilityCards`: RAG enabled/disabled, card links, section heading
- `WelcomeBanner`: morning/afternoon/evening greetings, personalized/generic greeting, optional preferences callback

**AppHeader Tests**:
- Home tab: visible, links to `/`, active styling on `/`, inactive on other paths

**ShareDialog Tests**:
- Toggle render, label, description, ARIA attributes (`role="switch"`, `aria-checked`)
- Initial `is_public=false` and `is_public=true` from API
- Click sends POST with `is_public=true` (toggle on) and `is_public=false` (toggle off)
- Store update on success
- Graceful error handling on API failure

### Manual Verification
- Navigate to `/` after login, verify all sections render
- Share a conversation, verify it appears on another user's home page
- Test with MongoDB disabled — shared sections hidden, capabilities still shown
- Test across all 8 themes for visual consistency

## Related

- ADR: `docs/docs/changes/2026-03-03-ui-home-page.md`
- Existing: `ui/src/components/chat/ShareDialog.tsx` (added `is_public` toggle)
- Existing: `ui/src/lib/api-client.ts` (`getSharedConversations`, `getUserStats`)
- Existing: `ui/src/components/layout/AppHeader.tsx` (added "Home" nav pill)
- Existing: `ui/src/app/(app)/insights/page.tsx` (full insights page — widget links here)
