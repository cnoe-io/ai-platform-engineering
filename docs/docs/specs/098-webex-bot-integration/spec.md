# Feature Specification: Webex Bot Integration

**Feature Branch**: `098-webex-bot-integration`  
**Created**: 2026-03-18  
**Status**: Implemented  
**Input**: User description: "We need to add webex bot integration like slackbot streaming if possible. Spec kit number is 098. https://developer.webex.com/messaging/docs/bots Can we use websockets. https://github.com/cisco-eti/jarvis-agent has a functioning webex integration, we need to make sure the authorization layer remains the same between slackbot and webex. Also try to commonize some of the elements."

## Clarifications

### Session 2026-03-18

- Q: How should the Webex bot determine whether a user is authorized to use CAIPE? → A: Space-level control as the primary mechanism (only users in allowed/configured Webex spaces can use the bot). OIDC group-based user-level authorization for 1:1 spaces is a planned future enhancement — a placeholder requirement must be included now.
- Q: What message should the bot show to users in unauthorized spaces? → A: "This space is not authorized to use CAIPE. Contact your administrator to enable access."
- Q: How should the "authorize bot with CAIPE UI OAuth flow" work when the bot is added to a Webex space? → A: Two paths — (C) Admin-only UI page in the CAIPE Admin Dashboard for managing authorized Webex spaces (add/remove room IDs, stored in MongoDB), and (D) Bot command-based authorization where a user sends `@caipe authorize` in a space, triggering an inline OAuth challenge via Adaptive Card with a link to the CAIPE UI for OIDC authentication. Both paths store authorized space records in MongoDB.
- Q: Should the Slack bot be refactored to extract a common integration layer? → A: No. Do not refactor the Slack bot at this time. The Webex bot will copy the needed shared modules (A2A client, event parser, session manager, OAuth2 client) into its own codebase. Commonization (User Story 3) is deferred to a future spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Send a Message to the Webex Bot and Receive a Streamed Response (Priority: P1)

A user mentions the CAIPE Webex bot in a Webex space (group or 1:1). The bot receives the message via WebSocket, forwards it to the CAIPE supervisor using the A2A protocol (same as the Slack bot), and streams the response back to the user in the Webex space. The user sees incremental progress — execution plan updates, tool notifications, and the final answer — as they arrive, rather than waiting for the entire response to complete.

**Why this priority**: This is the core value proposition — giving Webex users the same AI-assisted platform engineering experience that Slack users already have. Without this, there is no Webex integration.

**Independent Test**: Can be fully tested by mentioning the bot in a Webex space, sending a question (e.g., "list my ArgoCD applications"), and verifying that the bot replies with streamed progress and a final answer.

**Acceptance Scenarios**:

1. **Given** the Webex bot is running and connected via WebSocket, **When** a user @mentions the bot in a group space, **Then** the bot receives the message and begins processing it through the A2A supervisor.
2. **Given** the bot is processing a request, **When** the supervisor streams A2A events (status updates, artifact updates), **Then** the bot posts incremental updates to the Webex space (e.g., execution plan, tool progress notifications, and the final answer).
3. **Given** the user sends a message in a 1:1 space with the bot, **When** the message is received, **Then** the bot processes it without requiring an @mention (consistent with Webex 1:1 bot behavior).
4. **Given** the supervisor returns an error or the A2A connection fails, **When** the bot encounters the failure, **Then** the user sees a clear error message in the Webex space.
5. **Given** the bot is restarted or loses its WebSocket connection, **When** the connection drops, **Then** the bot automatically reconnects without user intervention.

---

### User Story 2 - Unified Authorization Between Slack Bot and Webex Bot (Priority: P1)

The Webex bot authenticates to the CAIPE supervisor using the same authorization mechanism as the Slack bot — OAuth2 client credentials or shared key — so that a single authorization policy governs all bot integrations. An administrator configures the Webex bot's credentials (client ID, secret, token URL) via environment variables, identical in shape to the Slack bot's auth configuration. The supervisor recognizes the Webex bot as a trusted client source (`X-Client-Source: webex-bot`) and applies the same access controls.

**Why this priority**: Authorization parity is a hard requirement. Without consistent auth, the Webex bot cannot communicate with the supervisor, and it introduces security fragmentation.

**Independent Test**: Can be tested by configuring the Webex bot with OAuth2 credentials, starting it, and verifying that A2A requests to the supervisor include a valid Bearer token and are accepted.

**Acceptance Scenarios**:

