# Feature Specification: Optional Default Supervisor and Dynamic Agent Metrics

**Feature Branch**: `2026-05-08-optional-supervisor-dynamic-agent-metrics`
**Created**: 2026-05-08
**Status**: Draft
**Issues**: cnoe-io/ai-platform-engineering#1379

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator disables default supervisor at deploy time (Priority: P1)

A platform operator wants to deploy CAIPE with their own custom supervisor agent and not install the built-in one at all. They set `supervisor-agent.enabled: false` in their Helm values and deploy. No default supervisor resources (Deployment, Service, ConfigMap, Secrets) are created. The platform starts and routes new chats to the custom agent they have configured as the default.

**Why this priority**: This is the direct ask of the issue. Without it, operators are forced to deploy an unwanted workload they cannot disable.

**Independent Test**: Deploy with `supervisor-agent.enabled: false`. Verify no supervisor Deployment or Service exists in the namespace. Verify the UI starts without errors.

**Acceptance Scenarios**:

1. **Given** `supervisor-agent.enabled: false` in Helm values, **When** the chart is installed, **Then** no supervisor-agent Deployment, Service, or associated Secrets are created in the cluster.
2. **Given** the supervisor is disabled and a custom default agent is configured, **When** a user opens a new chat, **Then** the conversation routes to the custom agent.
3. **Given** the supervisor is disabled and NO default agent is configured, **When** a user opens a new chat, **Then** the UI shows a clear message that no agent is available rather than a silent failure.
4. **Given** `supervisor-agent.enabled: true` (the default), **When** the chart is installed, **Then** behaviour is identical to today (no regression).

---

### User Story 2 — Admin Skills panel adapts when supervisor is absent (Priority: P1)

An admin opens the Admin panel on a deployment where the supervisor is disabled. The "Supervisor Skills" section either gracefully hides or shows a meaningful "supervisor not installed" state rather than displaying error badges or broken connection indicators.

**Why this priority**: Without this, the Admin panel is broken/misleading when the supervisor is intentionally absent.

**Independent Test**: Deploy without supervisor. Open `/admin?tab=skills`. The Supervisor Skills section should show a disabled/not-installed state rather than "Not connected" error.

**Acceptance Scenarios**:

1. **Given** the supervisor is disabled, **When** an admin opens the Admin Skills panel, **Then** the Supervisor Skills section shows an "Not installed" state with a note that it was disabled at deploy time.
2. **Given** the supervisor is enabled, **When** an admin opens the Admin Skills panel, **Then** the existing Connected/Rebuild UI appears as today (no regression).

---

### User Story 3 — Admin metrics show stats for all dynamic agents, not just supervisor (Priority: P2)

An admin on a deployment that uses dynamic agents (with or without the supervisor) wants to see per-agent usage, latency, and activity statistics in the Admin dashboard. Currently the dashboard is built around supervisor-centric concepts. It should present agent-agnostic metrics that work for any mix of supervisor + dynamic agents.

**Why this priority**: As the supervisor is deprecated in favour of dynamic agents, metrics must evolve. This is a forward-looking requirement that unblocks the full deprecation path.

**Independent Test**: With two dynamic agents active and the supervisor disabled, open Admin → Stats. The "Top agents" section shows entries for each dynamic agent. No "supervisor" entry appears in error state.

**Acceptance Scenarios**:

1. **Given** multiple dynamic agents are handling conversations, **When** an admin views the Stats dashboard, **Then** each active agent appears in the "Top agents by usage" chart with its message count.
2. **Given** the supervisor is disabled, **When** an admin views the Stats dashboard, **Then** no broken supervisor metric appears; the dashboard shows only active agents.
3. **Given** a mix of supervisor and dynamic agents are active, **When** an admin views the Stats dashboard, **Then** both are represented correctly in all charts.
4. **Given** an admin views the Checkpoints section, **When** dynamic agent checkpoints exist, **Then** they appear alongside (or instead of) supervisor checkpoints with correct counts and labels.

---

### User Story 4 — Skills gallery and Import templates work without supervisor (Priority: P2)

A user on a supervisor-disabled deployment opens the Skills gallery and imports template skills. These skills are stored and available to be used with the configured dynamic agents.

**Why this priority**: Skills are not supervisor-exclusive; they must work with any agent. This unblocks the "bring your own supervisor" use case end-to-end.

