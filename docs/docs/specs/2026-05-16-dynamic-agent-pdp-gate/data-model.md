# Data Model: Dynamic Agent PDP Gate

## Caller

Represents the authenticated actor attempting Dynamic Agent work.

**Fields**

- `subject`: Stable identity used in relationship checks.
- `email`: Human-readable identity used for logs and support messages.
- `auth_method`: Session or bearer authentication path.
- `bearer_present`: Whether a validated bearer token is available for runtime enforcement.

**Validation rules**

- Execution requests require an authenticated caller.
- Runtime OpenFGA checks require a validated bearer-backed subject.
- Anonymous callers cannot start, invoke, resume, or cancel Dynamic Agent work.

## Dynamic Agent

Represents a runnable agent resource protected by relationship-based access.

**Fields**

- `agent_id`: Stable identifier used as the relationship-check object.
- `name`: Display name used in logs and operator-facing diagnostics.
- `visibility_metadata`: Existing agent metadata remains available but is not sufficient for this feature's PDP decision.

**Relationships**

- A caller may use an agent when OpenFGA allows `user:<subject> can_use agent:<agent_id>`.
- Team access may imply caller access through existing team-member relationships.

**Validation rules**

- A missing or malformed `agent_id` is a request validation error.
- A non-existent `agent_id` follows existing not-found behavior and must not start runtime work.

## Agent-Use Relationship

Represents the policy fact that grants use of a Dynamic Agent.

**Fields**

- `subject`: Direct user subject or an indirect team membership subject.
- `relation`: `can_use`.
- `object`: Dynamic Agent resource identifier.

**Relationships**

- Direct: `user:<subject> can_use agent:<agent_id>`.
- Team-derived: `user:<subject> member team:<slug>` and `team:<slug>#member can_use agent:<agent_id>`.

**Validation rules**

- Start, invoke, and resume require an allow decision for the selected agent.
- Deny means runtime work must not start or continue.
- Unavailable means fail closed with a retryable authorization-service outcome.

## Execution Request

Represents a user action targeting Dynamic Agent work.

**Fields**

- `operation`: One of start, invoke, resume, cancel.
- `agent_id`: Target Dynamic Agent.
- `conversation_id`: Conversation or runtime context.
- `message`: User input for start and invoke operations.
- `resume_data`: Human-in-the-loop continuation data for resume operations.

**State transitions**

```text
received
  -> authenticated
  -> authorized
  -> runtime_started_or_resumed
```

Denied path:

```text
received
  -> authenticated
  -> denied
  -> terminal_no_runtime_work
```

Unavailable path:

```text
received
  -> authenticated
  -> pdp_unavailable
  -> terminal_no_runtime_work
```

Cancel path:

```text
received
  -> authenticated
  -> cancellation_attempted
```

**Validation rules**

- Start requires `message`, `conversation_id`, and `agent_id`.
- Invoke requires `message`, `conversation_id`, and `agent_id`.
- Resume requires `conversation_id`, `agent_id`, and `resume_data`.
- Cancel requires `conversation_id` and `agent_id`, but does not require a fresh `can_use` decision.

## Authorization Decision

Represents the decision outcome used to allow or deny execution.

**Fields**

- `allowed`: Whether the caller may use the selected agent.
- `reason`: One of allowed, denied, unavailable, unauthenticated, invalid_request.
- `action`: Optional user-facing recovery action such as sign in, retry, or contact administrator.
- `enforcement_point`: Boundary service or Dynamic Agents runtime.

**Validation rules**

- Allowed decisions may proceed to runtime work.
- Denied decisions return an authorization denial and stop processing.
- Unavailable decisions return a retryable authorization-service error and stop processing.
- Unauthenticated decisions return an authentication error and stop processing.
