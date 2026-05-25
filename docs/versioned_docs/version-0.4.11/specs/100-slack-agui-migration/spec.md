# Feature Specification: Slack Bot AG-UI Migration

**Feature Branch**: `100-slack-agui-migration`  
**Created**: 2026-04-13  
**Status**: Draft  
**Input**: User description: "Migrate the CAIPE Slack bot from supervisor (A2A protocol) to dynamic agents (AG-UI protocol) for release 0.4.0. The supervisor is deprecated; the Slack bot will exclusively use dynamic agents. This includes rewriting the SSE client for AG-UI endpoints, replacing the A2A streaming handler with AG-UI event mapping, updating HITL support for AG-UI interrupt format, rewiring app.py event handlers, updating Docker/config, and replacing tests. Slack conversations do NOT appear in web UI. Conversation IDs are deterministic UUID v5 from thread_ts. Both streaming (real users) and invoke (bot users) paths are supported. A2A code is removed entirely."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real User Asks a Question via Slack (Priority: P1)

A team member mentions the bot or sends a direct message in a configured Slack channel. The bot receives the message, determines the correct agent for that channel, and streams the response back into the Slack thread in real time. The user sees progressive text updates, tool usage indicators, and plan steps as the agent works, exactly as they did before the migration, but now powered by the dynamic agents backend.

**Why this priority**: This is the primary interaction path. If streaming responses do not work for real users, the entire Slack integration is broken. Every other feature depends on this path functioning correctly.

**Independent Test**: Can be fully tested by sending a message to the bot in a configured channel and verifying that a streaming response appears progressively in the Slack thread. Delivers immediate conversational AI value to the end user.

**Acceptance Scenarios**:

1. **Given** a Slack channel configured with a valid agent, **When** a real user mentions the bot with a question, **Then** the bot streams a response progressively into the thread using the dynamic agents backend.
2. **Given** a Slack thread with prior conversation history, **When** the user sends a follow-up message, **Then** the bot includes thread context in the request and the response reflects conversational continuity.
3. **Given** a real user message, **When** the dynamic agents backend emits tool-call events during processing, **Then** the bot displays tool usage indicators (start/end notifications) in the Slack thread.
4. **Given** a real user message, **When** the backend emits plan/execution-step events, **Then** the bot renders plan steps progressively in Slack.
5. **Given** a Slack thread, **When** the conversation ID is computed, **Then** it is a deterministic UUID v5 derived from the thread timestamp, and the same thread always produces the same conversation ID.

---

### User Story 2 - Bot User (Automated) Asks a Question (Priority: P1)

An automated bot or integration sends a message that triggers the CAIPE bot (e.g., AI alerting pipelines). Since bot users cannot see streaming updates, the bot uses a non-streaming (invoke) path to get the full response and posts it as a single complete message.

**Why this priority**: Automated bot-to-bot interactions are a core use case for AI alerting and operational workflows. Without invoke support, these integrations break entirely.

**Independent Test**: Can be tested by simulating a bot user message and verifying that a complete (non-streamed) response is posted as a single Slack message.

**Acceptance Scenarios**:

1. **Given** a message from a bot user (identified by a bot-prefixed user ID), **When** the bot processes the request, **Then** it uses the non-streaming invoke path and posts the full response as a single message.
2. **Given** a bot user message, **When** the invoke call completes, **Then** the response content is posted to the correct Slack thread.
3. **Given** a bot user message, **When** the invoke call fails, **Then** the bot posts an error message to the thread and logs the failure.

---

### User Story 3 - Human-in-the-Loop Approval in Slack (Priority: P2)

During a streamed response, the agent encounters a step that requires human approval (e.g., confirming a destructive action, approving a Jira ticket creation). The bot presents an interactive form in the Slack thread with fields and action buttons. The user fills in the form and submits. The bot resumes the agent run with the user's input, and streaming continues from where it left off.

**Why this priority**: HITL is a safety-critical feature for operations that require human judgment. Without it, the bot cannot perform approval-gated workflows. It depends on Story 1 (streaming) being functional.

**Independent Test**: Can be tested by triggering an agent workflow that requires human input, verifying the form appears in Slack, submitting a response, and confirming the agent resumes and completes.

**Acceptance Scenarios**:

1. **Given** a streaming response in progress, **When** the agent requests human input (interrupt event), **Then** the bot renders an interactive form in the Slack thread with the appropriate fields and actions.
2. **Given** a HITL form displayed in Slack, **When** the user submits the form with valid input, **Then** the bot sends the response to the dynamic agents resume endpoint and streaming continues.
3. **Given** a HITL form displayed in Slack, **When** the user rejects/cancels the form, **Then** the bot sends a rejection response and the agent handles it appropriately.
4. **Given** a HITL interrupt, **When** the interrupt payload contains field definitions (text, select, multiselect, textarea), **Then** each field type is correctly rendered using Slack Block Kit components.