**Independent Test**: Deploy without supervisor. Open Skills gallery — it loads. Click "Import template skills" — templates are imported into MongoDB. A dynamic agent can reference those skills.

**Acceptance Scenarios**:

1. **Given** the supervisor is disabled, **When** a user opens the Skills gallery, **Then** the gallery loads with hub and agent skills (no supervisor required for display).
2. **Given** the supervisor is disabled, **When** a user imports template skills, **Then** the skills are stored successfully.
3. **Given** the supervisor is disabled, **When** an admin opens Admin → Skills (the Supervisor Skills rebuild section), **Then** a "Not installed" state is shown rather than a connection error.

---

### Edge Cases

- What happens when the supervisor is re-enabled after being disabled? All existing dynamic agent conversations and metrics remain intact; supervisor metrics restart from zero.
- What if a skill was created while the supervisor was disabled and the supervisor is later re-enabled? The skill is still available; the supervisor picks it up on next rebuild.
- What if `A2A_BASE_URL` is unset because the supervisor is disabled? The UI must not break — it should degrade gracefully and only show agents that are configured.

## Requirements *(mandatory)*

### Functional Requirements

**Helm / Infrastructure**

- **FR-001**: The Helm chart MUST provide a `supervisor-agent.enabled` flag (default: `true`) that, when set to `false`, skips creation of all supervisor-agent Kubernetes resources (Deployment, Service, ConfigMap, Secrets, Ingress).
- **FR-002**: When `supervisor-agent.enabled: false`, the `A2A_BASE_URL` environment variable MUST NOT be injected into the caipe-ui ConfigMap (or must be left empty) to prevent the UI from attempting to reach a non-existent service.
- **FR-003**: Disabling the supervisor MUST be backward-compatible — existing deployments with `supervisor-agent.enabled: true` (or unset) MUST behave identically to today.

**Admin UI — Supervisor Skills Section**

- **FR-004**: When the supervisor is not reachable and `A2A_BASE_URL` is unset, the Supervisor Skills section MUST display a "Not installed" or "Disabled" state rather than a connection error.
- **FR-005**: The Rebuild button MUST be hidden or disabled when the supervisor is not installed.

**Admin Metrics — Agent-Agnostic Stats**

- **FR-006**: The "Top agents by usage" metric MUST aggregate usage across ALL agent types (supervisor and dynamic) identified by agent name, not hard-coded to supervisor-only data.
- **FR-007**: The Checkpoints section MUST display checkpoint data for any agent whose checkpoint collections exist, labelled by agent name.
- **FR-008**: Prometheus metrics panels MUST work for any `agent_name` label value, not assume "supervisor" is the primary agent.
- **FR-009**: When the supervisor is absent, no metric panel MUST show a broken/error state due to missing supervisor-specific data; it MUST gracefully show empty or omit the supervisor row.

**Skills**

- **FR-010**: The Skills gallery MUST load and function correctly regardless of whether the supervisor is installed.
- **FR-011**: "Import template skills" MUST succeed regardless of supervisor availability.

### Key Entities

- **Helm Flag**: `supervisor-agent.enabled` (boolean, default `true`). Controls whether supervisor Kubernetes resources are created.
- **Agent Metric Record**: An agent-agnostic stats record identified by `agent_name`. May represent the supervisor, any dynamic agent, or a sub-agent. No record is supervisor-specific.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deployment with `supervisor-agent.enabled: false` produces zero supervisor-agent Kubernetes resources.
- **SC-002**: The Admin panel loads without errors on a supervisor-disabled deployment; no broken connection indicators are shown.
- **SC-003**: Agent usage metrics in the Admin Stats dashboard correctly account for all active agents within one polling cycle of new conversation activity.
- **SC-004**: No regression — all existing supervisor-enabled deployments continue to work identically after this change.
- **SC-005**: Skills gallery and "Import template skills" succeed on a supervisor-disabled deployment with a 100% success rate.

## Assumptions

- Dynamic agents expose their name via `metadata.agent_name` on messages they generate; this field is already present in the message schema.
- Prometheus metrics already use an `agent_name` label; the change is in the admin UI query logic, not in metric instrumentation.
- The supervisor deprecation is a gradual process; this feature enables it but does not remove the supervisor itself.
