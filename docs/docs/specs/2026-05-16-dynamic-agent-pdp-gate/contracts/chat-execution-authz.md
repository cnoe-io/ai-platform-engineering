# Contract: Dynamic Agent Execution Authorization

## Protected Operations

The following operations require both authentication and an allow decision for the selected Dynamic Agent:

| Operation | Path | Authorization relationship |
|-----------|------|----------------------------|
| Start streaming execution | `POST /api/v1/chat/stream/start` | `user:<subject> can_use agent:<agent_id>` |
| Non-streaming invocation | `POST /api/v1/chat/invoke` | `user:<subject> can_use agent:<agent_id>` |
| Resume interrupted execution | `POST /api/v1/chat/stream/resume` | `user:<subject> can_use agent:<agent_id>` |

The following operation requires authentication only. It intentionally does not require a fresh
`can_use` decision because cancellation stops work rather than starting or continuing execution:

| Operation | Path | Authorization relationship |
|-----------|------|----------------------------|
| Cancel active stream | `POST /api/v1/chat/stream/cancel` | None for this feature |

## Request Requirements

### Start streaming execution

Required fields:

- `agent_id`
- `conversation_id`
- `message`

Optional fields:

- `protocol`
- `trace_id`
- `client_context`

### Non-streaming invocation

Required fields:

- `agent_id`
- `conversation_id`
- `message`

Optional fields:

- `trace_id`
- `client_context`

### Resume interrupted execution

Required fields:

- `agent_id`
- `conversation_id`
- `resume_data`

Optional fields:

- `protocol`
- `trace_id`

### Cancel active stream

Required fields:

- `agent_id`
- `conversation_id`

## Response Requirements

### Allowed

- Protected execution requests are forwarded to Dynamic Agents only after the boundary authorization check allows the caller.
- Dynamic Agents starts, invokes, or resumes runtime work only after its runtime authorization check allows the caller.

### Unauthorized

Authentication failure response:

```json
{
  "success": false,
  "error": "You are not signed in. Please sign in to continue.",
  "code": "NOT_SIGNED_IN",
  "reason": "not_signed_in",
  "action": "sign_in"
}
```

Runtime missing-bearer response:

```json
{
  "success": false,
  "error": "Bearer token is required",
  "code": "missing_bearer",
  "reason": "not_signed_in",
  "action": "sign_in"
}
```

### Forbidden

Authorization denial response:

```json
{
  "success": false,
  "error": "Permission denied",
  "code": "agent#use",
  "reason": "pdp_denied",
  "action": "contact_admin"
}
```

### Authorization service unavailable

Retryable authorization-service response:

```json
{
  "success": false,
  "error": "Authorization service is temporarily unavailable. Please try again in a moment.",
  "code": "PDP_UNAVAILABLE",
  "reason": "pdp_unavailable",
  "action": "retry"
}
```

## Non-Execution Guarantee

For start, invoke, and resume requests, every denied or unavailable authorization outcome must terminate before any agent runtime is created, resumed, or invoked.
