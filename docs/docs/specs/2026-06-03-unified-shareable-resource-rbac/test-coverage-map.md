# Test Coverage Map — Unified Shareable-Resource RBAC

This map ties every change on this branch to the test(s) that lock it. It is
**mock-only**: no live OpenFGA / Keycloak / Mongo / Playwright stack is required.
All tests run under the existing entry points:

| Lane | Command | What it covers here |
|------|---------|---------------------|
| UI Jest (all) | `make caipe-ui-tests` | every `*.test.ts(x)` below under `ui/` |
| RBAC Jest subset | `make test-rbac-jest` | globs `ui/src/lib/rbac/__tests__/` + the matrix driver |
| RBAC pytest subset | `make test-rbac-pytest` | matrix-driver + helper units |
| RAG server pytest | `cd ai_platform_engineering/knowledge_bases/rag/server && PYTHONPATH=. uv run pytest` | RAG authz helpers + endpoint wiring |
| Common pytest | `cd ai_platform_engineering/knowledge_bases/rag/common && PYTHONPATH=. uv run pytest` | `OwnedResourceMixin` model |
| Dynamic Agents pytest | `cd ai_platform_engineering/dynamic_agents && PYTHONPATH=. uv run pytest` | DA read-time credential self-heal |
| Config-bridge pytest | `cd deploy/agentgateway && PYTHONPATH=. uv run pytest` | agentgateway config bridge |

> **Why no `tests/rbac/rbac-matrix.yaml` rows for `mcp_tool`?**
> `scripts/validate-rbac-matrix.py` restricts `authorization_system: openfga`
> rows to `object_type: agent` / `relation: can_use`, and `keycloak` rows to
> realm-config resources. `mcp_tool` is neither, so adding rows would fail the
> lint gate, and the `--rbac-online` lane has no `mcp_tool` tuple fixtures. The
> equivalent cross-cutting lock is the **mock-only decision matrix**
> `mcp-tool-authorization-matrix.test.ts` (runs in `make test-rbac-jest`),
> which encodes the full subject × sharing → action table and evaluates it
> against the real tuple builder + the deployed model's permission graph.

---

## Change → Test

### 1. Unified shareable-resource RBAC core (tuple builders)

| Change | Test(s) |
|--------|---------|
| `creator` relation, owner-subject `owner`, team owner/share diffs (`openfga-owned-resources.ts`, `shareable-resource.ts`) | `ui/src/lib/rbac/__tests__/shareable-resource.test.ts`, `shareable-resource-write.test.ts` |
| `data_source.parent_kb` inheritance edge | `ui/src/lib/rbac/__tests__/openfga-data-source-mcp-tool.test.ts` (parent_kb write-only assertions) |
| `mcp_tool` member relations (`reader`/`user`/`caller`) + org-wide diff | `openfga-data-source-mcp-tool.test.ts`, `shareable-resource.test.ts` |
| KB shared-teams reconcile + owner preservation | `openfga-kb-shared-teams.test.ts`, `ui/src/app/api/rag/kbs/__tests__/sharing-route.test.ts` |
| Resource authz helpers / ownership-transfer guard (`resource-authz.ts`) | `ui/src/app/api/rag/__tests__/mcp-tool-ownership-transfer.test.ts` |
| Shareable type/JSON drift guard | `shareable-type-drift.test.ts` |

### 2. RAG server custom MCP tool authz via OpenFGA

| Change | Test(s) |
|--------|---------|
| Authz helpers `authorize_mcp_tool_create` / `authorize_mcp_tool_manage` (`rbac.py`) | `ai_platform_engineering/knowledge_bases/rag/server/tests/test_mcp_tool_authz.py` |
| `POST/PUT/DELETE /v1/mcp/custom-tools` endpoint wiring (403/200/401, coarse-admin bypass) (`restapi.py`) | `.../server/tests/test_mcp_tool_endpoints.py` (FastAPI `TestClient`) |
| `OwnedResourceMixin` model (`common/.../models/rag.py`) | `.../common/tests/test_owned_resource_mixin.py` |
| RAG e2e made opt-in via `RAG_E2E` | `.../server/tests/test_e2e.py` (skips unless `RAG_E2E=1`) |

### 3. Org-wide + team-invoke sharing (`shared_with_org`, `caller`)

| Change | Test(s) |
|--------|---------|
| `mcp_tool.reader/user/caller` include `organization#member`; `caller` includes `agent` (`model.fga` + chart `authorization-model.json`) | `ui/src/lib/rbac/__tests__/rebac/mcp-tool-org-share-contract.test.ts` |
| Full subject × sharing → use/call/manage decision matrix | `ui/src/lib/rbac/__tests__/rebac/mcp-tool-authorization-matrix.test.ts` |
| BFF `can_call` gate + list filter + delete-all-tuples + admin bypass | `ui/src/app/api/rag/__tests__/mcp-tool-can-call.test.ts`, `mcp-tool-list-filter.test.ts`, `ui/src/app/api/__tests__/rag-rbac.test.ts` |
| BFF POST/PUT `shared_with_org` reconcile wiring (`sharedWithOrg`/`previousSharedWithOrg`) | `ui/src/app/api/rag/__tests__/mcp-tool-ownership-transfer.test.ts` |
| UI org-share toggle (`MCPToolsView.tsx`) | covered indirectly via BFF route tests (mock-only; no DOM e2e per decision) |

### 4. super-admins team confers org-admin

| Change | Test(s) |
|--------|---------|
| `team:super-admins#admin → organization#admin` link (`super-admins-team.ts`) | `ui/src/lib/rbac/__tests__/super-admins-org-admin-link.test.ts` |
| org-admin → `manager` on every `mcp_tool` (model side) | `mcp-tool-authorization-matrix.test.ts` (super-admins / org-admin block) |
| `caller`/org migration backfill (`migrations/registry.ts`) | `ui/src/lib/rbac/migrations/__tests__/agent-organization-inheritance.test.ts` |

### 5. credential_sources discovery + backfill (uncommitted this session)

| Change | Test(s) |
|--------|---------|
| Discovery attaches built-in credential sources (`agentgateway-mcp-discovery.ts`, `types/dynamic-agent.ts`) | `ui/src/lib/rbac/__tests__/agentgateway-mcp-discovery.test.ts` |
| UI startup backfill (`seed-config.ts`) | `ui/src/lib/__tests__/seed-config-mcp-credential-backfill.test.ts` |
| seed cleanup preserves discovered (`source: "agentgateway"`) servers | `ui/src/lib/__tests__/seed-config-cleanup-discovered.test.ts` |
| DA read-time self-heal (`dynamic_agents/services/mongo.py`) | `ai_platform_engineering/dynamic_agents/tests/test_mongo_credential_sources_self_heal.py` |

### 6. agentgateway config bridge

| Change | Test(s) |
|--------|---------|
| `config_bridge.py` | `deploy/agentgateway/tests/test_config_bridge.py` |

---

## Out of scope (per decisions)

- No live-OpenFGA lane (`--rbac-online`) and no Playwright persona e2e — mock-only.
- `tests/rbac/e2e/*.spec.ts` and `tests/rbac/end_to_end/*.sh` are untouched.
- `tests/rbac/rbac-matrix.yaml` is intentionally **not** extended with `mcp_tool`
  rows (validator constraint above); the decision-matrix unit test is the
  equivalent lock.
