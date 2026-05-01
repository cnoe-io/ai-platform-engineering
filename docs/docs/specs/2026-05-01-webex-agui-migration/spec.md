# Feature Specification: Webex Bot AG-UI (Dynamic Agents) Migration

**Feature Branch**: `2026-05-01-webex-agui-migration`
**Created**: 2026-05-01
**Status**: Draft
**Input**: User description: "webex-bot-integration - we need use dynamic agents like slack-bot and discuss"

## Clarifications

### Session 2026-05-01

- Q: What is the migration scope for the Webex bot? → A: Full migration — remove A2A protocol code entirely and use the dynamic agents (AG-UI) backend exclusively, mirroring the Slack bot AG-UI migration (spec 100).
- Q: How should Webex spaces map to dynamic agents? → A: Per-space mapping persisted in MongoDB. The existing `authorized_webex_spaces` collection (from spec 098) is extended with an `agent_id` field. Admins manage the mapping via the existing CAIPE Admin Dashboard "Webex Spaces" section. A configurable default agent applies when a space has no explicit mapping.
- Q: How should Webex conversation IDs be computed for the dynamic agents backend? → A: Deterministic UUID v5 derived from the existing Webex `thread_key` (`roomId` for 1:1 spaces, `roomId:parentId` for threaded replies, `roomId:messageId` for new top-level group messages), using a fixed namespace shared with the Slack bot's UUID v5 strategy where appropriate. This guarantees that the same Webex thread always resolves to the same conversation ID.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real User Asks a Question via Webex (Priority: P1)

A team member @mentions the bot in a configured Webex group space, or sends a message in a 1:1 space. The bot receives the message via WebSocket, looks up the dynamic agent configured for that space, and streams the response back into the Webex thread. The user sees progressive text updates, tool usage indicators, and plan steps as the agent works — equivalent to the pre-migration experience, but powered by the dynamic agents backend instead of the deprecated supervisor.

**Why this priority**: This is the core value proposition. Without streaming responses against the dynamic agents backend, the entire Webex integration becomes non-functional once the supervisor is decommissioned.

**Independent Test**: Send a message to the bot in a configured Webex space and verify a streamed response appears progressively (with tool/plan indicators) in the same thread, sourced from the dynamic agents backend.

**Acceptance Scenarios**:

1. **Given** a Webex space mapped to a valid dynamic agent, **When** a real user @mentions the bot with a question, **Then** the bot streams a response progressively into the thread using the dynamic agents backend.
2. **Given** a Webex thread with prior conversation history, **When** the user sends a follow-up message in the same thread, **Then** the bot resolves the same deterministic conversation ID and the response reflects multi-turn continuity.
3. **Given** a real user message, **When** the dynamic agents backend emits tool-call events during processing, **Then** the bot displays tool usage indicators (start/end) in the Webex thread.
4. **Given** a real user message, **When** the backend emits plan/execution-step events, **Then** the bot renders plan steps progressively in Webex (Adaptive Card or markdown updates).
5. **Given** a Webex thread, **When** the conversation ID is computed, **Then** it is a deterministic UUID v5 derived from the Webex `thread_key`, and the same thread always produces the same conversation ID.

---

### User Story 2 - Per-Space Agent Routing (Priority: P1)

An administrator opens the CAIPE Admin Dashboard "Webex Spaces" section and assigns a specific dynamic agent to each authorized Webex space. When a user sends a message in that space, the bot resolves the configured agent and routes the request to that agent specifically. Spaces without an explicit mapping fall back to a configured default agent.

**Why this priority**: Per-space agent routing is the key differentiator of the dynamic agents architecture over the monolithic supervisor — it lets different teams use specialized agents in their own Webex spaces. Authorization and routing must ship together; an authorized space without a routable agent is non-functional.

**Independent Test**: Configure two authorized spaces with different agents via the Admin Dashboard, send the same question in each, and verify each response is produced by the agent assigned to that space.

**Acceptance Scenarios**:

1. **Given** two authorized Webex spaces mapped to different dynamic agent identifiers in MongoDB, **When** a user sends a question in each space, **Then** each request is routed to the correct agent.
2. **Given** an authorized space with no `agent_id` configured, **When** a user sends a message, **Then** the bot routes the request to the configured default agent and continues normally.
3. **Given** an admin updates the agent mapping for a space via the Admin Dashboard, **When** the next message arrives in that space (after cache TTL), **Then** the new agent receives the request.
4. **Given** an admin assigns an `agent_id` that does not exist in the dynamic agents backend, **When** a user sends a message, **Then** the bot posts a user-friendly misconfiguration error in the space and logs the failure.
5. **Given** a 1:1 direct space, **When** a user sends a message, **Then** the bot uses the configured default agent (per-space routing for 1:1 spaces is supported but optional).

