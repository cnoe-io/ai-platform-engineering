# Feature Specification: Integrated Skills with Single Source, Chat Commands, and Skill Hubs

**Feature Branch**: `097-skills-middleware-integration`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "Create a new integrated feature with the current skills in UI and CAIPE supervisor reading the skill from MongoDB and using LangGraph skills middleware, also no more run skills in the chat, add support for /skills in chat window to show skills, also add the ability to add other skill hub via GitHub or public GitHub that supervisor is able to incorporate into skills middleware."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Source of Skills for UI and Assistant (Priority: P1)

Users and the assistant see the same, up-to-date skill catalog. The chat UI and the platform’s assistant (supervisor) both consume skills from one central store through a shared skills layer, so the list of available skills is consistent everywhere and there is no separate “run skills” action in chat.

**Why this priority**: This is the foundation. Without a single source, the UI and the assistant can disagree on what skills exist, and duplicate or legacy flows (like “run skills” in chat) create confusion and inconsistency.

**Independent Test**: Confirm that the skill list shown in the UI matches the skills the assistant can use, and that no “run skills” control remains in the chat experience.

**Acceptance Scenarios**:

1. **Given** a skill is available in the central catalog, **When** a user opens the skills experience in the UI, **Then** that skill appears in the list.
2. **Given** the same central catalog, **When** the assistant is deciding what to do, **Then** it uses the same set of skills (no separate or conflicting source).
3. **Given** the new integrated model is in place, **When** a user is in the chat window, **Then** there is no “run skills” action or equivalent; skill use is driven by the assistant via the shared catalog.
4. **Given** a skill is removed or disabled in the central catalog, **When** the UI and assistant refresh or reload, **Then** that skill is no longer listed or used.

---

### User Story 2 - /skills in Chat to Show Available Skills (Priority: P1)

Users can type a dedicated command (e.g. `/skills`) in the chat window to see the list of skills available to the assistant. This replaces the need for a separate “run skills” flow and gives quick, in-context visibility into what the assistant can do.

**Why this priority**: Directly supports clarity and trust. Users can discover and confirm available capabilities without leaving the conversation.

**Independent Test**: Open chat, type the designated command (e.g. `/skills`), and verify that the list of available skills is shown in the chat (and matches the single source from User Story 1).

**Acceptance Scenarios**:

1. **Given** a user is in the chat window, **When** they enter the agreed command (e.g. `/skills`), **Then** the system shows the list of skills available to the assistant.
2. **Given** the skills list is shown, **When** the user views it, **Then** the list is consistent with the central catalog (same as in UI and used by the assistant).
3. **Given** the user has not typed the command, **When** they send a normal message, **Then** the system does not automatically show the skills list; the list appears only when the user invokes the command.
4. **Given** the command is invoked, **When** the catalog is empty or no skills are available, **Then** the user sees an appropriate message (e.g. no skills available) rather than an error or blank state that implies a failure.

---

### User Story 3 - Add Skill Hubs from External Sources (e.g. GitHub) (Priority: P2)

Administrators (or authorized users) can register additional skill hubs—such as a public or private GitHub repository—so that skills from those sources are incorporated into the shared skills layer. The assistant can then use these skills in the same way as skills from the default catalog.

**Why this priority**: Enables extension and reuse (e.g. org-specific or community skill packs) without changing core product code. Important for scale and customization, but depends on User Stories 1 and 2 being in place.

**Independent Test**: Register an external skill hub (e.g. a public GitHub repo), verify its skills appear in the central catalog and in the response to the chat command (e.g. `/skills`), and confirm the assistant can use those skills in conversation.

**Acceptance Scenarios**:

1. **Given** an authorized user has access to add skill hubs, **When** they add a hub (e.g. by providing a public or private repository identifier), **Then** the system validates and registers that hub and makes its skills available through the shared skills layer.
2. **Given** a hub is registered, **When** the catalog is refreshed or the assistant loads skills, **Then** skills from that hub appear in the same catalog as default skills and are usable by the assistant.
3. **Given** a hub is registered, **When** a user invokes the chat command to show skills (e.g. `/skills`), **Then** skills from that hub are included in the list when they are successfully loaded.
4. **Given** a hub is removed or disabled, **When** the catalog is refreshed, **Then** skills from that hub are no longer listed or used.
5. **Given** a hub fails to load (e.g. network or permission issue), **When** the system refreshes skills, **Then** the rest of the catalog remains available and the user or admin receives a clear indication that the hub could not be loaded (no silent failure of the entire catalog).

---

### Edge Cases