1. **Given** the Webex bot is configured with OAuth2 client credentials (`WEBEX_INTEGRATION_ENABLE_AUTH=true`, client ID, secret, token URL), **When** the bot sends a message to the supervisor, **Then** the request includes a valid `Authorization: Bearer <token>` header.
2. **Given** the Webex bot's OAuth2 token has expired, **When** the bot makes a request, **Then** the token is automatically refreshed before sending.
3. **Given** the Webex bot sends a request, **When** the supervisor receives it, **Then** the `X-Client-Source` header is `webex-bot` and the request is accepted by the existing auth middleware (SharedKey or OAuth2).
4. **Given** the Webex bot is misconfigured (invalid credentials), **When** it attempts to connect, **Then** it logs a clear authentication error and does not silently fail.

---

### User Story 2b - Space Authorization via Bot Command (Priority: P1)

When the CAIPE Webex bot is first mentioned in an unauthorized space, it replies with "This space is not authorized to use CAIPE. Contact your administrator to enable access." along with instructions to run `@caipe authorize`. When a user with sufficient privileges runs `@caipe authorize` in the space, the bot responds with an Adaptive Card containing a "Connect to CAIPE" button that links to a CAIPE UI authorization page. The user clicks the link, authenticates via the existing OIDC SSO in the CAIPE UI, and the UI registers the Webex room ID as an authorized space (stored in MongoDB). Once authorized, the bot begins processing messages in that space. The authorization is checked dynamically against MongoDB on each incoming message (with caching for performance). For 1:1 direct messages, the bot allows all messages in the initial release; a future OIDC group-based check will gate 1:1 access.

**Why this priority**: User authorization is a hard requirement before production deployment. Without it, any user who can add the bot to a space gains access to CAIPE, which is unacceptable for enterprise use. The bot-command flow provides a self-service path for authorized users.

**Independent Test**: Can be tested by adding the bot to a new space, sending a message (denied), running `@caipe authorize`, completing the OIDC auth flow in the CAIPE UI, and verifying subsequent messages are processed.

**Acceptance Scenarios**:

1. **Given** the bot is added to a new (unauthorized) space, **When** a user @mentions the bot, **Then** the bot replies with "This space is not authorized to use CAIPE. Contact your administrator to enable access." and does not forward the message to the supervisor.
2. **Given** a user runs `@caipe authorize` in an unauthorized space, **When** the bot receives the command, **Then** the bot responds with an Adaptive Card containing a "Connect to CAIPE" button linking to the CAIPE UI authorization endpoint (e.g., `<CAIPE_UI_BASE_URL>/api/integrations/webex/authorize?roomId=<roomId>`).
3. **Given** the user clicks "Connect to CAIPE" and authenticates via OIDC SSO in the CAIPE UI, **When** the auth succeeds and the user has the required OIDC group membership, **Then** the CAIPE UI stores the authorized space record in MongoDB (room ID, authorized-by user email, timestamp) and shows a success confirmation.
4. **Given** the space has been authorized via the CAIPE UI, **When** a user sends a subsequent message to the bot, **Then** the bot checks MongoDB for the room ID, finds it authorized, and processes the message normally.
5. **Given** a user sends a 1:1 direct message to the bot, **When** the message is received, **Then** the bot processes it regardless of space authorization (1:1 authorization is deferred to future OIDC-based check).
6. **Given** an admin revokes a space's authorization (via the admin dashboard), **When** the next message arrives in that space, **Then** the bot denies it with the standard unauthorized message.

---

### User Story 2b-admin - Admin Dashboard for Authorized Webex Spaces (Priority: P2)

An administrator uses the CAIPE Admin Dashboard to view, add, and remove authorized Webex spaces. The admin page shows a list of all authorized spaces with room ID, space name (fetched from Webex API), who authorized it, and when. Admins can manually add spaces by room ID or revoke authorization for existing spaces. This provides administrative oversight and a fallback management path beyond the self-service bot command flow.

**Why this priority**: P2 — The bot command flow (Story 2b) provides the primary self-service path. Admin dashboard management is important for oversight and revocation but can follow the core authorization flow.

**Independent Test**: Can be tested by logging into the CAIPE Admin Dashboard, viewing the authorized spaces list, adding a new room ID, and verifying the bot begins responding in that space.

**Acceptance Scenarios**:

