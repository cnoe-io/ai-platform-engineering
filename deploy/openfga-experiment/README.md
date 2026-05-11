# OpenFGA + AgentGateway `ext_authz` dev stack

This folder contains the OpenFGA seed model and HTTP bridge used by the
`docker-compose.dev.yaml` `rbac` profile. AgentGateway calls the bridge through
HTTP `ext_authz`; the bridge adapts that request to an OpenFGA `Check`.

## What runs

| Piece | Role |
|-------|------|
| `openfga-postgres` | Durable OpenFGA metadata |
| `openfga-migrate` | One-shot DB migration |
| `openfga` | OpenFGA API (HTTP `:8080`, gRPC `:8081`, Playground `:3000` **inside** the container) |
| `openfga-init` | Creates store `caipe-openfga`, writes authorization model, optional tuple |
| `openfga-authz-bridge` | Small FastAPI service — AGW calls `http://openfga-authz-bridge:9100/check`; bridge decodes JWT `sub` (unverified, **dev only**) and calls OpenFGA `Check` |

Published host ports are bound to localhost only: **8082** (OpenFGA HTTP),
**8083** (gRPC), **3002** (Playground), **9100** (bridge).

## Important: two gates

With the default `deploy/agentgateway/config.yaml`, **every** MCP request must pass:

1. **`extAuthz`** → OpenFGA `user:<sub> can_call document:mcp`
2. **Existing `mcpAuthorization` CEL** (spec 104 rules)

So you need **both** a seeded OpenFGA tuple **and** normal Keycloak realm roles for your user.

## Quick start

1. **Set your Keycloak user `sub`** (from any access token — jwt.io):

   ```bash
   export OPENFGA_SEED_SUB="<uuid-from-token-sub-claim>"
   ```

2. **Bring up** OpenFGA + bridge **with** the usual dev stack (`rbac` profile so `agentgateway` exists):

   ```bash
   docker compose -f docker-compose.dev.yaml --profile rbac up -d \
     openfga-postgres openfga-migrate openfga openfga-init \
     openfga-authz-bridge agentgateway
   ```

3. **Exercise MCP through AGW** as usual (`http://localhost:4000`). If OpenFGA denies, you get **403** before the request reaches the MCP backend.

## Escape hatch (bypass OpenFGA only)

If you need to prove the wire without tuples, set subs that always get HTTP 200 from the bridge:

```bash
export OPENFGA_BYPASS_SUBS="<sub1>,<sub2>"
```

Restart `openfga-authz-bridge` with that env.

## Security warnings

- The bridge **does not verify JWT signatures** — it only base64-decodes the payload for `sub`. Acceptable **only** on a private Docker network where AGW has already enforced `jwtAuth: strict`. For production, use **gRPC `ext_authz`** with `metadata` carrying verified claims, or verify JWT in the bridge with JWKS.
- **Do not** expose port `9100` to the public internet.

## Next steps (out of scope here)

- Replace HTTP bridge with **gRPC** + [`openfga-envoy`](https://github.com/openfga/openfga-envoy) or a thin in-house Envoy `Check` implementation.
- Map `mcp.tool.name` and `jwt.active_team` into OpenFGA checks (this demo uses a single `document:mcp` object).
- Shadow mode (CEL vs OpenFGA disagree metric) — not implemented in this minimal experiment.