---

### User Story 4 - Channel-Specific Agent Routing (Priority: P2)

An administrator configures different Slack channels to route to different dynamic agents via the bot's channel configuration. When a user asks a question in a specific channel, the bot routes the request to the agent configured for that channel, rather than a single shared supervisor.

**Why this priority**: Per-channel agent routing enables specialized agents for different teams and use cases. It is a key differentiator of the dynamic agents architecture over the monolithic supervisor.

**Independent Test**: Can be tested by configuring two channels with different agents, sending messages in each, and verifying that responses come from the expected agent.

**Acceptance Scenarios**:

1. **Given** two Slack channels configured with different agent identifiers, **When** a user asks a question in each channel, **Then** each request is routed to the correct agent.
2. **Given** a channel configuration with a valid agent identifier, **When** the bot starts up, **Then** it loads the agent mapping and uses it for all requests in that channel.
3. **Given** a channel with no agent identifier configured, **When** a user sends a message, **Then** the bot falls back to a default agent.

---

### User Story 5 - Slack Conversations Are Isolated from Web UI (Priority: P3)

Conversations initiated through Slack do not appear in the web UI conversation list. The two interfaces maintain separate conversation spaces. Users accessing the web UI see only their web-originated conversations.

**Why this priority**: This is a scoping constraint rather than a new feature. It ensures that the migration does not inadvertently surface Slack threads in the web UI, which would confuse users and mix contexts.

**Independent Test**: Can be tested by conducting a conversation in Slack, then checking the web UI conversation list and confirming the Slack conversation does not appear.

**Acceptance Scenarios**:

1. **Given** a conversation conducted entirely through Slack, **When** a user opens the web UI conversation list, **Then** the Slack conversation is not visible.
2. **Given** Slack conversations stored with deterministic UUID v5 identifiers, **When** the web UI queries conversations, **Then** only web-originated conversations are returned.

---

### User Story 6 - Legacy A2A Code Removal (Priority: P3)

All deprecated A2A protocol code is removed from the Slack bot codebase. The bot no longer contains any references to A2A clients, A2A event parsing, or supervisor-specific logic. The codebase is cleaner and easier to maintain.

**Why this priority**: Code removal reduces maintenance burden and eliminates confusion from dead code paths. It is low-risk but depends on all other stories being complete.

**Independent Test**: Can be tested by verifying that no A2A-related imports, classes, or function calls exist in the Slack bot codebase, and that all tests pass without A2A dependencies.

**Acceptance Scenarios**:

1. **Given** the migration is complete, **When** the Slack bot codebase is inspected, **Then** no A2A client code, A2A event parser code, or supervisor-specific logic remains.
2. **Given** the A2A code has been removed, **When** all tests are executed, **Then** all tests pass without referencing A2A modules.
3. **Given** the A2A code has been removed, **When** the bot is started, **Then** it does not attempt to connect to a supervisor endpoint.

---

### Edge Cases

