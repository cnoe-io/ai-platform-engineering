# Feature Specification: MCP Authorization Resilience

**Feature Branch**: `2026-06-02-mcp-authz-resilience` (spec authored on `main`, no feature branch yet)  
**Created**: 2026-06-02  
**Status**: Draft  
**Input**: User description: "Make MCP server availability robust on default installs: bake a configurable ext_authz timeout default into AgentGateway across install paths, add bounded transient-retry reconcile when loading MCP tools so cold-start auth timeouts self-heal, and reclassify transient not-ready vs permanent failures in the agent availability messaging"

## Context & Problem

On a fresh install, the SRE/agent chat reports **every** MCP server as *"is unavailable. Tools from this server will not work."* even though the MCP servers are healthy and the user is authorized.

Root cause: AgentGateway gates each `/mcp/<server>` route behind an OpenFGA external-authorization (ext_authz) check, configured to fail **closed** (HTTP 403) on error. AgentGateway's default ext_authz timeout is **200ms**. When the agent enumerates tools it triggers one authz check per MCP route **concurrently**; against a cold or loaded authorization path those checks queue and each takes 75–150ms+, so the slower ones exceed the 200ms budget, time out, and return 403. The agent runtime makes a **single** connection attempt per server and treats any failure — transient timeout or permanent misconfiguration — identically, surfacing the alarming permanent-sounding warning.

Two gaps must be closed so this does not recur on default installs:

1. The aggressive 200ms default is not overridden anywhere in the shipped configuration, so it bites every new deployment.
2. There is no distinction between "still warming up / transient" and "genuinely misconfigured," and no self-healing retry, so a brief cold-start race looks like a hard failure.

> **Note on current state**: A development hotfix raising the timeout to 10s has already been applied to the local Docker Compose path (`deploy/agentgateway/config.yaml` and `config_bridge.py`) and validated live. This spec makes that fix a durable default across install paths and adds the resilience behavior.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default install has working MCP tools (Priority: P1)

An operator installs the platform with default settings and opens the agent chat. The configured MCP servers (argocd, github, jira, etc.) are reachable and the user is authorized, so the agent can list and call their tools without a wall of "unavailable" warnings.

**Why this priority**: This is the reported defect. Without it, a brand-new install looks broken even when everything is healthy and correctly authorized — the worst possible first impression.

**Independent Test**: Deploy with defaults, send a query that enumerates tools, and confirm no MCP server that is healthy and authorized is reported as unavailable.

**Acceptance Scenarios**:

1. **Given** a default install where all MCP backends are healthy and the user is authorized, **When** the agent enumerates tools across all routes concurrently, **Then** no healthy/authorized MCP server is reported as unavailable.
2. **Given** the default static routing mode, **When** the gateway configuration is rendered, **Then** the ext_authz timeout is set to a value well above the authorization path's typical latency (default 10s), not the 200ms built-in default.
3. **Given** an operator who wants to tune the value, **When** they set the documented timeout configuration value, **Then** the rendered gateway configuration reflects their value.

---

### User Story 2 - Cold-start slowness self-heals (Priority: P2)

Right after startup, the authorization path (OpenFGA + its datastore) is cold and slow. The first tool enumeration may still see some checks exceed even a generous budget. Instead of permanently marking those servers failed, the agent retries transient failures so the servers become available without manual intervention.

**Why this priority**: The timeout increase shrinks the race window but cannot eliminate it (cold datastores, a still-booting MCP backend, momentary load). Self-healing makes the system robust rather than merely less fragile.

**Independent Test**: Simulate a transient connection error (timeout / 5xx / connection reset / authz-timeout 403) for a server on the first attempt and a success on retry; confirm the server ends up available and is not listed as failed.

**Acceptance Scenarios**:

1. **Given** an MCP server whose first tool-load attempt fails with a transient error, **When** the runtime loads tools, **Then** it retries with backoff up to a bounded limit before giving up.
2. **Given** a transient failure that succeeds on retry, **When** loading completes, **Then** the server is reported as available and its tools are usable.
3. **Given** a permanent failure (e.g., misconfigured endpoint, unknown host), **When** the runtime loads tools, **Then** it does not waste the full retry budget on an obviously-permanent error and fails fast.

---

### User Story 3 - Honest "not ready" vs "failed" messaging (Priority: P3)

When a server still cannot load after retries, the user sees a message that tells the truth about *why*: a transient/not-ready condition is presented as "still starting up — will retry," while a genuine misconfiguration is presented as a failure that needs attention. The blanket "Tools from this server will not work" is reserved for genuine, non-recoverable failures.

**Why this priority**: Accurate status prevents users from concluding the product is broken during a normal warm-up, and points operators at real problems when they exist.

**Independent Test**: Drive both a transient-classified failure and a permanent-classified failure; confirm the emitted user-facing message differs appropriately and that a reconnect/refresh path is offered for the transient case.

**Acceptance Scenarios**:

