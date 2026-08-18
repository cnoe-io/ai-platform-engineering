# CAIPE Authorization Service

`caipe-authz` is CAIPE's canonical authorization decision and policy service.
It runs beside the legacy BFF evaluator and OpenFGA bridge until scoped rollout
configuration transfers authority.

## Interfaces

- HTTP `POST /v1/decisions` and `POST /v1/decisions:batch`
- Envoy gRPC `envoy.service.auth.v3.Authorization/Check` on port 9191
- Typed policy administration under `/v1/admin/policies`
- Bounded model, relationship, graph, Check, and simulation inspection
- `/healthz`, `/readyz`, and `/metrics`

The only v1 runtime provider is `openfga-cel`. Cedar and OPA are registered as
disabled future providers. Clients cannot select the provider or migration mode.

## Migration

`AUTHZ_ROLLOUT_JSON` is immutable deployment configuration. Its default mode is
`LEGACY`. Supported scope modes are `LEGACY`, `SHADOW`, `CANARY`, `AUTHZ`, and
`AUTHZ_ONLY`. Expression `enforce` is rejected until the owning scope is
`AUTHZ` or `AUTHZ_ONLY` and names an owner.

Batch calls use the same deployment router as single calls. `SHADOW` preserves
legacy authority; `AUTHZ` compares legacy asynchronously but never falls back;
`AUTHZ_ONLY` does not invoke legacy.

Removing a legacy evaluator is a separate deployment decision. Use
`migration.retirement.evaluate_legacy_retirement` to require every surface
scope to remain `AUTHZ_ONLY` for the approved retention interval and to verify
that a compatible Authz release rollback is available.

## Expression activation

Policy CRUD is available before enforcement, but an expression policy remains
`DRAFT` and writes no conditional tuple unless all of these are true:

- Its rollout selector is an exact `agentgateway` / `tool` / `invoke` scope.
- The scope mode is `AUTHZ` or `AUTHZ_ONLY`.
- The scope has `expression_mode: enforce` and an owner.
- `OPENFGA_AUTHORIZATION_MODEL_ID` is pinned.
- Every exact resource has a trusted entry in
  `CAIPE_TOOL_SCHEMA_HASHES_JSON`.

`expression_mode: off` and `shadow` are non-mutating control-plane states.
Routing rollback and policy deletion remain separate operations.

## Authentication and audit

- HTTP supports a bound internal service token and configured JWT validation.
- Envoy gRPC requires `AUTHZ_SERVICE_TOKEN`; insecure headers are local-dev only.
- Admin policy and inspection APIs require `AUTHZ_ADMIN_TOKEN`.
- Authoritative decisions and mutations use a bounded SQLite outbox.
- Policy and relationship events are journaled atomically.
- Argument values, condition constants, bearer tokens, and request bodies are
  rejected from normalized audit payloads.

## Local validation

```bash
uv sync --project ai_platform_engineering/authz
uv run --project ai_platform_engineering/authz ruff check ai_platform_engineering/authz
uv run --project ai_platform_engineering/authz pytest --cov=ai_platform_engineering.authz --cov-fail-under=80
RUN_OPENFGA_E2E=1 uv run --project ai_platform_engineering/authz pytest \
  ai_platform_engineering/authz/tests/integration/test_openfga_e2e.py
```

The service fails closed on invalid input, OpenFGA timeout/unavailability,
saturation, missing trusted context, and strict audit-journal failure.
