# OpenFGA Authz Bridge

A small gRPC server that implements Envoy's `envoy.service.auth.v3.Authorization/Check`
and translates Check requests into OpenFGA Check API calls.

Used by AgentGateway (configured as an `ext_authz` target) to enforce ReBAC
policies on agent traffic, with optional audit-service event forwarding.

## Conditional exact-tool context

The bridge provides the transitional runtime adapter for reviewed OpenFGA
conditions while context construction moves to caipe-authz:

1. Named CEL conditions are authored and reviewed in ../model.fga at build time.
2. A conditional tuple stores administrator-controlled field, allowlist, and
   expected schema-hash constants.
3. For tools/call, the bridge parses bounded duplicate-key-safe JSON and
   projects scalar arguments to RFC 6901 pointer maps.
4. The bridge obtains the current schema hash from deployment-owned trusted
   configuration and supplies it with the argument maps as OpenFGA Check
   context.
5. OpenFGA evaluates the condition. The bridge does not execute CEL.

Context is sent only to exact caller and agent tool checks. Coarse gateway,
server, agent-use, and wildcard checks remain context-free.

Relevant configuration:

| Environment variable | Purpose |
|---|---|
| OPENFGA_AUTHORIZATION_MODEL_ID | Optional explicit model pin for Check |
| CAIPE_TOOL_SCHEMA_HASHES_JSON | Trusted map of exact server/tool references to sha256-prefixed schema hashes |
| CAIPE_TOOL_POLICY_MAX_BODY_BYTES | Maximum MCP body parsed for authorization; default 65536 |
| CAIPE_TOOL_POLICY_MAX_CONTEXT_BYTES | Maximum projected OpenFGA context; default 16384 |

Setting CAIPE_TOOL_SCHEMA_HASHES_JSON enables conditional exact-tool context.
The bridge then fails startup unless caller tool checks, the signed agent-context
secret, and an explicit OpenFGA model ID are also configured. The Helm chart
enforces the same invariant at render time.

If an exact tool has no trusted schema hash, the bridge sends no conditional
context. A conditional path therefore cannot allow that request. Existing
unconditional paths retain their normal OpenFGA semantics.

If a configured request cannot be projected within the conditional context
limits, the bridge sends well-typed empty argument maps. This makes the current
condition false while preserving an existing unconditional grant during
migration.

This mapping is transitional. Production schema lookup and caching belong in
caipe-authz; callers must never provide the authoritative schema hash.

## Source layout

- `main.py` — gRPC server entrypoint
- `audit.py` — optional audit-service event writer
- `tests/` — pytest suite for the chart and the bridge itself

## Local development

Dependencies are managed with [uv](https://docs.astral.sh/uv/):

```bash
uv sync          # install runtime + dev deps
uv run pytest    # run tests
RUN_OPENFGA_E2E=1 uv run pytest tests/test_conditions_e2e.py
uv run python main.py
```

The Dockerfile builds with `uv sync --locked --no-dev` for reproducible images.