---

### User Story 3 - Bot User (Automated) Asks a Question (Priority: P2)

An automated upstream system (alerting pipeline, integration bot) sends a message that the Webex bot consumes. Because automated consumers do not benefit from streaming, the bot uses a non-streaming (invoke) path against the dynamic agents backend, then posts the full response as a single Webex message in the appropriate space/thread.

**Why this priority**: Automated bot-to-bot interactions are an established use case from the Slack bot (AI alerting). Webex parity requires the same invoke path. Lower priority than P1 because real-user streaming covers the dominant interaction pattern.

**Independent Test**: Simulate a bot-originated Webex message (e.g., from another automation) and verify a complete, non-streamed response is posted as a single message in the correct Webex thread.

**Acceptance Scenarios**:

1. **Given** a message identified as originating from a bot/automation user, **When** the bot processes the request, **Then** it uses the non-streaming invoke path and posts the full response as a single message.
2. **Given** a bot user message, **When** the invoke call completes successfully, **Then** the response content is posted to the correct Webex room and thread.
3. **Given** a bot user message, **When** the invoke call fails, **Then** the bot posts an error message to the thread and logs the failure.

---

### User Story 4 - Human-in-the-Loop Approval in Webex (Priority: P2)

During a streamed response, the agent reaches a step that requires human approval (e.g., confirming a destructive action or approving a ticket). The bot renders an Adaptive Card in the Webex thread containing the prompt, form fields, and action buttons defined in the AG-UI interrupt payload. The user fills in the form and submits. The bot resumes the agent run with the user's input, and streaming continues from where it paused.

**Why this priority**: HITL is safety-critical for approval-gated workflows. It depends on Story 1 (streaming) being functional. Same priority as the Slack bot HITL migration in spec 100.

**Independent Test**: Trigger an agent workflow that emits a HITL interrupt, verify the Adaptive Card appears in Webex with the expected fields, submit a response, and confirm the agent resumes and completes the workflow.

**Acceptance Scenarios**:

1. **Given** a streaming response in progress, **When** the dynamic agents backend emits a HITL interrupt event, **Then** the bot renders an Adaptive Card in the Webex thread with the appropriate fields and actions.
2. **Given** a HITL Adaptive Card displayed in Webex, **When** the user submits the form with valid input, **Then** the bot sends the response to the dynamic agents resume endpoint and streaming continues.
3. **Given** a HITL Adaptive Card displayed in Webex, **When** the user rejects/cancels the action, **Then** the bot sends a rejection response and the agent handles it appropriately.
4. **Given** a HITL interrupt with field definitions (text, select, multiselect, textarea), **When** the bot renders the card, **Then** each field type maps to an appropriate Webex Adaptive Card input element.

---

### User Story 5 - Webex Conversations Are Isolated from Web UI (Priority: P3)

Conversations initiated through Webex do not appear in the CAIPE Web UI conversation list. The two interfaces maintain separate conversation spaces. Users browsing the Web UI see only their web-originated conversations.

**Why this priority**: This is a scoping constraint that mirrors spec 100 (Slack). Without it, Webex threads would surface in the Web UI and confuse users who never opted into web visibility.

**Independent Test**: Conduct a conversation in Webex, then open the Web UI conversation list and confirm the Webex conversation is not visible.

**Acceptance Scenarios**:

1. **Given** a conversation conducted entirely through Webex, **When** a user opens the Web UI conversation list, **Then** the Webex conversation is not visible.
2. **Given** Webex conversations stored under deterministic UUID v5 identifiers tagged with a Webex source/origin, **When** the Web UI queries conversations, **Then** only web-originated conversations are returned.

---

### User Story 6 - Legacy A2A Code Removal (Priority: P3)

All deprecated A2A protocol code is removed from the Webex bot codebase. The bot no longer references `a2a_client`, A2A event parsers, supervisor-specific streaming logic, or the supervisor base URL configuration. The codebase is cleaner, smaller, and free of dead code paths.

**Why this priority**: Code removal reduces maintenance burden and aligns the Webex bot with the Slack bot's post-migration shape. Low risk on its own, but depends on all other stories being complete and validated end-to-end.

**Independent Test**: Inspect the Webex bot codebase and confirm no A2A-related imports, classes, or function calls remain, and that the full test suite passes without A2A modules.

**Acceptance Scenarios**:

