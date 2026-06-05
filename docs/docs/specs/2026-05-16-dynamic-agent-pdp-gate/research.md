# Phase 0 Research: Dynamic Agent PDP Gate

## Decision: Use OpenFGA `can_use` on `agent:<agent_id>` for execution authorization

**Rationale**: The existing ReBAC model already represents agent access as `team:<slug>#member can_use agent:<agent_id>` and allows direct `user:<sub> can_use agent:<agent_id>` relationships. This matches the feature requirement: execution is allowed when the caller has a relationship to the selected Dynamic Agent. It keeps data-plane authorization in OpenFGA rather than adding a second Keycloak UMA policy surface.

**Alternatives considered**:

- Keycloak UMA `dynamic_agent#invoke`: rejected because the user corrected that this feature must use OpenFGA as the PDP.
- Reuse legacy visibility rules only: rejected because the feature requires relationship-based PDP enforcement at both the boundary and runtime.
- Add a new `can_invoke` relation to agent resources: rejected for now because the model already uses `can_use` for agent use and existing Team Resources writes that relation.

## Decision: Enforce at both the BFF boundary and Dynamic Agents runtime

**Rationale**: The boundary gate prevents unnecessary backend calls and returns fast, structured authorization failures. The runtime gate provides defense in depth if traffic reaches Dynamic Agents directly or a policy changes between the boundary decision and runtime work. This follows the constitution's security-by-default principle.

**Alternatives considered**:

- BFF only: rejected because runtime work could still start if the service is reached outside the BFF path.
- Runtime only: rejected because unauthorized requests would still reach the runtime service and lose the user-facing BFF error handling path.
- AgentGateway-only: rejected because this feature protects Dynamic Agent execution routes, not only downstream MCP tool calls.

## Decision: Require a validated bearer token for runtime OpenFGA checks

**Rationale**: Dynamic Agents already validates bearer JWTs and binds the raw token to request context. Runtime authorization can safely derive the caller subject from a token that middleware has already validated. Requests without a bearer must not satisfy the runtime PDP gate through a trusted header alone.

**Alternatives considered**:

- Trust `X-User-Context` for runtime authorization: rejected because it is a legacy identity propagation path and should not be the source for a PDP decision.
- Call a userinfo endpoint for every authorization decision: rejected because the validated JWT already contains the stable subject required for OpenFGA checks.

## Decision: Keep cancellation authentication-only

**Rationale**: Cancellation stops work. Requiring a fresh agent-use relationship for cancellation can strand running work after a policy change. Authentication is still required so anonymous callers cannot cancel work.

**Alternatives considered**:

- Gate cancellation with `can_use`: rejected because it creates operational risk and does not start or continue agent work.
- Make cancellation public: rejected because cancel requests affect user and system work.

## Decision: Fail closed on OpenFGA outages for execution paths

**Rationale**: If the PDP cannot answer, the system cannot prove the caller may use the selected agent. Start, invoke, and resume must deny with a retryable authorization-service outcome and must not start runtime work.

**Alternatives considered**:

- Fail open using cached UI or role state: rejected because it could allow restricted agent execution during a PDP outage.
- Fall back to Keycloak role checks: rejected because this feature's source of truth is relationship-based agent access.

## Decision: Track OpenFGA route coverage separately from Keycloak RBAC semantics

**Rationale**: The existing matrix validator is oriented around Keycloak `resource#scope` checks. OpenFGA checks use tuple relationships such as `user:<sub> can_use agent:<id>`. The plan should either extend the matrix with an explicit OpenFGA convention or add focused ReBAC validation tests; it must not pretend concrete `agent:<id>` resources are Keycloak realm resources.

**Alternatives considered**:

- Force OpenFGA checks into `dynamic_agent#invoke` matrix entries: rejected because it obscures the actual PDP and decision shape.
- Skip drift detection: rejected by the spec requirement for route coverage and the repository's RBAC documentation rules.