- What happens when the dynamic agents backend is unreachable during a streaming request? The bot should post a user-friendly error message in the Slack thread and log the connection failure.
- What happens when a streaming connection drops mid-response? The bot should finalize any partial message already posted, notify the user that the response was interrupted, and allow retry.
- What happens when the configured agent identifier for a channel does not exist in the dynamic agents backend? The bot should post an error indicating misconfiguration and log the issue.
- What happens when a HITL form submission fails (e.g., resume endpoint is unreachable)? The bot should notify the user that the approval could not be processed and suggest retrying.
- What happens when two users interact in the same Slack thread simultaneously? The conversation ID is deterministic per thread, so both messages go to the same conversation. The agent should handle concurrent inputs gracefully.
- What happens when a message arrives during an active HITL interrupt (the agent is waiting for input)? The bot should queue or reject the new message and inform the user that the agent is waiting for a pending approval.
- User messages from Slack and HITL form submissions are external inputs relayed to the dynamic agents backend. These should be treated as untrusted — the bot should not perform additional prompt construction or logic injection beyond passing the raw message. Input validation and sanitization is the responsibility of the backend, but the bot should not make it worse.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST stream responses from the dynamic agents backend to Slack threads in real time for real (non-bot) users.
- **FR-002**: The system MUST support a non-streaming invoke path for bot users, posting complete responses as single messages.
- **FR-003**: The system MUST compute conversation identifiers deterministically as UUID v5 values derived from the Slack thread timestamp, using a fixed namespace.
- **FR-004**: The system MUST map dynamic agents streaming events (run lifecycle, text content, tool calls, custom events) to appropriate Slack message updates.
- **FR-005**: The system MUST render human-in-the-loop interrupt requests as interactive Slack forms with the fields and actions specified in the interrupt payload.
- **FR-006**: The system MUST resume agent processing after a HITL form submission by sending the user's response to the dynamic agents resume endpoint.
- **FR-007**: The system MUST route requests to the agent identifier specified in the channel configuration.
- **FR-008**: The system MUST fall back to a default agent when no agent identifier is configured for a channel.
- **FR-009**: The system MUST NOT expose Slack-originated conversations in the web UI conversation list.
- **FR-010**: The system MUST remove all deprecated A2A protocol code, including the A2A client, A2A event parser, and supervisor-specific logic.
- **FR-011**: The system MUST preserve existing feedback, escalation, and retry functionality without changes to their user-facing behavior.
- **FR-012**: The system MUST post user-friendly error messages in Slack when the backend is unreachable, the agent is not found, or an unexpected error occurs during processing.
- **FR-013**: The system MUST include conversation context (thread history) in requests to the dynamic agents backend for multi-turn conversations.
- **FR-014**: The system MUST authenticate with the dynamic agents backend using the existing credential mechanism.

### Key Entities

- **Conversation**: Represents a Slack thread interaction. Identified by a deterministic UUID v5 derived from the thread timestamp. Contains messages exchanged between the user and the agent.
- **Agent**: A configured AI agent in the dynamic agents backend. Each Slack channel maps to one agent via channel configuration. Agents process user queries and emit streaming events.
- **Channel Configuration**: Maps a Slack channel to an agent identifier, along with other channel-specific settings (Q&A mode, AI alerts, escalation rules).
- **HITL Interrupt**: A pause in agent processing that requires human input. Contains a prompt, form fields, and action options. Rendered as a Slack interactive form.
- **Streaming Event**: A real-time event emitted by the dynamic agents backend during response generation. Types include run lifecycle events, text content chunks, tool call notifications, and interrupt requests.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of Slack bot interactions use the dynamic agents backend; zero interactions route to the deprecated supervisor after migration.
- **SC-002**: Users receive streamed responses in Slack within the same perceived latency as the pre-migration experience (first token appears within 3 seconds of sending a message under normal load).
- **SC-003**: Bot users receive complete invoke responses within 60 seconds for standard queries.
- **SC-004**: HITL forms render correctly in Slack and form submissions successfully resume agent processing in 100% of interrupt scenarios.
- **SC-005**: Zero Slack-originated conversations appear in the web UI conversation list.
- **SC-006**: The same Slack thread timestamp always produces the same conversation identifier (deterministic UUID v5).
- **SC-007**: All existing Slack bot test scenarios pass with the new dynamic agents backend, with zero regressions in feedback, escalation, and retry workflows.
- **SC-008**: The Slack bot codebase contains zero references to A2A protocol modules, A2A client classes, or supervisor-specific endpoints after migration.
- **SC-009**: Channel-to-agent routing delivers responses from the correct agent for 100% of configured channels.
- **SC-010**: Error scenarios (backend unreachable, invalid agent, connection drop) result in user-friendly error messages in Slack within 10 seconds.

## Assumptions

- The dynamic agents backend is already deployed and operational with the required streaming, invoke, and resume endpoints.
- The AG-UI event protocol (event types, payload structures, interrupt format) is stable and will not undergo breaking changes during this migration.
- Existing channel configurations in YAML format will be extended (not replaced) with an agent identifier field.
- The OAuth2 authentication mechanism currently used for the supervisor is compatible with the dynamic agents backend, or the dynamic agents backend accepts the same credential format.
- Slack Block Kit capabilities are sufficient to render all HITL form field types emitted by the dynamic agents interrupt payloads.
- The UUID v5 namespace value used for deterministic conversation IDs is a fixed constant agreed upon by the team.
- The web UI filters conversations by source or origin, and Slack-originated conversations can be excluded without additional backend changes.
- Feedback, escalation, and retry workflows are backend-agnostic and do not require protocol-level changes for this migration.
- The Slack bot will continue to run in Socket Mode as the default deployment mode.
- Channel configuration remains in the YAML env var (`SLACK_INTEGRATION_BOT_CONFIG`) for this release. Centralizing configuration via the NextJS API server is planned as a follow-up (spec 101).