1. **Given** a server that failed only with transient errors, **When** the warning is emitted, **Then** it conveys a temporary/not-ready state and indicates it will be retried, rather than a permanent failure.
2. **Given** a server that failed with a permanent error, **When** the warning is emitted, **Then** it conveys a configuration/availability problem that needs attention.
3. **Given** a transiently-unavailable server, **When** the user retries the conversation or the runtime reconnects, **Then** the server can become available without restarting the platform.

### Edge Cases

- **All servers transiently fail** on the very first cold enumeration: messaging should read as "warming up," and a subsequent attempt should recover.
- **A backend is genuinely not running** (no container/pod): after retries it is classified permanent (connection refused / unknown host), not "warming up forever."
- **Authorization legitimately denies** a user (true 403 from a policy decision, not a timeout): this MUST remain a denial and MUST NOT be masked as "warming up" or retried into success.
- **Mixed outcomes**: some servers available, some transient, some permanent — each is reported with its own correct status.
- **Retry must not blow up enumeration latency**: total added delay from retries is bounded so a healthy enumeration stays fast.
- **Fail-closed posture preserved**: raising the timeout and adding retries MUST NOT turn authorization fail-open.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The shipped configuration MUST set the AgentGateway ext_authz timeout to a value greater than the authorization path's typical concurrent-burst latency, defaulting to **10s**, for the **default (static) routing** install path.
- **FR-002**: The ext_authz timeout MUST be operator-configurable via a documented value (`global.agentgateway.extAuth.timeout`) without editing templates, and MUST default to `10s` when unset.
- **FR-003**: The local development install path (Docker Compose bootstrap config and the config-bridge runtime reconcile) MUST carry the same default so dev and production stay consistent.
- **FR-004**: Raising the timeout MUST NOT change the authorization failure posture: ext_authz MUST remain fail-closed (deny) on genuine errors.
- **FR-005**: When loading MCP tools, the runtime MUST retry **transient** failures (request timeout, connection reset/refused-after-connect, 5xx, and authz-timeout 403) with bounded backoff before marking a server failed.
- **FR-006**: The retry behavior MUST be bounded (max attempts and total added latency) so that a healthy enumeration is not materially slowed and a permanent failure is not retried needlessly.
- **FR-007**: The runtime MUST classify each unrecoverable server failure as **transient/not-ready** or **permanent**, based on the observed error.
- **FR-008**: User-facing availability messaging MUST reflect the classification: transient → a "still starting up / temporarily unavailable, will retry" message; permanent → a "failed to load — needs attention" message. The blanket permanent warning MUST NOT be used for transient conditions.
- **FR-009**: A genuine authorization denial (policy decision, not a timeout) MUST be reported as a denial and MUST NOT be retried into success nor relabeled as "warming up."
- **FR-010**: The opt-in Gateway-API/CRD routing path MUST be **documented** (the `AgentgatewayPolicy.traffic.extAuth` policy has no timeout field; operators tune it via backend `requestTimeout` or route request timeout). No automated change is required for this path in this feature.
- **FR-011**: The RBAC reference documentation MUST be updated to record the new timeout configuration knob and its default (per the repository's RBAC living-documentation rule).

### Key Entities *(configuration, not data)*

- **ext_authz timeout setting**: The per-route external-authorization request timeout applied by the gateway; default 10s; configurable; applies to the default static install path and the dev compose path.
- **MCP server load outcome**: The result of attempting to load a server's tools — available, transiently-unavailable (not ready, retryable), or permanently-failed (needs attention).
- **Failure classification**: The mapping from an observed connection/authorization error to {transient, permanent, denied}.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fresh default install where all MCP backends are healthy and the user is authorized, **0** healthy/authorized MCP servers are reported as unavailable after the system has warmed up.
- **SC-002**: A transient first-attempt failure that would succeed on retry results in the server being available **without any manual restart or operator action**.
- **SC-003**: A healthy tool enumeration completes with **no more than a small bounded increase** in latency attributable to retries (retries add no delay on the success path).
- **SC-004**: For a server that cannot load, the user-facing message correctly distinguishes "still starting up / temporarily unavailable" from "failed — needs attention" in **100%** of tested transient vs permanent cases.
- **SC-005**: A genuine authorization denial is still surfaced as a denial in **100%** of tested cases (no fail-open, no mislabeling).
- **SC-006**: The timeout default is present in the default static install render and the dev compose path, and is overridable via the documented configuration value.

## Assumptions

- Default routing mode is `static`; the Gateway-API/CRD mode is opt-in and only documented here (per decision).
- The authorization path can answer a single check well under 10s once warm; 10s is headroom, not an expected latency.
- The existing reconnect/refresh path (runtime cache invalidation) remains available for users to recover transient servers between messages.
- "Transient" error detection can be derived from existing error messages/types already surfaced by the MCP client layer.

## Out of Scope

- Increasing OpenFGA/authz-bridge concurrency or otherwise re-architecting the authorization datastore for throughput (a separate, optional root-cause optimization).
- Reconciling the dynamic-agents "legacy MCP servers conflict with AgentGateway targets" registry banner (tracked separately).
- Any change to the Gateway-API/CRD routing behavior beyond documentation.