- What happens when the central catalog is temporarily unavailable? The system should degrade gracefully: the chat command (e.g. `/skills`) and the assistant should show a clear “skills unavailable” or “try again” state rather than crashing or showing stale data as if it were current.
- What happens when an external hub returns invalid or malformed skill definitions? The system should reject or skip those entries, log or report the issue, and continue to serve the rest of the catalog.
- What happens when two hubs (or the default catalog and a hub) define a skill with the same identifier? The system should apply a consistent, predictable rule (e.g. one source wins, or explicit override order) and document that behavior so admins can avoid conflicts.
- What happens when a user without permission to add hubs tries to add one? The system should deny the action and return a clear permission error.
- What happens when the chat command (e.g. `/skills`) is used while skills are still loading? The system should show a loading or “fetching skills” state and then show the list when ready, or a clear message if loading fails.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a single, shared skill catalog to both the chat UI (for display) and the platform assistant (for execution); both MUST consume skills from this same source.
- **FR-002**: The system MUST remove any “run skills” or equivalent standalone skill-execution action from the chat experience; skill execution MUST be driven by the assistant using the shared catalog.
- **FR-003**: The system MUST support a designated chat command (e.g. `/skills`) that, when invoked, displays the list of skills available to the assistant in that conversation.
- **FR-004**: The list of skills shown by the chat command MUST match the shared catalog (same as used by the assistant and by the rest of the UI).
- **FR-005**: The system MUST allow authorized users to register external skill hubs (e.g. by repository or URL); once registered, skills from those hubs MUST be incorporated into the shared catalog and usable by the assistant.
- **FR-006**: The system MUST support at least one type of external hub that is commonly used for code or asset sharing (e.g. public or private repository); registration MUST accept the necessary identifiers (e.g. repository location and optional credentials or access method).
- **FR-007**: When an external hub is removed or disabled, the system MUST stop listing and using skills from that hub after the next catalog refresh or equivalent update.
- **FR-008**: The system MUST handle catalog or hub load failures gracefully: partial catalog availability and clear, non-misleading feedback to the user or admin (e.g. “skills temporarily unavailable” or “hub X failed to load”).
- **FR-009**: The system MUST enforce access control so that only authorized users can add, update, or remove skill hubs; unauthorized attempts MUST be rejected with a clear permission message.
- **FR-010**: When multiple sources define a skill with the same identifier, the system MUST apply a deterministic, documented resolution rule (e.g. precedence by source or explicit override) so that behavior is predictable.

### Key Entities

- **Skill**: A capability offered to the assistant (e.g. a named action or tool) with a stable identifier, description, and optional parameters; consumed from the shared catalog by the UI and the assistant.
- **Skill catalog (central / shared)**: The single source of truth for available skills; used by the chat UI for display (e.g. `/skills`) and by the platform assistant for execution.
- **Skill hub**: An external source of skills (e.g. a repository) that can be registered so that its skills are merged into the shared catalog; has an identifier, location, optional credentials, and status (e.g. enabled/disabled, last load success/failure).
- **Chat command**: A reserved input (e.g. `/skills`) that triggers a specific in-chat behavior (e.g. showing the list of skills) instead of being sent as a normal user message to the assistant.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can see the same set of available skills in the UI and in the chat command response, with no “run skills” flow in chat; consistency is verifiable by comparing the two surfaces.
- **SC-002**: Users can discover available skills from within the chat in under two actions (e.g. typing the command and viewing the result).
- **SC-003**: After an admin registers an external hub, skills from that hub appear in the shared catalog and in the chat command response within one refresh or documented time window (e.g. within one minute under normal conditions).
- **SC-004**: When the central catalog or a hub is unavailable, users see a clear, non-technical message (e.g. “Skills are temporarily unavailable”) and the chat remains usable for non-skill interactions.
- **SC-005**: Unauthorized attempts to add or remove skill hubs fail with a clear permission message in 100% of tested cases; no hub is added or removed without proper authorization.
- **SC-006**: At least one external hub type (e.g. a public or private repository) is supported for registration; an admin can add a hub and the assistant can use skills from it in a real conversation.

## Assumptions

- “Current skills” refers to the existing skill definitions or catalog used by the platform today; the feature integrates these into a single catalog consumed by both UI and assistant.
- The shared skills layer (“skills middleware”) is the component that aggregates skills from the central store and any registered hubs and exposes them to the UI and the assistant; the exact storage (e.g. database) is an implementation detail.
- The chat command (e.g. `/skills`) is the primary in-chat way to list skills; the exact syntax (e.g. `/skills` vs another slash-command) can be decided during design, but the behavior (show list of skills) is fixed.
- “Skill hub” includes at least one option that is repository-based (e.g. GitHub public or private); other hub types may be added later.
- Only authorized roles (e.g. administrators or configured “skill hub managers”) can register, update, or remove external hubs; end users can only view and use skills.
- The assistant uses the shared catalog for every conversation where skills are relevant; there is no per-conversation or per-user skill list that overrides the shared catalog for normal execution.