1. **Given** the migration is complete, **When** the Webex bot codebase is inspected, **Then** no A2A client code, A2A event parser code, or supervisor-specific logic remains.
2. **Given** the A2A code has been removed, **When** all tests are executed, **Then** all tests pass without referencing A2A modules.
3. **Given** the A2A code has been removed, **When** the bot is started, **Then** it does not attempt to connect to a supervisor endpoint.

---

### Edge Cases

- What happens when the dynamic agents backend is unreachable during a streaming request? The bot posts a user-friendly error in the Webex thread and logs the failure.
- What happens when a streaming connection drops mid-response? The bot finalizes any partial message already posted, notifies the user that the response was interrupted, and allows retry.
- What happens when the configured `agent_id` for a space does not exist in the dynamic agents backend? The bot posts an error indicating misconfiguration and logs the issue. The space remains authorized but non-functional until the mapping is corrected.
- What happens when an authorized space has no `agent_id` set? The bot uses the configured default agent.
- What happens when a space is authorized but the default agent is also unset/invalid? The bot posts a misconfiguration error in the space and logs the failure on startup.
- What happens when a HITL Adaptive Card submission fails (resume endpoint unreachable)? The bot notifies the user that the approval could not be processed and suggests retry.
- What happens when two users post simultaneously in the same Webex thread? The conversation ID is deterministic per thread, so both messages map to the same conversation. The agent must handle concurrent inputs gracefully.
- What happens when a message arrives during an active HITL interrupt? The bot queues or rejects the new message and informs the user that the agent is waiting for a pending approval.
- What happens when the `@caipe authorize` flow is invoked? The existing space-authorization flow from spec 098 continues to work unchanged. After authorization, the admin (or the authorizing user, if permitted) sets the `agent_id` for the space; until then, the default agent is used.
- User messages from Webex and Adaptive Card submissions are external inputs relayed to the dynamic agents backend. They are treated as untrusted; the bot does not perform additional prompt construction or logic injection beyond passing the raw message. Input validation and sanitization remain the responsibility of the backend.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST stream responses from the dynamic agents backend (AG-UI protocol) to Webex threads in real time for real (non-bot) users.
- **FR-002**: The system MUST support a non-streaming invoke path for bot/automation users, posting complete responses as single Webex messages.
- **FR-003**: The system MUST compute conversation identifiers deterministically as UUID v5 values derived from the Webex `thread_key` (`roomId`, `roomId:parentId`, or `roomId:messageId`), using a fixed namespace.
- **FR-004**: The system MUST map dynamic agents streaming events (run lifecycle, text content, tool calls, custom events) to appropriate Webex message updates (markdown edits and/or Adaptive Card updates).
- **FR-005**: The system MUST render human-in-the-loop interrupt requests as Webex Adaptive Cards with the fields and actions specified in the AG-UI interrupt payload.
- **FR-006**: The system MUST resume agent processing after a HITL Adaptive Card submission by sending the user's response to the dynamic agents resume endpoint with the correct conversation identifier.
- **FR-007**: The system MUST route requests to the dynamic agent specified by the `agent_id` field on the authorized space record in MongoDB.
- **FR-008**: The system MUST fall back to a configured default agent when an authorized space has no `agent_id` mapping.
- **FR-009**: The system MUST extend the existing `authorized_webex_spaces` MongoDB schema (from spec 098) with an `agent_id` field, without breaking existing space records (records missing the field map to the default agent).
- **FR-010**: The CAIPE Admin Dashboard "Webex Spaces" section MUST allow administrators to view, set, and clear the `agent_id` for each authorized space.
- **FR-011**: The system MUST NOT expose Webex-originated conversations in the Web UI conversation list.
- **FR-012**: The system MUST remove all deprecated A2A protocol code from the Webex bot, including the A2A client, A2A event parser, hybrid streaming handler, and supervisor base URL configuration.
- **FR-013**: The system MUST preserve the existing space authorization flow (`@caipe authorize` bot command, OIDC-backed CAIPE UI authorization endpoint, admin dashboard) without changes to its user-facing behavior.
- **FR-014**: The system MUST preserve existing feedback (Langfuse), session management, and reconnection behavior without regressions.
- **FR-015**: The system MUST post user-friendly error messages in Webex when the backend is unreachable, the configured agent is not found, the default agent is not configured, or an unexpected error occurs during processing.
- **FR-016**: The system MUST include conversation context (thread continuity) in requests to the dynamic agents backend for multi-turn conversations.
- **FR-017**: The system MUST authenticate with the dynamic agents backend using the same authentication mechanism (OAuth2 client credentials or shared key) currently used to authenticate to the supervisor, with no change to the operator-facing configuration variables beyond renaming the backend URL.
- **FR-018**: The system MUST continue to identify itself with `X-Client-Source: webex-bot` (or equivalent) so the dynamic agents backend can apply Webex-specific policies and metrics.
- **FR-019**: The system MUST cache `agent_id` lookups with the same TTL as the existing space authorization cache, so admin changes take effect within the TTL window without per-message MongoDB queries.