1. **Given** an admin navigates to the Admin Dashboard, **When** they open the "Webex Spaces" section (or "Integrations" section), **Then** they see a list of all authorized Webex spaces with room ID, space name, authorized-by email, and authorization date.
2. **Given** an admin clicks "Add Space" and enters a Webex room ID, **When** they submit, **Then** the room ID is stored in MongoDB as an authorized space and the bot begins processing messages in that space.
3. **Given** an admin clicks "Revoke" on an authorized space, **When** they confirm, **Then** the space record is removed from MongoDB and the bot stops processing messages in that space.
4. **Given** the authorized spaces list has many entries, **When** the admin views the list, **Then** it supports search and pagination.

---

### User Story 2c - OIDC Group-Based User Authorization for 1:1 Spaces (Priority: P3 — Future Enhancement)

In a future release, when a user sends a direct (1:1) message to the bot, the bot validates the user's identity against an OIDC identity provider to check group membership. Only users belonging to a required OIDC group (e.g., `caipe-users` or `backstage-access`) are allowed to use the bot in 1:1 spaces. This provides user-level authorization consistent with the UI's OIDC group-based RBAC. The authorization interface must be designed now (as a pluggable check) so that OIDC support can be added without refactoring the message handling pipeline.

**Why this priority**: P3 (future) — Space-level control covers group spaces in v1. OIDC integration requires IdP configuration, token exchange, and caching infrastructure that is better delivered as a follow-up. The interface/hook must exist now.

**Independent Test**: (Future) Can be tested by configuring an OIDC group requirement, sending a 1:1 message from a user in the required group (allowed) and a user not in the group (denied).

**Acceptance Scenarios**:

1. **Given** OIDC user authorization is enabled (`WEBEX_INTEGRATION_OIDC_ENABLED=true`), **When** a user sends a 1:1 message, **Then** the bot resolves the user's email via Webex People API and checks group membership against the configured OIDC provider.
2. **Given** the user is NOT a member of the required OIDC group, **When** they send a 1:1 message, **Then** the bot replies with an authorization denied message.
3. **Given** OIDC user authorization is disabled (default), **When** a user sends a 1:1 message, **Then** the bot allows the message (fallback to open access for 1:1).

---

### User Story 3 - Common Bot Infrastructure (Priority: DEFERRED — Future Spec)

> **DEFERRED**: Do not refactor the Slack bot in this feature. The Webex bot will copy the needed modules (A2A client, event parser, session manager, OAuth2 client) into its own codebase as standalone copies. Commonization into a shared `integrations/common/` layer will be addressed in a future spec when a third integration (e.g., Microsoft Teams) triggers the Rule of Three.

Developers maintaining the platform can add future bot integrations without duplicating integration code. The Slack bot and Webex bot would share a common integration layer. This is deferred because the Slack bot is stable and should not be modified in this feature branch.

**Acceptance Scenarios**: Deferred — will be defined in the future commonization spec.

---

### User Story 4 - Conversation Threading in Webex Spaces (Priority: P2)

A user has an ongoing conversation with the bot in a Webex space. When they send follow-up messages, the bot maintains conversation context using the same session management as the Slack bot (thread-to-context mapping). The bot associates each Webex space + parent message thread with an A2A context ID, enabling multi-turn conversations.

**Why this priority**: Without threading, every message is treated as a new conversation, losing context. This is essential for a useful assistant experience but can be delivered after the basic message/response flow.

**Independent Test**: Can be tested by sending a series of related messages to the bot and verifying that the bot maintains context across messages (e.g., "list my apps" followed by "show details for the first one").

**Acceptance Scenarios**:

1. **Given** a user sends a message to the bot in a Webex space, **When** the bot responds, **Then** the bot creates a new A2A context and stores the mapping (space ID + message ID → context ID) in the session store.
2. **Given** a user sends a follow-up message in the same thread, **When** the bot receives it, **Then** the bot retrieves the existing context ID and includes it in the A2A request, enabling multi-turn conversation.
3. **Given** a user starts a new topic (new thread or new 1:1 message without parent), **When** the bot processes it, **Then** a new context ID is created.

---

### User Story 5 - Human-in-the-Loop (HITL) Interactions via Webex (Priority: P3)

When the supervisor requires user input (e.g., confirming a destructive operation), the Webex bot presents the user with interactive elements — Adaptive Cards with buttons or text inputs — to collect their response. The user's input is sent back to the supervisor to continue the workflow.

**Why this priority**: HITL is important for safe operations but depends on the core message flow and Webex Adaptive Card support. It can be implemented after the basic integration is stable.

**Independent Test**: Can be tested by triggering a workflow that requires user confirmation (e.g., deleting an ArgoCD application), verifying the bot shows an Adaptive Card with options, and confirming the user's selection is forwarded to the supervisor.

