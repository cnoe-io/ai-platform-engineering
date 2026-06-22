# OpenFGA Authz Bridge

A small gRPC server that implements Envoy's `envoy.service.auth.v3.Authorization/Check`
and translates Check requests into OpenFGA Check API calls.

Used by AgentGateway (configured as an `ext_authz` target) to enforce ReBAC
policies on agent traffic, with optional audit-service event forwarding.

## Source layout

- `main.py` — gRPC server entrypoint
- `audit.py` — optional audit-service event writer
- `tests/` — pytest suite for the chart and the bridge itself

## Local development

Dependencies are managed with [uv](https://docs.astral.sh/uv/):

```bash
uv sync          # install runtime + dev deps
uv run pytest    # run tests
uv run python main.py
```

The Dockerfile builds with `uv sync --locked --no-dev` for reproducible images.