### Key Entities

- **Conversation**: A Webex thread interaction with the dynamic agents backend. Identified by a deterministic UUID v5 derived from the Webex `thread_key` (1:1 room, threaded reply, or top-level group message). Contains messages exchanged between the user and the agent.
- **Authorized Webex Space**: An existing MongoDB record (from spec 098) representing a Webex room authorized to use CAIPE. Extended in this feature with an optional `agent_id` field that maps the space to a specific dynamic agent. Records without `agent_id` use the configured default agent.
- **Dynamic Agent**: A configured AI agent in the dynamic agents backend. Each authorized Webex space maps to one agent (explicit or default). Agents process user queries and emit AG-UI streaming events.
- **HITL Interrupt**: A pause in agent processing that requires human input. Contains a prompt, form fields, and action options. Rendered as a Webex Adaptive Card.
- **Streaming Event**: A real-time event emitted by the dynamic agents backend during response generation. Types include run lifecycle events, text content chunks, tool call notifications, and interrupt requests.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of Webex bot interactions use the dynamic agents backend; zero interactions route to the deprecated supervisor after migration.
- **SC-002**: Real users receive streamed responses in Webex within the same perceived latency as the pre-migration experience (first incremental update appears within 3 seconds of sending a message under normal load).
- **SC-003**: Bot/automation users receive complete invoke responses within 60 seconds for standard queries.
- **SC-004**: HITL Adaptive Cards render correctly in Webex and form submissions successfully resume agent processing in 100% of interrupt scenarios.
- **SC-005**: Zero Webex-originated conversations appear in the Web UI conversation list.
- **SC-006**: The same Webex `thread_key` always produces the same conversation identifier (deterministic UUID v5).
- **SC-007**: All existing Webex bot test scenarios pass against the new dynamic agents backend, with zero regressions in space authorization, session continuity, feedback, and reconnection workflows.
- **SC-008**: The Webex bot codebase contains zero references to A2A protocol modules, A2A client classes, hybrid streaming handlers, or supervisor-specific endpoints after migration.
- **SC-009**: Per-space agent routing delivers responses from the correct agent for 100% of spaces with an explicit `agent_id` mapping, and from the configured default agent for 100% of spaces without one.
- **SC-010**: Error scenarios (backend unreachable, invalid `agent_id`, default agent unset, connection drop) result in user-friendly error messages in Webex within 10 seconds.
- **SC-011**: Admin updates to a space's `agent_id` mapping take effect within the configured cache TTL (default 5 minutes from spec 098) without per-message MongoDB queries.

## Assumptions

- The dynamic agents backend is already deployed and operational with the AG-UI streaming, invoke, and resume endpoints (the same backend used by the Slack bot post spec 100).
- The AG-UI event protocol (event types, payload structures, interrupt format) is stable and will not undergo breaking changes during this migration; the same Slack-side event mapping logic is transferable.
- Existing space authorization records in MongoDB (`authorized_webex_spaces`) can be extended in place with an optional `agent_id` field; records lacking the field map to the configured default agent.
- The OAuth2 client credentials configuration currently used for the supervisor is compatible with the dynamic agents backend (or the dynamic agents backend accepts the same credential format), consistent with the Slack bot AG-UI migration.
- The UUID v5 namespace constant used for deterministic Webex conversation IDs is a fixed value agreed upon by the team and may overlap with or be distinct from the Slack namespace.
- Webex Adaptive Card capabilities are sufficient to render all HITL form field types emitted by AG-UI interrupt payloads (text, select, multiselect, textarea, action buttons).
- The Web UI filters conversations by source/origin and Webex-originated conversations can be excluded without additional backend changes (mirrors spec 100 assumption).
- The Webex bot continues to run via WebSocket (WDM pattern) as in spec 098; deployment shape (Docker container, Helm chart) is unchanged beyond environment variables related to the dynamic agents backend.
- The space authorization flow (`@caipe authorize` command, CAIPE UI OIDC endpoint, MongoDB persistence) from spec 098 remains in place and unmodified by this feature.
- The Slack bot's post-migration code (spec 100) is the reference implementation for AG-UI client logic, event mapping, and HITL handling. The Webex bot will adapt the same patterns (without sharing code in this feature; commonization remains deferred per spec 098).
