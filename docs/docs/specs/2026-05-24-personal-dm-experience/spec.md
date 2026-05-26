# Feature Specification: Personal DM Experience for Slack and Webex Bots

**Feature Branch**: `main` (in-flight; this spec lives on `main` alongside the active RBAC work)
**Created**: 2026-05-24
**Status**: Draft
**Input**: User description: "DM users get a meaningful, agentic, permission-aware experience"

## Context

Direct messages (DMs) to the CAIPE Slack and Webex bots are today the weakest surface in the product. A DM:

- Bypasses channel ReBAC entirely (no channel-team mapping exists for a DM)
- Routes every user to the same single agent picked by a deployment-wide environment variable (`SLACK_INTEGRATION_DM_AGENT_ID` or its Webex equivalent)
- Cannot be personalized — a user with access to ten agents still gets the one the operator chose at deploy time
- Cannot be steered — a user cannot say "use the GitHub agent for this question" without leaving the DM and opening the Web UI

This spec defines the work to make DMs a first-class, personalized, permission-aware agent surface, while preserving the existing security model.

**Scope is DM-only.** Group channels and team-mapped spaces continue to use the existing channel-ReBAC + channel-mapped-agent path with no behavioral change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Set a default agent for my DMs (Priority: P1)

As a CAIPE user, when I DM the bot from Slack or Webex, I want to be talking to my preferred agent by default — not whichever agent the deployment was configured with — so my bot conversations match the work I actually do.

**Why this priority**: This is the foundation. Without per-user preference, every DM goes to the same configured agent regardless of the user, and personalization is impossible. It is also the smallest independently shippable slice — once it works, every other phase builds on the same preference storage.

**Independent Test**: A user with `can_use` on at least two different agents picks one as their DM default in the Web UI settings. They DM the bot, send a message, and the response comes from the agent they picked — verified by the agent name surfaced in the reply and the audit log of which agent the bot dispatched to. Reverting the preference (clearing it or choosing a different agent) is reflected on the next DM with no restart.

**Acceptance Scenarios**:

1. **Given** a user who has access to multiple agents and no preference set, **When** the user DMs the bot, **Then** the bot dispatches to the deployment's configured default DM agent and the response identifies that agent.
2. **Given** a user who has set agent X as their DM default, **When** the user DMs the bot, **Then** the bot dispatches to agent X for that user (and only that user — other users are not affected).
3. **Given** a user whose saved DM default is agent X but whose `can_use` permission on X has since been revoked, **When** the user DMs the bot, **Then** the bot falls through to the deployment default (or, if the deployment default is also forbidden, to a platform-level fallback), and the user receives a clear, non-blaming message explaining the preference was no longer valid and was bypassed.
4. **Given** a user changes their DM default mid-session, **When** the user sends the next DM, **Then** the new preference is used without requiring a sign-out or restart.
5. **Given** the per-user preference service is temporarily unavailable, **When** the user DMs the bot, **Then** the bot falls back to the deployment default DM agent and the DM still succeeds (graceful degradation, not a hard failure).

---

### User Story 2 — See which agents I can use (Priority: P2)

As a CAIPE user, when I DM the bot, I want to see the list of agents I have permission to use, so I can make an informed choice when I set my default or invoke an agent ad-hoc.

**Why this priority**: This is the discovery surface for Stories 1 and 3. Without it, users have no way to know what to pick — they would have to guess agent IDs or leave Slack/Webex to look them up in the Web UI. The list must reflect their real, per-user permissions, not the deployment catalog.

**Independent Test**: A user issues a discovery action in the bot DM (a slash command in Slack; a comparable text command or mention in Webex) and receives an ephemeral list of agents. The list contains exactly the agents for which the user has `can_use` permission and excludes every agent they don't — verified by comparing the list against an admin view of the user's `can_use` agent set. Two users in the same workspace with different permissions see different lists.

**Acceptance Scenarios**:

1. **Given** a user with access to three agents, **When** the user issues the "list my agents" command in a DM, **Then** the bot replies (ephemerally to the user only) with the three agent names and short descriptions, and no other agents are visible.
2. **Given** the same user, **When** the user's permission on one of those agents is revoked while they are still in the DM session, **Then** issuing the command again returns a list that no longer contains the revoked agent.
3. **Given** a user with access to zero agents, **When** the user issues the command, **Then** the bot replies with a helpful message explaining no agents are currently accessible and how to request access.
4. **Given** the permission-list service is unavailable, **When** the user issues the command, **Then** the bot replies with a clear "unable to list right now, try again shortly" message rather than a blank reply or a silent failure.

