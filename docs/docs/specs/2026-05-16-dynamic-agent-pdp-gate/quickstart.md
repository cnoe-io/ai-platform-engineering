# Quickstart: Dynamic Agent PDP Gate

## Goal

Verify that Dynamic Agent execution is allowed only when the caller can use the selected agent, and that denied or unavailable authorization decisions happen before runtime work starts.

## Prerequisites

- The RBAC/OpenFGA development stack is available.
- A test user with access to a Dynamic Agent exists.
- A test user without access to that Dynamic Agent exists.
- Dynamic Agents receives validated bearer identity for runtime enforcement.

## Configuration

Enable the runtime identity and authorization path for Dynamic Agents:

```bash
DA_REQUIRE_BEARER=true
OPENFGA_HTTP=http://openfga:8080
OPENFGA_STORE_NAME=caipe-openfga
```

Use `OPENFGA_STORE_ID` when the environment pins a store id directly.

## Focused Verification

### UI route tests

```bash
cd ui
npm test -- --runTestsByPath \
  src/lib/rbac/__tests__/openfga-agent-authz.test.ts \
  src/lib/__tests__/da-proxy-auth-result.test.ts \
  src/app/api/v1/chat/__tests__/routes.test.ts \
  src/lib/streaming/__tests__/stream-error.test.ts
```

Expected result:

- Protected execution routes allow authorized callers.
- Protected execution routes deny unauthorized callers without proxying to Dynamic Agents.
- Protected execution routes return retryable authorization-service errors when OpenFGA is unavailable.
- Cancel remains authentication-only.

### Dynamic Agents tests

```bash
cd ai_platform_engineering/dynamic_agents
uv run pytest tests/test_openfga_authz.py tests/test_chat_pdp_gate.py tests/test_jwt_middleware.py -v
```

Expected result:

- Start, invoke, and resume call the runtime only after an allow decision.
- Deny and unavailable decisions stop before runtime work.
- Missing bearer returns an authentication error for runtime authorization.
- Cancel remains ungated by OpenFGA.

### RBAC/ReBAC drift check

```bash
python3 scripts/validate-rbac-matrix.py --print
```

Expected result:

- Keycloak-oriented RBAC checks remain valid.
- OpenFGA route coverage lists the three Dynamic Agent execution gates without treating concrete agent identifiers as Keycloak realm resources.

## Manual Demo

1. Sign in as a user with access to the selected Dynamic Agent.
2. Start a streaming run and verify the agent begins work.
3. Sign in as a user without access to the same Dynamic Agent.
4. Attempt streaming start, non-streaming invoke, and resume.
5. Verify each protected operation returns a denial and no runtime work starts.
6. Stop or cancel an in-flight run as an authenticated user and verify cancellation remains available.

## Documentation Check

Confirm the canonical RBAC docs describe:

- Boundary and runtime enforcement points.
- OpenFGA `can_use` relationship semantics for Dynamic Agent execution.
- Auth-relevant files changed by this feature.
- Operator configuration for runtime enforcement.