**Acceptance Scenarios**:

1. **Given** the supervisor sends an `input-required` status update, **When** the bot receives it, **Then** the bot renders a Webex Adaptive Card with the appropriate input fields or buttons.
2. **Given** the user interacts with the Adaptive Card (clicks a button or submits a form), **When** the bot receives the card action, **Then** the user's input is sent back to the supervisor as an A2A message with the correct context ID.
3. **Given** the HITL interaction times out (user doesn't respond), **When** the timeout expires, **Then** the bot notifies the user that the operation was not completed.

---

### Edge Cases

- What happens when the Webex bot receives a message with attachments (files, images)? The bot should gracefully ignore unsupported content and process only the text portion.
- How does the bot handle rate limiting from the Webex API? The bot should implement exponential backoff and queue messages when rate-limited.
- What happens when multiple users mention the bot simultaneously in the same space? Each mention should be processed independently with its own A2A context.
- What if the Webex WebSocket connection drops during an active A2A streaming session? The bot should attempt to post whatever partial response was received and inform the user of the interruption.
- What happens when the bot is added to a space but not mentioned? In group spaces, the bot should only respond to @mentions (consistent with Webex platform behavior). In 1:1 spaces, all messages are processed.
- What happens when a user adds the bot to an unauthorized space and mentions it? The bot should respond once with a polite message indicating the space is not authorized, and should not forward the message to the supervisor. Repeated unauthorized attempts in the same space should be rate-limited to avoid spam.
- What happens when no spaces are authorized in MongoDB? The bot denies all group-space messages and responds with the authorization instructions. This is the expected initial state — spaces are authorized dynamically via the `@caipe authorize` flow or by an admin.
- What happens if MongoDB is unavailable when the bot checks space authorization? The bot should fall back to its in-memory cache of recently authorized spaces. If the cache is empty (cold start with no MongoDB), the bot should deny messages and log an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST connect to the Webex platform via WebSocket using the `webex_bot` Python library (or equivalent WebSocket-based approach) to receive messages without requiring webhooks or a public-facing endpoint.
- **FR-002**: System MUST forward received user messages to the CAIPE supervisor using the A2A protocol (`message/stream` JSON-RPC over HTTP with SSE responses), identical to the Slack bot's communication pattern.
- **FR-003**: System MUST stream supervisor responses back to the Webex space as incremental updates (execution plan, tool notifications, final answer) rather than a single block response.
- **FR-004**: System MUST authenticate to the CAIPE supervisor using the same authorization mechanisms as the Slack bot: OAuth2 client credentials flow or shared key, configurable via environment variables.
- **FR-005**: System MUST include `X-Client-Source: webex-bot` in all requests to the supervisor for metrics and routing differentiation.
- **FR-006**: System MUST maintain conversation context by mapping Webex space/thread identifiers to A2A context IDs using its own session manager (MongoDB or in-memory), functionally equivalent to the Slack bot's session manager.
- **FR-007**: System MUST handle @mentions in group spaces and direct messages in 1:1 spaces, stripping the bot mention prefix before forwarding the message text.
- **FR-008**: System MUST include its own copies of the A2A client, event parser, OAuth2 client, and session manager modules within the Webex bot codebase (copied from the Slack bot and adapted for Webex). The Slack bot MUST NOT be modified. A shared `integrations/common/` layer is deferred to a future spec.
- **FR-009**: System MUST support Webex Adaptive Cards for rendering structured content (execution plans, HITL forms) when the supervisor sends artifact or input-required events.
- **FR-010**: System MUST automatically reconnect to the Webex WebSocket if the connection drops, with exponential backoff.
- **FR-011**: System MUST be deployable as a standalone Docker container with its own Dockerfile, Helm chart, and docker-compose service definition.
- **FR-012**: System MUST log all significant events (connection state changes, message receipt, A2A requests, errors) using structured JSON logging.
- **FR-013**: System MUST enforce space-level authorization for group spaces by checking incoming messages against a dynamic list of authorized Webex room IDs stored in MongoDB before forwarding to the supervisor. Messages from unauthorized spaces MUST be rejected with the denial message: "This space is not authorized to use CAIPE. Contact your administrator to enable access."
- **FR-014**: System MUST allow 1:1 direct messages by default in v1, with a pluggable authorization interface that can be extended with OIDC group-based user-level checks in a future release.
- **FR-015** *(placeholder — future)*: System SHOULD support OIDC group-based user authorization for 1:1 spaces, validating the user's email against a required OIDC group before processing. The authorization interface MUST be designed as a pluggable check callable from the message handling pipeline.
- **FR-016**: System MUST support a bot command (`@caipe authorize`) that initiates a space authorization flow by responding with an Adaptive Card containing a "Connect to CAIPE" link to the CAIPE UI authorization endpoint.
- **FR-017**: The CAIPE UI MUST expose an API endpoint for Webex space authorization (`/api/integrations/webex/authorize`) that authenticates the user via OIDC SSO, verifies the user has the required OIDC group membership, and stores the authorized space record (room ID, authorized-by email, timestamp) in MongoDB.
- **FR-018**: The CAIPE Admin Dashboard MUST include a section for managing authorized Webex spaces — listing, adding, and revoking space authorizations — with search and pagination.
- **FR-019**: The bot MUST cache authorized space lookups with a configurable TTL (default: 5 minutes) to avoid querying MongoDB on every incoming message, while ensuring revocations take effect within the TTL window.

### Key Entities

- **Webex Bot**: The CAIPE bot registered on the Webex platform. Identified by a bot access token. Connects via WebSocket to receive messages and uses the Webex REST API to send replies.
- **Webex Space**: A Webex room (group or 1:1) where the bot participates. Equivalent to a Slack channel. Each space has a unique room ID.
- **Webex Message**: A message sent in a space. Contains text, optional attachments, sender info, and a parent message ID (for threading). Equivalent to a Slack message with thread_ts.
- **Session**: A mapping between a Webex conversation thread (space ID + parent message ID) and an A2A context ID. Persisted in MongoDB or held in memory.
- **Webex Integration Modules**: Python modules within the Webex bot for A2A client, event parser, session store, and OAuth2 client — copied from the Slack bot and adapted for the Webex bot (e.g., `X-Client-Source: webex-bot`, `WEBEX_INTEGRATION_AUTH_*` env prefix, `webex_sessions` MongoDB collection). The Slack bot is not modified.
- **Authorized Space Record**: A MongoDB document representing a Webex space that has been authorized to use CAIPE. Fields: room ID, space name, authorized-by user email, authorization timestamp, status (active/revoked). Created via the bot `@caipe authorize` command + CAIPE UI OIDC flow, or by an admin via the Admin Dashboard.
- **User Authorization Check** *(placeholder — future)*: A pluggable interface for validating whether a specific user (by email) is authorized to use CAIPE. The initial implementation is a no-op pass-through; the future implementation will check OIDC group membership.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users in Webex spaces can interact with the CAIPE bot and receive AI-assisted responses within the same time frame as Slack bot users (response latency difference < 2 seconds for equivalent queries).
- **SC-002**: The Webex bot maintains a persistent WebSocket connection with 99.5% uptime, automatically recovering from disconnections within 30 seconds.
- **SC-003**: 100% of authorization configurations (OAuth2 and shared key) that work for the Slack bot also work for the Webex bot without modification to the supervisor.
- **SC-004**: The Webex bot's A2A client, event parser, session manager, and OAuth2 client are functionally equivalent to the Slack bot's implementations, validated by passing the same categories of unit tests (A2A streaming, SSE parsing, session CRUD, token refresh).
- **SC-005**: Multi-turn conversations maintain context across at least 10 consecutive exchanges in a single Webex thread without context loss.
- **SC-006** *(deferred)*: A future commonization spec will enable a developer to add a new bot platform integration by implementing only platform-specific adapters, reusing shared components. For now, the Webex bot serves as a reference implementation alongside the Slack bot.
- **SC-007**: The Webex bot handles concurrent requests from at least 50 simultaneous users across different spaces without message loss or response corruption.

### Assumptions

- The Webex bot will be registered via the Webex Developer Portal and a bot access token will be provided as an environment variable (`WEBEX_BOT_TOKEN`).
- The `webex_bot` Python library (or the `webexpythonsdk` library with WebSocket support) will be used for WebSocket-based message reception, avoiding the need for webhooks or a publicly routable endpoint.
- The jarvis-agent Webex integration (https://github.com/cisco-eti/jarvis-agent) will be used as an architectural reference, not as a direct code dependency.
- Webex Adaptive Cards will be used for structured responses (execution plans, HITL forms), similar to how the Slack bot uses Block Kit.
- The Webex bot will run as its own Docker service alongside the Slack bot, sharing the same supervisor endpoint.
- Webex message formatting uses Markdown, which aligns well with the existing A2A streaming result format.
