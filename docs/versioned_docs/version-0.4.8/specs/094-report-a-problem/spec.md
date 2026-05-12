# Feature Specification: Report a Problem & Ticket Integration

**Feature Branch**: `094-report-a-problem`  
**Created**: 2026-03-17  
**Status**: Draft  
**Input**: User description: "In the Submit Feedback Modal, add a second button to submit feedback and report Jira/GitHub combo ticket for further assistance. Add a system prompt to submit a Jira ticket or GitHub ticket as an optional feature using ENV variable, exposed via Helm chart env variable. Outshift will use OPENSD. This will work like AI Enhance, but the ticket will be created in the background with ability to see streamed logs. Also, add a prominent 'Report a Problem' button that creates a Jira or GitHub Issue based on the env configured but is prompt based, takes a very short input from user. Include the chat unique URL in the issue."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Report a Problem from Header (Priority: P1)

A user encounters an issue while using the platform. They click the "Report a Problem" button in the app header (visible on all pages). A modal appears with a short text input field. The user types a brief description (e.g., "ArgoCD sync keeps failing for prod namespace"). On submit, the system creates a Jira or GitHub issue in the background via the existing Jira/GitHub agents, routing through the supervisor A2A protocol. The modal shows streaming progress logs (similar to the AI Enhance pattern in Skills Builder). The created ticket includes the user's description, their email, and the current chat URL (if they're on a chat page). The user sees a confirmation with the created ticket ID/link.

**Why this priority**: This is the most broadly useful feature -- it provides a global, always-accessible way for any user to report problems, regardless of where they are in the app.

**Independent Test**: Can be fully tested by clicking the header button, entering text, and verifying a ticket is created in the configured provider (Jira or GitHub).

**Acceptance Scenarios**:

1. **Given** the ticket provider is configured (e.g., JIRA_TICKET_ENABLED=true), **When** the user clicks "Report a Problem" in the header, **Then** a modal opens with a text input, submit button, and the configured provider label (e.g., "Report via Jira").
2. **Given** the user has typed a description and clicks submit, **When** the ticket creation begins, **Then** the modal shows an animated progress indicator with a "Show Details" toggle to view streaming A2A logs.
3. **Given** the ticket is successfully created, **When** the stream completes, **Then** the user sees the ticket ID/link and a success message.
4. **Given** the user is on a chat page (`/chat/<uuid>`), **When** they submit a report, **Then** the created ticket body includes the full chat URL.
5. **Given** no ticket provider is configured (both JIRA and GitHub disabled), **When** the app renders, **Then** the "Report a Problem" button is hidden from the header.
6. **Given** the ticket creation fails, **When** an error occurs, **Then** the user sees an error message with the ability to retry or copy their description.

---

### User Story 2 - Submit Feedback and Create Ticket (Priority: P2)

A user provides negative feedback on an AI response using the existing thumbs-down flow. After selecting a reason and optionally adding text, the feedback dialog now shows two buttons: "Submit Feedback" (existing behavior -- sends to Langfuse) and "Submit & Report Issue" (new -- submits feedback AND creates a Jira/GitHub ticket). When they click "Submit & Report Issue," the feedback is submitted to Langfuse as usual, then the dialog transitions to show streaming progress as the ticket is created in the background. The ticket body includes the feedback reason, any additional text, the user's email, and the chat conversation URL.

**Why this priority**: This extends the existing feedback flow with a natural escalation path. It depends on the same ticket creation infrastructure as Story 1 but adds integration into the existing FeedbackButton component.

**Independent Test**: Can be tested by clicking thumbs-down on a message, selecting a reason, clicking "Submit & Report Issue," and verifying both Langfuse feedback and ticket creation occur.

**Acceptance Scenarios**:

1. **Given** the ticket provider is configured, **When** the feedback dialog opens (after thumbs up or down), **Then** both "Submit Feedback" and "Submit & Report Issue" buttons are visible.
2. **Given** no ticket provider is configured, **When** the feedback dialog opens, **Then** only the existing "Submit Feedback" button is shown.
3. **Given** the user clicks "Submit & Report Issue," **When** the process begins, **Then** feedback is first sent to Langfuse, then ticket creation starts with streaming progress shown in the dialog.
4. **Given** the ticket is created, **When** the stream completes, **Then** the dialog shows the ticket ID/link and a success confirmation before closing.
5. **Given** the user is on `/chat/<uuid>`, **When** they submit a report via feedback, **Then** the ticket body includes the conversation URL `<base-url>/chat/<uuid>`.

---

### User Story 3 - Report a Problem from Feedback Dialog (Priority: P2)

The "Report a Problem" button also appears inside the feedback dialog as a secondary action, allowing users to quickly escalate without going through the full thumbs-up/down flow. This provides a consistent entry point from both the header and the feedback dialog.

**Why this priority**: Same priority as Story 2 -- it's part of the feedback dialog integration and reuses the same modal/streaming infrastructure.

**Independent Test**: Can be tested by opening the feedback dialog and using the "Report a Problem" link/button within it to open the same report modal.

**Acceptance Scenarios**:

1. **Given** the ticket provider is configured, **When** the feedback dialog is open, **Then** a "Report a Problem" link or button is visible.
2. **Given** the user clicks "Report a Problem" in the dialog, **When** the report modal opens, **Then** it pre-fills the chat URL from the current conversation context.

