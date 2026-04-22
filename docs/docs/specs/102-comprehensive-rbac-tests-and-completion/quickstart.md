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

All server-side dependencies are brought up by reusing the existing `docker-compose.dev.yaml` with a curated `COMPOSE_PROFILES` selection (see [spec Clarification 2026-04-22](./spec.md#session-2026-04-22) — there is **no** separate `docker-compose.e2e.yaml`). A small `docker-compose/docker-compose.e2e.override.yaml` overlay remaps host ports to avoid collisions with a running dev stack. Locally you only need Docker + Node + Python.

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

This is what CI runs. Locally it brings up the dev compose file with `COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot"` (plus the `e2e.override.yaml` overlay), seeds personas, runs all three test layers, then tears the stack down.

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
export COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot"
docker compose -f docker-compose.dev.yaml -f docker-compose/docker-compose.e2e.override.yaml up -d
# Wait ~30s for Keycloak to be ready
curl -fs http://localhost:7080/health/ready
# UI: http://localhost:28030 (e2e band; dev uses 3000)
# Supervisor: http://localhost:28000 (e2e band; dev uses 8000)
# Keycloak admin: http://localhost:7080/admin (master / admin)  -- not remapped, dev publishes this
# Mongo: mongodb://localhost:28017 (e2e band; dev uses 27017)
```

Tear down: `docker compose -f docker-compose.dev.yaml -f docker-compose/docker-compose.e2e.override.yaml down -v`.

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
| `make test-rbac` fails with "validate-realm-config.py: resource X scope Y not in realm-config.json" | You used a `(resource, scope)` pair the seed Keycloak realm doesn't know about. | Add it to `deploy/keycloak/realm-config.json` and rebuild the compose stack (`docker compose -f docker-compose.dev.yaml -f docker-compose/docker-compose.e2e.override.yaml up -d --force-recreate keycloak`). |
| Persona token mint fails with 401 | Keycloak isn't seeded yet, or `init-idp.sh` failed silently. | `docker compose -f docker-compose.dev.yaml -f docker-compose/docker-compose.e2e.override.yaml logs keycloak \| tail -100`. Re-run `docker compose ... up -d --force-recreate keycloak`. |
| Playwright says `webServer timed out` | UI image isn't building or supervisor is failing to start. | `docker compose -f docker-compose.dev.yaml -f docker-compose/docker-compose.e2e.override.yaml logs caipe-ui caipe-supervisor`. |
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
      - run: COMPOSE_PROFILES="rbac,caipe-ui,caipe-supervisor,caipe-mongodb,dynamic-agents,rag,all-agents,slack-bot" docker compose -f docker-compose.dev.yaml -f docker-compose/docker-compose.e2e.override.yaml pull
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
