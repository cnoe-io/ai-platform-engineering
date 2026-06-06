# Phase 0 Research: MCP Authorization Resilience

All open questions were resolved by maintainer decisions plus a schema verification against the running AgentGateway. No `NEEDS CLARIFICATION` markers remain.

## Decision 1 — ext_authz timeout value & configurability

- **Decision**: Default the AgentGateway ext_authz timeout to **10s**, operator-configurable via `global.agentgateway.extAuth.timeout`.
- **Rationale**: The built-in default is 200ms. Tool enumeration fires one ext_authz `Check` per MCP route concurrently; against a cold/loaded OpenFGA path these serialize and individually exceed 200ms, returning fail-closed 403s seen as "unavailable". 10s is generous headroom (≈50× a warm check) while still bounding a stuck call. Exposing a value lets operators tune without editing templates.
- **Alternatives considered**:
  - *5s default* — tighter, still 25× the old budget; rejected as the primary default because cold datastores can briefly exceed it and the goal is "never looks broken on first install". Left available via the knob.
  - *Hardcode 10s* — simplest, but operators with very slow or very fast authz paths can't tune; rejected for a one-line values knob.
  - *Fail-open on timeout* — rejected outright; violates Security-by-Default (FR-004).

## Decision 2 — where the timeout is applied (schema-verified)

- **Decision**: Static routing path sets `extAuthz.timeout`. Dev compose path mirrors it. CRD path is **documented only**.
- **Rationale / findings**:
  - AgentGateway **v0.12.0** (compose) rejects `extAuthz.policies.http.requestTimeout` ("unknown field policies"). The correct field is **`extAuthz.timeout: "10s"`** — verified live by a successful config reload. This is what the dev hotfix uses.
  - The chart's static-config template renders the same `extAuthz` block, so it takes `timeout` identically.
  - The Gateway-API/CRD `AgentgatewayPolicy.traffic.extAuth` has **no** `timeout` field (proposed in kgateway PR #13202 but dropped in favor of backend-level `requestTimeout`). So the CRD path cannot express this on the policy; operators tune it via the authz-bridge backend `requestTimeout` or a route request timeout.
- **Alternatives considered**: Patching the CRD path automatically — rejected (no policy field; default routing is static; out-of-scope per decision). Documented instead (FR-010).

## Decision 3 — reconcile (retry) vs not-ready messaging

- **Decision**: Do **both** — bounded transient-retry in `get_tools_with_resilience`, and reclassified transient/permanent messaging in `agent_runtime`.
- **Rationale**: The timeout bump shrinks but cannot eliminate the cold-start race (cold datastore, still-booting backend, momentary load). Retry self-heals; classification makes the residual case honest instead of alarming.
- **Retry shape**: bounded attempts (default **3** total) with short exponential backoff (e.g. ~0.25s → ~0.5s, jittered), only for **transient** errors; permanent errors fail fast (no wasted budget). Total added worst-case delay kept to a small bounded value so healthy enumeration is unaffected (success path does zero retries).
- **Alternatives considered**:
  - *Timeout bump only* — leaves a visible cold-start failure window; rejected by decision (chose "both").
  - *Unbounded/long retries* — rejected; would balloon init latency and mask permanent faults.

## Decision 4 — transient vs permanent vs denied classification

- **Decision**: Classify each failed load by inspecting the already-extracted error message/type:
  - **Transient (retry, then "not ready")**: request/connect timeout, connection reset/refused-*after-connect*, 5xx, and **authz-timeout 403** (the gateway's fail-closed-on-timeout signature).
  - **Permanent (fail fast, "needs attention")**: unknown host / name resolution failure, connection refused with no listener, 404 (no route), malformed config.
  - **Denied (never retried, surfaced as denial)**: a genuine policy 401/403 that is *not* a timeout.
- **Rationale**: Reuses `_extract_error_message` / `_diagnose_endpoint_failure` already present in `mcp_client.py`; keeps detection in one helper (Rule of Three). Distinguishing authz-timeout-403 from policy-403 is the crux — the gateway timeout path is identifiable from the diagnostic/connection signature vs a clean policy denial.
- **Alternatives considered**: Treat all 403 as transient — rejected; would retry real denials and risk masking them (violates FR-009). Treat all failures as permanent — the current behavior, the defect we're fixing.

## Open risks

- **403 disambiguation**: If the gateway's authz-timeout and a clean policy-deny are indistinguishable from the client side, default to **not** retrying 403 unless corroborated by a timeout/connection signal, to preserve FR-009. The contract documents this conservative bias.
- **Version skew**: compose runs proxy v0.12.0; chart default image is v1.1.0. `extAuthz.timeout` is valid in both (timeout predates the dropped CRD field); render check + a compose smoke test cover this.
