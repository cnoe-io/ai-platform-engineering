# Feature Specification: Configurable Default Agent

**Feature Branch**: `2026-05-08-default-agent-config`
**Created**: 2026-05-08
**Status**: Draft
**Issues**: cnoe-io/ai-platform-engineering#1378

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Admin sets default agent at runtime (Priority: P1)

A platform admin wants to change which agent greets users on the New Chat screen without redeploying the platform. They go to Admin → Settings, pick a dynamic agent from a dropdown, save, and from that moment all users who open a new chat land in that agent's context instead of the supervisor.

**Why this priority**: This is the core ask — runtime control without redeployment. All other stories support this outcome.

**Independent Test**: Admin visits `/admin?tab=settings`, selects a dynamic agent from the "Default agent" dropdown, saves, then opens a new chat tab. The New Chat button label and routing reflect the chosen agent.

**Acceptance Scenarios**:

1. **Given** the admin is on the Settings tab, **When** they select a dynamic agent and click Save, **Then** the setting is persisted and a success confirmation is shown.
2. **Given** a default agent has been saved, **When** any user opens a new chat without manually selecting an agent, **Then** the conversation is routed to the configured default agent.
3. **Given** a default agent is configured, **When** the admin selects "None (use supervisor)" and saves, **Then** new chats revert to the supervisor.

---

### User Story 2 — Operator sets default agent at deploy time via Helm (Priority: P2)

A platform operator deploying via Helm wants to pre-configure a default agent in their values file so it takes effect on first boot without any manual admin action.

**Why this priority**: Enables GitOps and automated deployments. The runtime admin setting takes precedence; the Helm value is the bootstrap default.

**Independent Test**: Deploy with `DEFAULT_AGENT_ID: "<id>"` in Helm values. Open a new chat immediately after install — it routes to the specified agent with no admin UI action required.

**Acceptance Scenarios**:

1. **Given** `DEFAULT_AGENT_ID` is set in Helm values and no admin setting exists in the database, **When** a user opens a new chat, **Then** it routes to the agent specified by the env var.
2. **Given** `DEFAULT_AGENT_ID` is set in Helm values AND an admin has saved a different agent in the UI, **When** a user opens a new chat, **Then** the admin UI setting wins.
3. **Given** neither setting is configured, **When** a user opens a new chat, **Then** it routes to the supervisor (backward-compatible).

---

### User Story 3 — New Chat button reflects the configured default (Priority: P2)

A user sees the New Chat button labelled with the name of the configured default agent rather than the hardcoded "Platform Engineer" label, so they know what they are chatting with.

**Why this priority**: UX consistency — the label is misleading when a non-supervisor default is active.

**Independent Test**: With a custom default agent configured, open the chat interface. The primary New Chat button label matches the configured agent's display name.

**Acceptance Scenarios**:

1. **Given** a custom default agent is configured, **When** a user views the chat interface, **Then** the primary New Chat button shows that agent's name.
2. **Given** no default agent is configured, **When** a user views the chat interface, **Then** the button label remains "Platform Engineer" (no regression).

---

### Edge Cases

- What happens when the configured default agent is deleted? Fall back to supervisor silently; Admin Settings page shows a warning that the configured agent is no longer available.
- What if `DEFAULT_AGENT_ID` env var contains an ID that does not match any registered agent? Fall back to supervisor and log a startup warning.
- What if the platform config store is unavailable when loading New Chat? Fall back to env var, then supervisor; do not block the UI.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow admins to select a default agent from available dynamic agents via the Admin Settings UI.
- **FR-002**: The system MUST persist the admin-selected default agent in the platform configuration store so it survives pod restarts.
- **FR-003**: The system MUST support a `DEFAULT_AGENT_ID` deployment-time configuration option that pre-sets the default agent without requiring manual admin action.
- **FR-004**: The admin-configured database setting MUST take precedence over the deployment-time env var when both are present.
- **FR-005**: When neither setting is present, the system MUST default to the supervisor agent (backward-compatible).
- **FR-006**: The New Chat button label MUST reflect the name of the configured default agent.
- **FR-007**: Admins MUST be able to reset the default to "None (use supervisor)" via the Settings UI.
- **FR-008**: The Admin Settings UI MUST only be accessible to admin-role users.
- **FR-009**: When the configured default agent becomes unavailable, the system MUST fall back to the supervisor and surface a warning in the Admin Settings UI.

### Key Entities

- **Platform Config entry**: A key-value record for platform-wide settings. Key: `default_agent_id`, value: agent ID string or null. Includes `updated_at` timestamp and `updated_by` user identifier.
- **Dynamic Agent**: An agent registered in the platform with a unique ID and display name. The configurable default must reference one of these.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can change the default agent and have it take effect for all users within 30 seconds, without redeploying the platform.
- **SC-002**: A Helm deployment with `DEFAULT_AGENT_ID` pre-set requires zero manual admin actions to activate the configured default on first boot.
- **SC-003**: No regression — existing deployments with neither setting configured continue to route new chats to the supervisor.
- **SC-004**: The New Chat button label correctly reflects the configured default agent on every page load after the setting is saved.

## Assumptions

- Dynamic agents are already registered in the platform before an admin selects one as default.
- Only one global default agent can be configured at a time (no per-team or per-user default in this iteration).
- The platform configuration store is already used for other system-level settings and requires no new infrastructure.
