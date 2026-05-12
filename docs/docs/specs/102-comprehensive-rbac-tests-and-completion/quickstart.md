# Quickstart: Comprehensive RBAC Tests

**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md)

This is the developer-facing usage doc for the new `make test-rbac` target and the `tests/rbac/` test infrastructure introduced by this spec. It exists so a new contributor can run, debug, and extend the RBAC test suite without reading the spec end-to-end.

---

## TL;DR

```bash
make test-rbac
```

Runs Jest BFF tests + pytest middleware tests + Playwright E2E suite against a real Keycloak. Should take ≤ 10 minutes locally on M-series Mac.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Docker / Docker Desktop | latest | Stands up Keycloak + Mongo + supervisor + DA + RAG + UI + 1 MCP. |
| Node.js | 20+ | Jest + Playwright + UI dev. |
| Python | 3.11+ (3.13 in Docker) | pytest. |
| `uv` | latest | Python virtualenv management. |
| `kcadm` | comes with Keycloak image | Used by `init-idp.sh` to seed personas; you do not invoke it directly. |

All server-side dependencies are brought up by reusing the existing `docker-compose.dev.yaml` with a curated `COMPOSE_PROFILES` selection (see [spec Clarification 2026-04-22](./spec.md#session-2026-04-22) — there is **no** separate `docker-compose.e2e.yaml` and no overlay file). The e2e lane activates a handful of `${VAR:-default}` substitutions inside `docker-compose.dev.yaml` (host port for Mongo/supervisor, the `RBAC_FALLBACK_*` env+volume, and `E2E_RUN=true`) by exporting env vars from the Makefile (`E2E_COMPOSE_ENV`). Locally you only need Docker + Node + Python.

---

## E2E port band

The e2e lane publishes services on a non-overlapping host-port band so it can coexist with a running dev stack without collisions. **`caipe-ui` is the one exception** — it must always publish on host port `3000` because Keycloak's `caipe-ui` client only allow-lists `http://localhost:3000/*` as a redirect URI (see `deploy/keycloak/realm-config.json`). Remapping the UI breaks the OIDC redirect dance and makes login impossible.

| Service           | Container port | Dev host port | E2E host port | Why this port? |
|-------------------|----------------|---------------|---------------|----------------|
| `caipe-ui`        | 3000           | 3000          | **3000**      | IdP-pinned. Never remap. |
| `caipe-mongodb`   | 27017          | 27017         | 28017         | Avoid colliding with a host-side MongoDB on `27017`. |
| `caipe-supervisor`| 8000           | 8000          | 28000         | Avoid colliding with `agent-splunk` (also publishes `8010` from the same compose project). |
| `keycloak`        | 7080 / 7443    | 7080 / 7443   | 7080 / 7443   | Dev publishes these; e2e reuses the same singleton — one IdP for both lanes. |
| `dynamic-agents`  | 8001           | 8100          | 8100          | Not remapped (no collisions). |
| `rag_server`      | 9446           | 9446          | 9446          | Not remapped (no collisions). |

The band is **`28xxx` for the in-stack e2e remaps**. If you need to add another service to the e2e remap list in the future, pick a port in the same band (`280xx`–`289xx`) so the convention stays predictable.

### How it's wired

The Makefile owns the env-var contract. `make test-rbac-up` exports `E2E_COMPOSE_ENV` and runs the dev compose file unchanged:

```makefile
# Makefile (excerpt — see the full target near "Comprehensive RBAC tests")
E2E_MONGODB_HOST_PORT    ?= 28017
E2E_SUPERVISOR_HOST_PORT ?= 28000

E2E_COMPOSE_ENV := \
  E2E_RUN=true \
  MONGODB_HOST_PORT=$(E2E_MONGODB_HOST_PORT) \
  SUPERVISOR_HOST_PORT=$(E2E_SUPERVISOR_HOST_PORT) \
  RBAC_FALLBACK_FILE=$(CURDIR)/deploy/keycloak/realm-config-extras.json \
  RBAC_FALLBACK_CONFIG_PATH=/etc/keycloak/realm-config-extras.json

test-rbac-up:
	@$(E2E_COMPOSE_ENV) COMPOSE_PROFILES='$(E2E_PROFILES)' \
	   docker compose -f docker-compose.dev.yaml up -d --wait
```

Inside `docker-compose.dev.yaml`, each affected port is `${VAR:-default}` so the dev path is byte-identical when those env vars are unset:

```yaml
caipe-mongodb:
  ports:
    # MONGODB_HOST_PORT=28017 in the e2e lane; 27017 in dev.
    - "${MONGODB_HOST_PORT:-27017}:27017"

caipe-supervisor:
  ports:
    - "${SUPERVISOR_HOST_PORT:-8000}:8000"
  environment:
    - RBAC_FALLBACK_CONFIG_PATH=${RBAC_FALLBACK_CONFIG_PATH:-}
  volumes:
    # Defaults to /dev/null — a harmless inode mount the helper never reads
    # because RBAC_FALLBACK_CONFIG_PATH is empty in the dev path.
    - ${RBAC_FALLBACK_FILE:-/dev/null}:/etc/keycloak/realm-config-extras.json:ro

caipe-ui:
  ports: ["3000:3000"]    # NEVER parameterize — IdP-pinned.
  environment:
    - E2E_RUN=${E2E_RUN:-false}
```

### Env-var contract (what `E2E_COMPOSE_ENV` activates)

| Env var                       | Dev default | E2E value                                         | Effect when set |
|-------------------------------|-------------|---------------------------------------------------|-----------------|
| `E2E_RUN`                     | `false`     | `true`                                            | Enables Playwright-only fixtures in the UI (`ui/src/lib/test-fixtures.ts`). |
| `MONGODB_HOST_PORT`           | `27017`     | `28017`                                           | Host port published by `caipe-mongodb`. |
| `SUPERVISOR_HOST_PORT`        | `8000`      | `28000`                                           | Host port published by `caipe-supervisor`. |
| `RBAC_FALLBACK_FILE`          | `/dev/null` | `$(CURDIR)/deploy/keycloak/realm-config-extras.json` | Host file bind-mounted into supervisor / dynamic-agents / rag_server at `/etc/keycloak/realm-config-extras.json`. |
| `RBAC_FALLBACK_CONFIG_PATH`   | `""` (empty)| `/etc/keycloak/realm-config-extras.json`          | Tells the in-container helper *which* file to read for the PDP-unavailable fallback. Empty = feature off. |

### Verifying the dev path is unaffected

```bash
# Should print mongo:27017, supervisor:8000, ui:3000, RBAC_FALLBACK="" (empty).
docker compose -f docker-compose.dev.yaml config | \
  grep -E '(published|RBAC_FALLBACK|E2E_RUN)' | head -20

# Same compose file, e2e env applied — should print 28017 / 28000 / 3000 / true.
make test-rbac-up
docker ps --format '{{.Names}}\t{{.Ports}}' | grep caipe-
```

---

## First-time setup

```bash
# Repo root
cd /Users/<you>/.../ai-platform-engineering

# Python venv (only needed once)
uv venv --python python3.13 --clear .venv
uv sync

# UI deps (only needed once)
cd ui && npm ci && cd ..

# Pre-pull Keycloak image so the first test run is faster
docker pull quay.io/keycloak/keycloak:25.0
```

---

## Daily usage

### Run everything
```bash
make test-rbac
```

This is what CI runs. Locally it brings up the dev compose file with `COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot"` (with e2e env vars from `E2E_COMPOSE_ENV` in the Makefile), seeds personas, runs all three test layers, then tears the stack down.

### Run only one layer
```bash
make test-rbac-jest      # ~2 min  - BFF unit tests
make test-rbac-pytest    # ~3 min  - middleware tests + integration with stub MCP
make test-rbac-e2e       # ~4 min  - Playwright against full compose stack
```

### Run one user story (e.g., Story 4 — RAG)
```bash
make test-rbac-e2e -- --grep "User Story 4"
```

Equivalent for Jest: `make test-rbac-jest -- --testNamePattern "User Story 4"`.

### Bring up the e2e stack without running tests (debugging)
```bash
# Easiest — wraps the env vars + profiles for you:
make test-rbac-up

# Or by hand:
export COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot"
export E2E_RUN=true
export MONGODB_HOST_PORT=28017
export SUPERVISOR_HOST_PORT=28000
export RBAC_FALLBACK_FILE="$PWD/deploy/keycloak/realm-config-extras.json"
export RBAC_FALLBACK_CONFIG_PATH=/etc/keycloak/realm-config-extras.json
docker compose -f docker-compose.dev.yaml up -d --wait

# Wait ~30s for Keycloak to be ready
curl -fs http://localhost:7080/health/ready
# UI: http://localhost:3000          (IdP-pinned; same as dev)
# Supervisor: http://localhost:28000 (e2e band; dev uses 8000)
# Keycloak admin: http://localhost:7080/admin (master / admin)
# Mongo: mongodb://localhost:28017   (e2e band; dev uses 27017)
```

Tear down: `make test-rbac-down` (or `docker compose -f docker-compose.dev.yaml down -v` with the same env exported).

### Mint a persona token by hand
```bash
# After the compose stack is up
python -c "from tests.rbac.fixtures.keycloak import get_persona_token; \
           print(get_persona_token('alice_admin').access_token)"
# Then:
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/admin/users
```

---

## How to add a new protected route

This spec's whole point is to make adding a new gate a small, mechanical change. Here is the recipe.

### Step 1 — Write the route with the gate
**TypeScript (BFF)**:
```typescript
import { withAuth, requireRbacPermission } from '@/lib/api-middleware';

export async function GET(request: NextRequest) {
  return withAuth(request, async (req, user, session) => {
    await requireRbacPermission(session, 'mcp_server', 'read');
    // ... handler ...
  });
}
```

**Python (FastAPI service)**:
```python
from fastapi import Depends
from ai_platform_engineering.utils.auth.keycloak_authz import require_rbac_permission

@router.get('/something')
async def get_something(
    _ = Depends(require_rbac_permission('rag', 'retrieve')),
):
    ...
```

### Step 2 — Add a row to `tests/rbac-matrix.yaml`
```yaml
- id: my-new-route
  surface: ui_bff               # or rag, supervisor, etc
  method: GET
  path: /api/whatever
  resource: mcp_server
  scope: read
  expectations:
    alice_admin:           { status: 200 }
    bob_chat_user:         { status: 403, reason: DENY_NO_CAPABILITY }
    carol_kb_ingestor:     { status: 403, reason: DENY_NO_CAPABILITY }
    dave_no_role:          { status: 403, reason: DENY_NO_CAPABILITY }
    eve_dynamic_agent_user:{ status: 403, reason: DENY_NO_CAPABILITY }
    frank_service_account: { status: 403, reason: DENY_NO_CAPABILITY }
```

### Step 3 — Verify the resource exists in `deploy/keycloak/realm-config.json`
If it doesn't, add it:
```json
{
  "name": "mcp_server",
  "scopes": [{ "name": "read" }, { "name": "manage" }]
}
```

### Step 4 — Run `make test-rbac`
The parameterised test in `tests/rbac/unit/{ts,py}/` automatically picks up your new entry. No new test code required for the standard allow/deny matrix.

For non-trivial logic (custom filtering, special headers, multipart), add a hand-written test file alongside the matrix-driven ones.

---

## Failure modes — how to debug

| Symptom | Likely cause | Fix |
|---|---|---|
| `make test-rbac` fails immediately with "validate-rbac-matrix.py: route X not in matrix" | You added `requireRbacPermission` to a route but didn't add the matrix entry. | Add the matrix entry per Step 2 above. |
| `make test-rbac` fails with "validate-realm-config.py: resource X scope Y not in realm-config.json" | You used a `(resource, scope)` pair the seed Keycloak realm doesn't know about. | Add it to `deploy/keycloak/realm-config.json` and rebuild the compose stack (`make test-rbac-down && make test-rbac-up`, or `docker compose -f docker-compose.dev.yaml up -d --force-recreate keycloak` with the e2e env exported). |
| Persona token mint fails with 401 | Keycloak isn't seeded yet, or `init-idp.sh` failed silently. | `docker compose -f docker-compose.dev.yaml logs keycloak \| tail -100`. Re-run `make test-rbac-up`. |
| Playwright says `webServer timed out` | UI image isn't building or supervisor is failing to start. | `docker compose -f docker-compose.dev.yaml logs caipe-ui caipe-supervisor`. |
| Tests hang on Keycloak `/health/ready` for >30s | Token-exchange feature flag broke compose startup. | Check `KC_FEATURES` env in `deploy/keycloak/docker-compose.yml`; should include `token-exchange`. |
| `permissionDecisionCache` returns stale allow after a role change | Expected — TTL is 60s. Wait it out, or restart the BFF. | Out of scope to fix; can be flushed in tests via `clearPersonaCache()` + container restart. |
| Audit log assertion fails with "no document for (user, route)" | Audit-log Mongo write failed silently per FR-007. | Check `docker compose ... logs mongo` and the BFF/service logs for warn-level audit failures. |

---

## How CI runs this

`.github/workflows/test-rbac.yaml` (NEW in Phase 5) runs:

```yaml
jobs:
  rbac:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: astral-sh/setup-uv@v4
      - run: COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot" docker compose -f docker-compose.dev.yaml pull
      - run: make test-rbac
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: rbac-failure-logs
          path: |
            docker-compose-logs/
            tests/rbac/e2e/test-results/
```

Time budget per SC-008: total `make test-rbac` ≤ 12 min in CI.

---

## How to extend the persona set

If your story needs a 7th persona (e.g. `gina_kb_admin`), add them in three places in lockstep:

1. `deploy/keycloak/init-idp.sh` — `kcadm` create commands.
2. `tests/rbac-matrix.yaml` — every existing route entry MUST add `gina_kb_admin: { status: ... }` (validator will fail otherwise).
3. `tests/rbac/fixtures/keycloak.{py,ts}` — extend the `PersonaName` enum.

The deliberate friction (every route entry must be updated) is by design: it forces the author of a new persona to think about every existing gate.

---

## Pointers to the spec for further reading

- Why these 6 personas? → [`spec.md`](./spec.md) §"Personas"
- Why a hybrid Keycloak+Mongo gate for RAG? → [`spec.md`](./spec.md) Story 4 + [`research.md`](./research.md) §1
- Why ContextVar for DA? → [`research.md`](./research.md) §TD-5 + [`call-sequences.md`](./call-sequences.md) Flow 4b
- What happens when Keycloak is down? → [`data-model.md`](./data-model.md) §"State transitions" + [`spec.md`](./spec.md) Edge Cases
