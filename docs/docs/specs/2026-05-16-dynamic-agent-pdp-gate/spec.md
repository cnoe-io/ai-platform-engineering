# Feature Specification: Dynamic Agent PDP Gate

**Feature Branch**: `release/0.5.1`  
**Created**: 2026-05-16  
**Status**: Draft  
**Input**: User description: "Implement layered OpenFGA PDP gates for Dynamic Agent execution so unauthorized callers are denied before agent runtime work starts."

## User Scenarios & Testing *(mandatory)*

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ### User Story 1 - Block Unauthorized Agent Runs (Priority: P1)

As a platform administrator, I need Dynamic Agent execution to be blocked for users who do not have permission to use the selected agent, so restricted agents cannot be started through browser, Slack, or direct service paths.

**Why this priority**: This is the core security outcome. Without it, users can start agent work before relationship-based policy is enforced.

**Independent Test**: Configure one user with access to an agent and one user without access. Attempt to start or invoke that agent as each user and verify only the authorized user reaches agent execution.

**Acceptance Scenarios**:

1. **Given** a user has permission to use a selected Dynamic Agent, **When** the user starts a streaming run, **Then** the request is allowed and agent execution begins.
2. **Given** a user does not have permission to use a selected Dynamic Agent, **When** the user starts a streaming run, **Then** the request is denied and no agent execution begins.
3. **Given** a user does not have permission to use a selected Dynamic Agent, **When** the user performs a non-streaming invocation, **Then** the request is denied and no agent execution begins.
4. **Given** a user does not have permission to use a selected Dynamic Agent, **When** the user resumes an interrupted run, **Then** the resume attempt is denied and runtime work does not continue.

---

### User Story 2 - Preserve Safe Cancellation (Priority: P2)

As an operator or end user, I need authenticated users to be able to cancel their in-flight Dynamic Agent runs even if their ability to invoke the agent has changed, so long-running or unwanted work can be stopped safely.

**Why this priority**: Cancellation reduces operational risk and cost. Blocking cancellation due to a policy change could leave work running unnecessarily.

**Independent Test**: Start a run as an authenticated user, remove or withhold agent-use permission, and verify the user can still request cancellation while new execution attempts remain denied.

**Acceptance Scenarios**:

1. **Given** an authenticated user has an in-flight Dynamic Agent run, **When** the user sends a cancel request, **Then** the system accepts the cancellation request without requiring a new agent-use authorization decision.
2. **Given** an unauthenticated caller sends a cancel request, **When** the request is processed, **Then** the system rejects the request as unauthenticated.

---

### User Story 3 - Report Authorization Failures Clearly (Priority: P3)

As a user or support engineer, I need denied and temporarily unavailable authorization decisions to produce clear, structured responses, so the UI, Slack surfaces, and troubleshooting workflows can explain the outcome without starting an agent run.

**Why this priority**: Clear failure handling reduces confusion and prevents generic backend errors from hiding policy or authorization-service issues.

**Independent Test**: Exercise denied, unavailable, and unauthenticated cases for each protected execution path and verify the returned status and reason match the expected category.

**Acceptance Scenarios**:

1. **Given** a caller is authenticated but not allowed to use the selected agent, **When** the caller starts, invokes, or resumes the agent, **Then** the response identifies the denial as an authorization denial.
2. **Given** the authorization decision service is temporarily unavailable, **When** a caller starts, invokes, or resumes an agent, **Then** the response identifies the issue as a retryable authorization-service outage.
3. **Given** the caller is not authenticated, **When** the caller starts, invokes, resumes, or cancels an agent run, **Then** the response identifies the issue as an authentication failure.

---

### Edge Cases

- A caller is authenticated but the selected agent identifier does not exist; the system must not disclose more information than existing agent lookup behavior allows.
- A caller has permission at the browser or Slack boundary but loses permission before the Dynamic Agents runtime check; the runtime check must deny before starting or continuing agent work.
- The authorization decision service is unavailable at either enforcement layer; execution must fail closed and return a retryable authorization-service error.
- A request includes malformed or missing required execution fields; validation errors must be returned without starting agent execution.
- A cancellation request arrives after the run has already completed or no runtime is found; the response must remain safe and must not require a new agent-use decision.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST require an authenticated caller before any Dynamic Agent start, invoke, resume, or cancel request is accepted.
- **FR-002**: The system MUST verify that an authenticated caller is allowed to use the selected Dynamic Agent before forwarding a start, invoke, or resume request from the boundary service to the Dynamic Agents runtime.
- **FR-003**: The Dynamic Agents runtime MUST independently verify that the authenticated caller is allowed to use the selected agent before creating, resuming, or invoking runtime work.
- **FR-004**: The system MUST deny Dynamic Agent start, invoke, and resume requests when the caller lacks the agent-use relationship for the selected agent.
- **FR-005**: The system MUST fail closed when the authorization decision service is unavailable for start, invoke, or resume requests.
- **FR-006**: The system MUST return distinguishable outcomes for unauthenticated callers, unauthorized callers, and temporarily unavailable authorization decisions.
- **FR-007**: The system MUST preserve authenticated cancellation behavior without requiring the caller to pass a new agent-use authorization decision.
- **FR-008**: The system MUST ensure denied start, invoke, and resume requests do not create, resume, or otherwise execute Dynamic Agent runtime work.
- **FR-009**: The system MUST include automated coverage for allowed, denied, authorization-service unavailable, unauthenticated, and cancel-only behaviors.
- **FR-010**: The system MUST update canonical RBAC documentation so operators can understand the Dynamic Agent authorization flow, enforcement points, and verification steps.
- **FR-011**: The system MUST include drift detection or equivalent validation so protected Dynamic Agent execution routes remain represented in RBAC or ReBAC test coverage.

### Key Entities *(include if feature involves data)*

- **Caller**: An authenticated person or service attempting to start, invoke, resume, or cancel Dynamic Agent work.
- **Dynamic Agent**: A runnable agent resource that may be available to some callers and unavailable to others based on relationship policy.
- **Agent-Use Relationship**: The authorization relationship that grants a caller permission to use a specific Dynamic Agent.
- **Execution Request**: A start, invoke, resume, or cancel request targeting a Dynamic Agent and conversation context.
- **Authorization Decision**: The allow, deny, or temporarily unavailable result used to decide whether execution may proceed.

### Assumptions

- Relationship-based authorization is the source of truth for per-agent execution access.
- Start, invoke, and resume operations are considered execution operations and must be gated before runtime work.
- Cancel remains authentication-only for this feature because it stops work rather than starting or continuing work.
- Runtime enforcement is required even when the boundary service already made an allow decision.
- Existing authentication, user identity propagation, and agent-not-found behavior remain in scope only where needed to enforce this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of unauthorized start, invoke, and resume attempts are denied before agent runtime work begins.
- **SC-002**: 100% of authorized start, invoke, and resume attempts continue to work for callers with the required agent-use relationship.
- **SC-003**: 100% of authorization-service outage cases for protected execution paths return a retryable authorization-service outcome rather than starting agent work.
- **SC-004**: 100% of cancellation requests from authenticated callers are handled without requiring a fresh agent-use authorization decision.
- **SC-005**: Automated tests cover all protected execution paths for allow, deny, unavailable decision service, and unauthenticated outcomes.
- **SC-006**: Canonical RBAC documentation identifies every enforcement point and every auth-relevant file added or changed by this feature.