---

### User Story 3 — Talk to a specific agent in this DM (Priority: P2)

As a CAIPE user, when I DM the bot and want a specific question answered by a specific agent (e.g., "ask the GitHub agent about this PR"), I want to invoke that agent directly for this conversation without changing my saved default — and the system must still enforce that I have permission to use that agent.

**Why this priority**: This is the explicit-control affordance. Setting a default (Story 1) covers the steady-state case; Story 3 covers "for this one question I want a different agent." It is independently testable and independently valuable — a user could ship and use the system with Story 3 alone (always invoke explicitly) or Story 1 alone (always rely on default). Together they form the complete UX.

**Independent Test**: A user issues a "use this agent for this thread" command in a DM with an agent identifier they have access to, sends a follow-up message, and the follow-up is dispatched to the chosen agent. Sending a message after the override expires (timeout or new conversation) returns to the user's default. Issuing the command with an agent the user does not have permission to use is rejected with a clear, non-blaming message and does not change any state.

**Acceptance Scenarios**:

1. **Given** a user with access to agent X, **When** the user issues "use agent X for this thread" in a DM and then sends a message, **Then** the message is dispatched to agent X (not to the user's saved default or the deployment default).
2. **Given** the same user, **When** they continue messaging in the same thread, **Then** subsequent messages also go to agent X until the override is cleared or expires.
3. **Given** a user without permission to agent Y, **When** the user issues "use agent Y for this thread", **Then** the bot replies with a clear "you don't have access to agent Y" message and the user's existing default is preserved unchanged.
4. **Given** a user who has set an explicit thread override, **When** the user starts a new DM conversation (new thread), **Then** the override does not carry over and the new conversation uses the user's saved default (or deployment default).
5. **Given** a user issues an explicit override, **When** the bot restarts mid-conversation, **Then** the override is treated as expired and the next message returns to the saved default. The user is not silently sent to a different agent without notification.

---

### Edge Cases

- A user has never visited the Web UI but DMs the bot from Slack. They have no saved preference. The bot must use the deployment default and must not error.
- A user sets a DM default in the Web UI to an agent that requires a Slack-channel-mapping context (e.g., an agent intentionally not available in personal mode). The system must surface this constraint at preference-set time, not silently at DM time. If the preference is saved and later becomes invalid (the agent is reconfigured to be channel-only), the bot must gracefully fall back as in Scenario 1.3.
- A user is signed into Slack but has not completed CAIPE identity link. The bot cannot resolve their Keycloak identity and therefore cannot read their preference. The bot must use the deployment default and emit a one-time, ephemeral nudge inviting the user to complete identity linking.
- A user types a command typo (e.g., `/use githbu-agent` instead of `/use github-agent`). The bot must reply with a friendly correction or suggestion, not silently ignore or silently route to the default.
- Two users DM the bot simultaneously, each with different defaults. Their messages are dispatched to their respective default agents with no cross-contamination of per-user state.
- A user has a thread override active, then issues the same command again with a different agent. The override is updated, not stacked or duplicated.
- The user's permission list is large (e.g., 50+ agents). The discovery command must paginate or otherwise present the list without overflowing the Slack message size limit.
- A user's permission to their saved default is revoked while they are mid-thread with that agent. The thread completes its current turn with whatever transport is already in flight, and the next user message in that thread falls through to the new effective default with a one-line ephemeral notice.

## Requirements *(mandatory)*

### Functional Requirements

**Phase 1 — Per-user default DM agent**

- **FR-001**: The system MUST persist, per user, a "DM default agent" preference value that survives bot restarts, Web UI restarts, and user sessions.
- **FR-002**: The system MUST let an authenticated user view and update their own DM default agent preference through a dedicated, discoverable surface in the Web UI settings area.
- **FR-003**: The Web UI MUST let users pick their DM default only from agents the user currently has permission to use; the list MUST NOT contain agents the user is not authorized for.
- **FR-004**: The Web UI MUST clearly show which agent will be used when the user has no preference set (the deployment default), so a user understands what "clear my preference" reverts to.
- **FR-005**: The Slack and Webex bots MUST, on every DM message, resolve the dispatch agent in this order: (1) the user's saved DM default if the user still has permission to use it, (2) the deployment-configured DM default agent, (3) the deployment-configured fallback (or supervisor / platform default agent if defined).
- **FR-006**: The bot MUST re-verify, at DM dispatch time, that the user has permission to use the resolved agent. A saved preference does not bypass authorization.
- **FR-007**: If a user's saved preference is bypassed because permission was revoked or the agent no longer exists, the user MUST receive a single, ephemeral, non-blaming notice in that DM explaining the fallback. The notice MUST NOT block the request — the bot still responds via the fallback agent.
- **FR-008**: The user-preference lookup MUST be cached briefly per user inside the bot process to keep DM latency low. The cache MUST honor preference changes within an acceptable freshness window (no longer than a few minutes without explicit invalidation).
- **FR-009**: If the preference-storage backend is unavailable, the bot MUST fall back gracefully to the deployment default and MUST NOT fail the DM. An operational signal (log + health surface) MUST be emitted so operators can detect the degradation.

**Phase 2 — Explicit commands in DMs**

- **FR-010**: The Slack bot MUST expose a discovery command that, when issued in a DM, returns to the issuing user (ephemerally) the list of agents they have permission to use, with human-readable names and short descriptions.
- **FR-011**: The Slack bot MUST expose a command to choose an agent for the current DM thread (an explicit override), accepting an agent identifier as its argument.
- **FR-012**: The Slack bot MUST expose a help command in DMs that explains the available commands and what they do.
- **FR-013**: The Webex bot MUST provide equivalent functionality for discovery, explicit override, and help. The exact syntax may differ (Webex has no native slash commands), but the user must be able to accomplish the same three tasks (list, choose, help) without leaving the DM.
- **FR-014**: An explicit override MUST be scoped to the user's current DM thread. It MUST NOT affect other threads of the same user, other users in the same workspace, or the user's saved DM default preference.
- **FR-015**: When a user issues an explicit override for an agent they do not have permission to use, the bot MUST refuse the override with a clear message and MUST NOT silently fall through to the default.
- **FR-016**: An explicit override MUST expire when the DM thread ends, when the bot process restarts, or after a bounded inactivity period (whichever comes first). On expiry, the user's next message returns to their saved default.
- **FR-017**: The discovery command MUST return only agents the requesting user has permission to use, verified at command-execution time, not from a cached snapshot.
- **FR-018**: All commands MUST be rate-limited per user to prevent abuse and to protect downstream permission lookups.
- **FR-019**: Command output MUST be ephemeral (visible only to the issuing user) wherever the chat platform supports it, so it does not pollute the DM history or expose other users' permissions in shared contexts.

**Cross-cutting**

- **FR-020**: All user-visible bot messages described in this spec (notices, error messages, denials, help text) MUST be consistent across Slack and Webex in tone and content, and MUST use the existing user-message templating infrastructure rather than ad-hoc literal strings in code.
- **FR-021**: Every dispatch decision (which agent the bot chose, why) MUST be logged in structured form including the user identifier, the resolved agent identifier, the source of the decision (saved-preference, explicit-override, deployment-default, fallback), and any permission re-check outcomes. Logs MUST NOT contain user message content.
- **FR-022**: This feature MUST NOT change the dispatch behavior for non-DM contexts (group channels, team-mapped spaces). The channel-ReBAC + channel-mapped-agent path remains the source of truth for those surfaces.

### Key Entities

- **DM Agent Preference**: A per-user setting indicating the user's preferred default agent for direct messages to the bot. Key attributes: owning user, chosen agent identifier, timestamp last updated, the user-facing source label ("your preference" / "deployment default" / "fallback") returned alongside it. Lifecycle: created on first set; updated on user change; deleted (or marked cleared) on user-initiated clear or on automated cleanup if the referenced agent is permanently removed from the platform.
- **DM Thread Agent Override**: A short-lived, per-thread association indicating that the user has explicitly chosen a non-default agent for this thread. Key attributes: owning user, thread identifier, chosen agent identifier, expiry. Not persisted across bot restarts. Bounded in scope to the originating DM thread; never propagates to other threads or other users.
- **Accessible Agents List**: A per-user, point-in-time list of agents the user has `can_use` permission for, used to populate the Web UI picker and the bot discovery command. Sourced from the authoritative permission system; not separately stored as a user-owned record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can set a DM default agent in the Web UI and see the result in a follow-up DM within 30 seconds, without any restart of the bot or the Web UI.
- **SC-002**: 100% of bot DM dispatches honor the user's saved preference when that preference references an agent the user is still authorized to use.
- **SC-003**: 100% of bot DM dispatches that would have used a no-longer-authorized preference fall back gracefully to the deployment default, and the user receives exactly one ephemeral notice per fallback occurrence (not per message in a session).
- **SC-004**: The DM discovery command returns the user's accessible-agents list within 2 seconds for users with up to 50 accessible agents.
- **SC-005**: After a thread override, 100% of subsequent messages in the same thread route to the chosen agent until the override expires or the thread ends.
- **SC-006**: 0 cases of cross-user state leakage: a user's preference, override, or accessible-agents list never affects another user's DM dispatch decision.
- **SC-007**: When the preference-storage backend is unavailable, DM messages still succeed (using the deployment default) at a rate of at least 99% over the outage window, with no user-visible hard failure attributable to this feature.
- **SC-008**: Command latency for the help and discovery commands stays under 1 second at the p95 in steady state.
- **SC-009**: 0 reports of an unauthorized agent being reachable via the DM commands — verified by integration tests that exercise revoked permissions, never-granted permissions, and partially-overlapping team scopes.
- **SC-010**: Documentation (in-product help text + user-facing docs) covers the three primary user journeys (set default, list agents, override per thread) for both Slack and Webex.

## Phasing and Independent Deliverability

Each phase is independently shippable and independently valuable:

- **Phase 1 (User Stories 1; FR-001 through FR-009 and FR-020 through FR-022)**: Per-user DM default agent, set via Web UI, honored by both bots, with permission re-verification and graceful fallback. Delivers immediate value: every user can personalize their DM agent. Does not require any new command surface in the bots.
- **Phase 2 (User Stories 2 and 3; FR-010 through FR-019)**: Slack slash commands and Webex command equivalents for discovery, explicit override, and help, backed by an authorization-aware accessible-agents lookup. Delivers in-DM control: a user can list and pick without leaving the chat. Builds on Phase 1's preference store for the "revert to my default" semantics but is not blocked on it for the override/list flows.

A user who only has Phase 1 deployed still gets personalized DMs (via the Web UI). A user who only has Phase 2 deployed (hypothetical) still gets in-DM agent control. Both deployed together is the complete experience.

## Out of Scope

- **Supervisor-style LLM auto-routing in DMs.** This spec explicitly does not introduce a "platform engineer supervisor" agent as the DM target. That is a separate design decision tracked elsewhere; if it is taken, it would be modeled as one possible choice for the user's DM default, not as a replacement for explicit selection.
- **Per-user agent permissions management.** This spec assumes the existing permission system is the source of truth for "which agents can a user use." Granting or revoking permissions is out of scope; this feature only consumes the existing decision.
- **Group-channel and team-mapped-space behavior.** No changes to channel-ReBAC, channel-mapped agents, team-scoped agent routing, or any non-DM dispatch path.
- **Cross-platform thread continuity.** If a user starts a DM in Slack and later DMs the same agent in Webex, those are independent threads. Continuity across platforms is not in scope.
- **Web UI chat default.** The Web UI's own "platform default agent" setting is unrelated and remains operator-managed. The DM default may default to the same agent for consistency, but the two settings are independent.

## Assumptions

- The authoritative permission system can answer "which agents can this user use" efficiently enough to power both the Web UI picker and the in-DM discovery command, including listing all such agents (not just checking a specific one).
- A per-user preference store exists in the platform's data layer that can hold one additional field per user without a schema migration affecting unrelated features.
- Slack DM detection and Webex DM detection are reliable signals already used by the bots; this spec does not redefine what counts as a DM.
- The bots can call back into the platform's BFF authenticated as the user-on-behalf-of context (the same OBO mechanism used today for channel dispatch authorization).
- The Slack workspace operator is willing and able to update the Slack app manifest to register new slash commands as part of deploying Phase 2; this is a one-time installation step, not a per-user action.

## Dependencies

- Existing per-user OBO token-exchange flow used by the Slack and Webex bots for DMs. Phase 1 reads the user's preference using this same identity context.
- Existing OpenFGA-backed permission system that already answers `can_use agent:<id>` for a given user. Phase 2 additionally requires a "list all such agents for this user" capability.
- Existing user-settings storage and Web UI settings panel architecture. This feature adds a section to that surface rather than introducing a new settings home.
- Existing identity-link prerequisite: the bot must be able to resolve the chatting user to a CAIPE user identity before it can read their preference or check their permissions.

## Open Questions

None at this time. All requirements are stated as testable expectations and the scope boundaries are explicit. If a [NEEDS CLARIFICATION] is identified during planning or implementation, it should be raised back to this spec rather than resolved silently in code.
