# OpenFGA + AgentGateway `ext_authz` (small experiment)

This folder adds a **minimal** stack so you can try **HTTP `ext_authz`** on AgentGateway with **OpenFGA** as the PDP, without adopting `openfga-envoy` (gRPC Envoy bridge) yet.

## What runs

| Piece | Role |
|-------|------|
| `openfga-exp-postgres` | Durable OpenFGA metadata |
| `openfga-exp-migrate` | One-shot DB migration |
| `openfga-exp` | OpenFGA API (HTTP `:8080`, gRPC `:8081`, Playground `:3000` **inside** the container) |
| `openfga-exp-init` | Creates store `caipe-openfga-experiment`, writes authorization model, optional tuple |
| `openfga-authz-bridge` | Small FastAPI service — AGW calls `http://openfga-authz-bridge:9100/check`; bridge decodes JWT `sub` (unverified, **dev only**) and calls OpenFGA `Check` |

Published ports (host): **8082** (OpenFGA HTTP), **8083** (gRPC), **3001** (Playground), **9100** (bridge).

## Important: two gates

With `deploy/agentgateway/config.openfga-experiment.yaml`, **every** MCP request must pass:

1. **`extAuthz`** → OpenFGA `user:<sub> can_call document:mcp`
2. **Existing `mcpAuthorization` CEL** (spec 104 rules)

So you need **both** a seeded OpenFGA tuple **and** normal Keycloak realm roles for your user.

## Quick start

1. **Set your Keycloak user `sub`** (from any access token — jwt.io):

   ```bash
   export OPENFGA_EXPERIMENT_SUB="<uuid-from-token-sub-claim>"
   ```

2. **Swap AGW config** (reversible):

   ```bash
   cp deploy/agentgateway/config.openfga-experiment.yaml deploy/agentgateway/config.yaml
   ```

3. **Bring up** OpenFGA + bridge **with** the usual dev stack (`rbac` profile so `agentgateway` exists):

   ```bash
   docker compose -f docker-compose.dev.yaml -f docker-compose.openfga-experiment.yaml \
     --profile rbac up -d openfga-exp-postgres openfga-exp-migrate openfga-exp \
     openfga-exp-init openfga-authz-bridge agentgateway
   ```

4. **Exercise MCP through AGW** as usual (`http://localhost:4000`). If OpenFGA denies, you get **403** after JWT + CEL would have passed.

## Escape hatch (bypass OpenFGA only)

If you need to prove the wire without tuples, set subs that always get HTTP 200 from the bridge:

```bash
export OPENFGA_BYPASS_SUBS="<sub1>,<sub2>"
```

Restart `openfga-authz-bridge` with that env.

## Revert

```bash
git checkout -- deploy/agentgateway/config.yaml
docker compose -f docker-compose.dev.yaml -f docker-compose.openfga-experiment.yaml --profile rbac stop openfga-authz-bridge openfga-exp openfga-exp-migrate openfga-exp-init openfga-exp-postgres
```

(Adjust if you use `down`.)

## Security warnings

- The bridge **does not verify JWT signatures** — it only base64-decodes the payload for `sub`. Acceptable **only** on a private Docker network where AGW has already enforced `jwtAuth: strict`. For production, use **gRPC `ext_authz`** with `metadata` carrying verified claims, or verify JWT in the bridge with JWKS.
- **Do not** expose port `9100` to the public internet.

## Next steps (out of scope here)

- Replace HTTP bridge with **gRPC** + [`openfga-envoy`](https://github.com/openfga/openfga-envoy) or a thin in-house Envoy `Check` implementation.
- Map `mcp.tool.name` and `jwt.active_team` into OpenFGA checks (this demo uses a single `document:mcp` object).
- Shadow mode (CEL vs OpenFGA disagree metric) — not implemented in this minimal experiment.