---

### User Story 4 - Environment Configuration via Helm (Priority: P1)

Platform administrators configure the ticket integration through environment variables. The configuration supports Jira and GitHub independently, allowing one or both to be active. These variables are exposed through the Helm chart's values.yaml for Kubernetes deployments.

**Why this priority**: This is foundational -- without configuration, no ticket features are visible or functional.

**Independent Test**: Can be tested by setting environment variables and verifying the UI shows/hides ticket-related buttons accordingly.

**Acceptance Scenarios**:

1. **Given** `JIRA_TICKET_ENABLED=true` and `JIRA_TICKET_PROJECT=OPENSD`, **When** the app loads, **Then** ticket buttons show "via Jira" labeling and tickets are created in the OPENSD project.
2. **Given** `GITHUB_TICKET_ENABLED=true` and `GITHUB_TICKET_REPO=org/repo`, **When** the app loads, **Then** ticket buttons show "via GitHub" labeling and issues are created in the specified repository.
3. **Given** both providers are enabled, **When** the user submits a report, **Then** the system uses the first available provider (Jira takes precedence, or allow user to choose).
4. **Given** neither provider is enabled, **When** the app loads, **Then** all ticket-related UI elements are hidden.

---

### Edge Cases

- What happens when the A2A agent (Jira/GitHub) is unreachable during ticket creation? The system shows an error in the streaming log and offers retry.
- What happens when the user submits a report from a non-chat page (e.g., admin, skills)? The ticket is created without a chat URL; the current page URL is included instead.
- What happens when the streaming connection drops mid-creation? The UI shows a connection lost message and offers retry.
- What happens when the user cancels during ticket creation? The cancel button aborts the A2A stream (same as AI Enhance cancel pattern).
- What happens when the ticket provider's API is rate-limited? The streaming log shows the rate limit error from the agent.
- How does the feature behave for unauthenticated users? Ticket features require authentication; the buttons are hidden if the user is not logged in.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a "Report a Problem" button in the global app header when at least one ticket provider is configured.
- **FR-002**: System MUST show a modal with a short text input field when "Report a Problem" is clicked.
- **FR-003**: System MUST create a ticket via the existing Jira or GitHub A2A agents, streaming progress logs to the user in real-time.
- **FR-004**: System MUST include the current chat URL (`<base-url>/chat/<uuid>`) in the ticket body when the user is on a chat page.
- **FR-005**: System MUST include the current page URL in the ticket body when the user is not on a chat page.
- **FR-006**: System MUST include the user's email address in the ticket body.
- **FR-007**: System MUST add a "Submit & Report Issue" button to the existing feedback dialog when a ticket provider is configured.
- **FR-008**: The "Submit & Report Issue" button MUST first submit feedback to Langfuse, then create a ticket with the feedback details (reason, additional text, chat URL).
- **FR-009**: System MUST support Jira ticket creation via the `JIRA_TICKET_ENABLED` and `JIRA_TICKET_PROJECT` environment variables.
- **FR-010**: System MUST support GitHub issue creation via the `GITHUB_TICKET_ENABLED` and `GITHUB_TICKET_REPO` environment variables.
- **FR-011**: System MUST hide all ticket-related UI elements when no provider is configured.
- **FR-012**: System MUST expose ticket configuration variables through the Helm chart values.yaml.
- **FR-013**: System MUST show streaming A2A logs in a collapsible "Show Details" panel during ticket creation (matching the AI Enhance UX pattern).
- **FR-014**: System MUST allow the user to cancel ticket creation mid-stream.
- **FR-015**: System MUST display the created ticket ID or link upon successful creation.
- **FR-016**: System MUST show an error message with retry option if ticket creation fails.

### Key Entities

- **TicketConfig**: Represents the ticket provider configuration -- provider type (Jira/GitHub), project key or repository, enabled state. Derived from environment variables.
- **TicketRequest**: The data sent to the A2A agent to create a ticket -- user description, user email, chat/page URL, feedback context (optional).
- **TicketResult**: The response from the agent -- ticket ID, ticket URL, provider name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can report a problem from any page in the application within 30 seconds (open modal, type description, submit).
- **SC-002**: Users see real-time progress of ticket creation with streaming logs visible within 2 seconds of submission.
- **SC-003**: Created tickets contain the correct chat URL, user email, and problem description with no manual copy-paste required.
- **SC-004**: The ticket integration is fully configurable -- enabling/disabling via environment variables requires zero code changes.
- **SC-005**: When no ticket provider is configured, no ticket-related UI elements are visible (zero visual noise for unconfigured deployments).
- **SC-006**: The feedback-to-ticket flow completes both Langfuse submission and ticket creation in a single user action.

## Assumptions

- The existing Jira and GitHub A2A agents are deployed and reachable from the supervisor when ticket features are enabled.
- The A2ASDKClient (already used by AI Enhance in SkillsBuilderEditor) provides the streaming interface needed for ticket creation progress.
- When both Jira and GitHub are enabled, Jira takes precedence (single provider per submission; no provider selection UI in v1).
- The "Report a Problem" input is a short free-text field (no structured form fields beyond the description in v1).
- The chat URL format is `<window.location.origin>/chat/<uuid>` and is constructed client-side.
