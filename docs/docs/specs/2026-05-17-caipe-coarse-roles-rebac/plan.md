# CAIPE Organization ReBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove CAIPE business/resource realm roles from Keycloak and use OpenFGA organization, team, and resource relationships for all CAIPE authorization, with `BOOTSTRAP_ADMIN_EMAILS` as a break-glass fallback.

**Architecture:** Keycloak remains the IdP/token issuer only. OpenFGA stores organization-level relationships (`member`, `admin`, `auditor`), team relationships, and resource relationships such as `owner`, `reader`, `ingestor`, `manager`, and `caller`; `can_*` permissions are derived in the authorization model and used for checks. Bootstrap scripts seed durable OpenFGA organization admin tuples from `BOOTSTRAP_ADMIN_EMAILS` once a Keycloak subject is available, and fall back to the email list only when the durable tuple is missing or OpenFGA is unavailable during bootstrap.

**Tech Stack:** Keycloak realm import/init shell scripts, OpenFGA model JSON/FGA, Next.js BFF route handlers, Python RAG server auth, MongoDB metadata, Jest/pytest tests, RBAC docs.

---

## File Structure

- Modify `charts/ai-platform-engineering/charts/openfga/authorization-model.json` and `deploy/openfga/model.fga` to introduce organization base relations plus resource base relations and derived `can_*` relations.
- Modify `charts/ai-platform-engineering/charts/keycloak/realm-config.json` and `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh` to stop seeding CAIPE business/resource realm roles. Keep only Keycloak protocol built-ins and service-account `realm-management` client roles.
- Modify `ui/src/lib/api-middleware.ts`, `ui/src/lib/auth-config.ts`, and `deploy/keycloak/realm-config-extras.json` to stop relying on realm role or raw Okta/AD group fallback for product authorization.
- Modify `ui/src/lib/rbac/openfga.ts`, `ui/src/lib/rbac/tuple-builders.ts`, admin OpenFGA routes/components/tests, and team resource flows so writes use base relations (`reader`, `manager`, `caller`) while checks still use derived `can_*`.
- Modify `ui/src/app/api/dynamic-agents/route.ts` and `ui/src/lib/rbac/openfga-agent-tools.ts` so create/update flows grant `owner` and team base relations.
- Modify RAG auth in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` and route logic in `restapi.py` to remove `kb_reader:*` parsing and use OpenFGA-backed KB access.
- Modify skill routes under `ui/src/app/api/skills/**` and admin skill hub crawl routes so user-created skills get `owner`, admin crawls require `can_manage organization:<org_key>`.
- Modify Task Builder route guards so write/manage requires `can_manage organization:<org_key>`.
- Update RBAC docs under `docs/docs/security/rbac/` in the same session.

## Task 1: Organization ReBAC Admin Detection

**Files:**
- Modify: `ui/src/lib/auth-config.ts`
- Modify: `ui/src/lib/api-middleware.ts`
- Test: `ui/src/lib/__tests__/auth-config.test.ts`
- Test: `ui/src/lib/__tests__/api-middleware.test.ts`

- [ ] **Step 1: Write tests for organization relationships**

Add assertions that:
- `user:<sub> admin organization:<org_key>` makes the user admin.
- `team:<team>#admin admin organization:<org_key>` makes team admins organization admins.
- `user:<sub> auditor organization:<org_key>` makes the user read-only admin-dashboard capable.
- `user:<sub> member organization:<org_key>` grants baseline CAIPE access.
- Legacy realm roles (`admin`, `admin_user`, `chat_user`) and raw Okta/AD groups no longer satisfy product authorization checks.

Run:

```bash
cd ui && npm test -- --runTestsByPath src/lib/__tests__/auth-config.test.ts src/lib/__tests__/api-middleware.test.ts --runInBand
```

Expected before implementation: tests fail on old role names.

- [ ] **Step 2: Implement organization identity helpers**

Add explicit organization config helpers:

```ts
export const CAIPE_ORG_KEY = process.env.CAIPE_ORG_KEY || "caipe";
export const CAIPE_ORG_DISPLAY_NAME = process.env.CAIPE_ORG_DISPLAY_NAME || "CAIPE";
export function organizationObjectId(): string {
  return `organization:${CAIPE_ORG_KEY}`;
}
```

Use OpenFGA checks against `organizationObjectId()` for admin/auditor/member gates. Keep `BOOTSTRAP_ADMIN_EMAILS` as explicit fallback.

- [ ] **Step 3: Remove role fallback from `requireRbacPermission`**

Replace `RESOURCE_ROLE_FALLBACK` with deny-by-default behavior for PDP unavailable, except explicit `BOOTSTRAP_ADMIN_EMAILS` bootstrap allowance during local setup. Route-level allow decisions must come from OpenFGA organization/resource checks, not realm roles.

- [ ] **Step 4: Verify**

Run:

```bash
cd ui && npm test -- --runTestsByPath src/lib/__tests__/auth-config.test.ts src/lib/__tests__/api-middleware.test.ts --runInBand
```

Expected: all updated tests pass.

## Task 2: OpenFGA Base Relations and Derived Permissions

**Files:**
- Modify: `deploy/openfga/model.fga`
- Modify: `charts/ai-platform-engineering/charts/openfga/authorization-model.json`
- Test: `deploy/openfga/bridge/tests/test_grpc_bridge.py`
- Test: `ui/src/lib/rbac/__tests__/openfga.test.ts`

- [ ] **Step 1: Write model expectations**

Update tests/fixtures to expect KB/agent/skill access based on base relations:

```text
user:alice owner knowledge_base:kb1
team:platform#member reader knowledge_base:kb1
team:platform#member manager agent:agent1
agent:agent1 caller tool:jira/search
```

Checks continue to use derived permissions:

```text
user:alice can_manage knowledge_base:kb1
user:bob can_read knowledge_base:kb1
agent:agent1 can_call tool:jira/search
```

- [ ] **Step 2: Update FGA model**

For `organization`:

```fga
type organization
  relations
    define member: [user, service_account, team#member, team#admin, external_group#member]
    define admin: [user, service_account, team#admin]
    define auditor: [user, service_account, team#member, team#admin, external_group#member]
    define can_use: member or admin
    define can_manage: admin
    define can_audit: auditor or admin
```

For `knowledge_base`:

```fga
type knowledge_base
  relations
    define owner: [user, service_account]
    define reader: [user, service_account, team#member, team#admin, external_group#member, slack_channel]
    define ingestor: [user, service_account, team#member, team#admin, external_group#member]
    define manager: [user, service_account, team#admin]
    define auditor: [user, service_account, team#admin]
    define can_discover: reader or can_read
    define can_read: reader or can_ingest or can_manage or owner
    define can_use: can_read
    define can_ingest: ingestor or can_manage or owner
    define can_admin: manager or owner
    define can_manage: manager or owner
    define can_audit: auditor or can_manage
```

Apply the same pattern to `agent`, `skill`, `task`, and `tool`, using `caller` for tool invocation and retaining derived `can_call`.

- [ ] **Step 3: Sync JSON model**

Generate or manually update JSON model to match `model.fga`. Keep relation metadata allowing direct writes only for base relations.

- [ ] **Step 4: Verify model consumers**

Run:

```bash
cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/openfga.test.ts --runInBand
PYTHONPATH=. uv run pytest deploy/openfga/bridge/tests/test_grpc_bridge.py -q
```

Expected: tuple checks pass with base relation writes.

## Task 3: Tuple Builders and Admin OpenFGA UI

**Files:**
- Modify: `ui/src/lib/rbac/openfga.ts`
- Modify: `ui/src/lib/rbac/tuple-builders.ts`
- Modify: `ui/src/components/admin/OpenFgaRebacTab.tsx`
- Modify: `ui/src/app/api/admin/openfga/relationship/route.ts`
- Modify tests under `ui/src/lib/rbac/__tests__/` and `ui/src/app/api/admin/openfga/__tests__/`

- [ ] **Step 1: Update tests to write base relations**

Expected tuple writes:

```ts
{ user: "team:platform#member", relation: "reader", object: "knowledge_base:kb1" }
{ user: "team:platform#member", relation: "manager", object: "agent:agent1" }
{ user: "agent:agent1", relation: "caller", object: "tool:jira/search" }
```

Checks and graph labels may still display derived permissions as computed access.

- [ ] **Step 2: Implement relation mapping**

Map UI grants:

```ts
use -> reader/use_base
manage -> manager
call -> caller
read -> reader
ingest -> ingestor
admin -> manager
audit -> auditor
```

Keep `can_*` accepted for read/check endpoints only where compatibility is needed, not for writes.

- [ ] **Step 3: Verify**

Run:

```bash
cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/openfga.test.ts src/lib/rbac/__tests__/rebac/tuple-builders.test.ts src/app/api/admin/openfga/__tests__/tuples-route.test.ts --runInBand
```

Expected: all updated tests pass.

## Task 4: Keycloak Identity-Only Bootstrap and Local Realm Cleanup

**Files:**
- Modify: `charts/ai-platform-engineering/charts/keycloak/realm-config.json`
- Modify: `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh`
- Modify: `docker-compose.dev.yaml`
- Modify: `.env.example` if present
- Test: `scripts/validate-realm-config.py`

- [ ] **Step 1: Update realm config tests/validation expectations**

Expected CAIPE app roles:

```json
[]
```

Legacy roles absent:

```json
["admin", "admin_user", "chat_user", "team_member", "kb_admin"]
```

- [ ] **Step 2: Update realm import**

Remove all CAIPE business/resource role definitions and demo assignments. Keep Keycloak built-ins and service-account `realm-management` client roles.

- [ ] **Step 3: Update `init-idp.sh`**

Remove role creation/assignment for:

```sh
admin admin_user chat_user team_member team_member:* kb_admin kb_reader:* kb_ingestor:* agent_user:* agent_admin:* tool_user:*
```

Add bootstrap logic that resolves each `BOOTSTRAP_ADMIN_EMAILS` user to a Keycloak `sub` and writes durable OpenFGA tuples:

```text
user:<sub> member organization:<org_key>
user:<sub> admin organization:<org_key>
```

Do not add any CAIPE business role to `default-roles-caipe`.

- [ ] **Step 4: Verify**

Run:

```bash
python scripts/validate-realm-config.py
```

Expected: validation passes with only coarse CAIPE roles.

## Task 5: Dynamic Agents Ownership and Team Sharing

**Files:**
- Modify: `ui/src/app/api/dynamic-agents/route.ts`
- Modify: `ui/src/lib/rbac/openfga-agent-authz.ts`
- Modify: `ui/src/lib/rbac/openfga-agent-tools.ts`
- Test: `ui/src/lib/rbac/__tests__/openfga-agent-authz.test.ts`
- Test: `ai_platform_engineering/dynamic_agents/tests/test_openfga_authz.py`

- [ ] **Step 1: Update tests**

Agent creation writes:

```ts
{ user: `user:${sub}`, relation: "owner", object: `agent:${agentId}` }
```

Team sharing writes:

```ts
{ user: `team:${teamSlug}#member`, relation: "reader", object: `agent:${agentId}` }
{ user: `team:${teamSlug}#member`, relation: "manager", object: `agent:${agentId}` }
```

Runtime checks still call `can_use` and `can_manage`.

- [ ] **Step 2: Implement create/update writes**

On `POST /api/dynamic-agents`, write only `owner` for the creator and `caller` for allowed agent tools.

- [ ] **Step 3: Verify**

Run:

```bash
cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/openfga-agent-authz.test.ts --runInBand
PYTHONPATH=ai_platform_engineering/dynamic_agents/src uv run pytest ai_platform_engineering/dynamic_agents/tests/test_openfga_authz.py -q
```

Expected: derived checks pass.

## Task 6: Knowledge Base ReBAC

**Files:**
- Modify: `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py`
- Modify: `ai_platform_engineering/knowledge_bases/rag/server/src/server/restapi.py`
- Modify: `ui/src/app/api/rag/tools/route.ts`
- Test: `ai_platform_engineering/knowledge_bases/rag/server/tests/test_role_mapping.py`
- Test: `ai_platform_engineering/knowledge_bases/rag/server/tests/test_doc_acl.py`

- [ ] **Step 1: Update tests away from realm KB roles**

Remove expectations for `kb_reader:*`, `kb_ingestor:*`, and `kb_admin:*`. Add tests where OpenFGA/Mongo team ownership grants produce readable/ingestable KBs.

- [ ] **Step 2: Implement OpenFGA/Mongo access resolution**

`get_accessible_kb_ids` must merge:
- `owner` direct user ownership.
- team `reader` / `ingestor` / `manager` grants.
- global read grants if still required.

- [ ] **Step 3: Creation semantics**

On KB/datasource create, write:

```text
user:<sub> owner knowledge_base:<datasource_id>
```

Do not write `can_read`, `can_ingest`, or `can_manage` direct tuples.

- [ ] **Step 4: Verify**

Run:

```bash
PYTHONPATH=ai_platform_engineering/knowledge_bases/rag/server/src uv run pytest ai_platform_engineering/knowledge_bases/rag/server/tests/test_role_mapping.py ai_platform_engineering/knowledge_bases/rag/server/tests/test_doc_acl.py -q
```

Expected: no realm KB role parsing remains in passing tests.

## Task 7: Skills and Task Builder Gates

**Files:**
- Modify: `ui/src/app/api/skills/configs/route.ts`
- Modify: `ui/src/app/api/skills/configs/import-zip/route.ts`
- Modify: `ui/src/app/api/skill-hubs/crawl/route.ts` or the current crawl route path
- Modify Task Builder API routes under `ui/src/app/api/task-configs/`
- Tests under `ui/src/app/api/skills/**/__tests__` and task-config tests

- [ ] **Step 1: Skill create tests**

User-created skill writes:

```ts
{ user: `user:${sub}`, relation: "owner", object: `skill:${skillId}` }
```

- [ ] **Step 2: Skill hub crawl tests**

Only users with `can_manage organization:<org_key>` may mutate crawl/cache state. Users with `can_audit organization:<org_key>` may read status/logs if route exists. Baseline organization members cannot crawl.

- [ ] **Step 3: Task Builder tests**

Task Builder write/manage endpoints require `can_manage organization:<org_key>`. Baseline organization members have no access for now.

- [ ] **Step 4: Verify**

Run relevant route tests:

```bash
cd ui && npm test -- --runTestsByPath src/app/api/skills/configs/import-zip/__tests__/route.test.ts --runInBand
```

Expected: skill ownership and admin-only crawl/task gates pass.

## Task 8: Local Cleanup Script

**Files:**
- Create: `scripts/cleanup-local-keycloak-legacy-roles.py`
- Test: dry-run command output

- [ ] **Step 1: Implement dry-run cleanup**

The script lists legacy roles:

```python
LEGACY_ROLES = {
    "admin", "admin_user", "chat_user", "team_member", "kb_admin",
}
LEGACY_PREFIXES = (
    "team_member:", "kb_reader:", "kb_ingestor:", "kb_admin:",
    "agent_user:", "agent_admin:", "tool_user:",
)
```

It keeps:

```python
KEEP_ROLES = {"default-roles-caipe", "offline_access", "uma_authorization"}
```

- [ ] **Step 2: Implement apply mode**

Delete only roles matching `LEGACY_ROLES` or `LEGACY_PREFIXES`, never built-ins or `caipe_*`.

- [ ] **Step 3: Verify dry run locally**

Run:

```bash
python scripts/cleanup-local-keycloak-legacy-roles.py --dry-run
```

Expected: prints planned deletes and verifies your `sraradhy@cisco.com` subject has `member` and `admin` tuples on `organization:<org_key>`.

## Task 9: Documentation

**Files:**
- Modify: `docs/docs/security/rbac/architecture.md`
- Modify: `docs/docs/security/rbac/workflows.md`
- Modify: `docs/docs/security/rbac/file-map.md`
- Modify: `docs/docs/security/rbac/usage.md`
- Modify: `docs/docs/security/rbac/roles-scopes-comparison.md`

- [ ] **Step 1: Update architecture**

Document:
- Keycloak identity-only: no CAIPE business/resource realm roles.
- `BOOTSTRAP_ADMIN_EMAILS` break-glass behavior.
- Organization object config: `CAIPE_ORG_KEY`, `CAIPE_ORG_DISPLAY_NAME`.
- OpenFGA base relations: `owner`, `reader`, `ingestor`, `manager`, `auditor`, `caller`.
- Derived checks: `can_read`, `can_ingest`, `can_manage`, `can_call`.
- Okta/AD groups as identity inputs mapped to teams, never direct product authz checks.

- [ ] **Step 2: Update workflows**

Add flows for:
- User creates KB.
- User shares KB with team.
- User creates agent.
- User creates skill.
- Admin crawls skills.
- Task Builder admin-only.

- [ ] **Step 3: Verify docs guard if available**

Run:

```bash
python scripts/validate-rbac-doc.py
```

Expected: docs validate, or report existing unrelated gaps.

## Task 10: End-to-End Verification

**Files:**
- Update `tests/rbac/rbac-matrix.yaml`
- Update RBAC unit/e2e tests as needed

- [ ] **Step 1: Update RBAC matrix**

Replace persona language based on `chat_user`/`admin` with `organization:<org_key>` and team/resource ReBAC relations.

- [ ] **Step 2: Run targeted UI and Python tests**

Run:

```bash
cd ui && npm test -- --runInBand
PYTHONPATH=. uv run pytest tests/rbac -q
```

Expected: updated RBAC tests pass.

- [ ] **Step 3: Run local realm cleanup**

After tests pass and local Keycloak has no CAIPE business roles:

```bash
python scripts/cleanup-local-keycloak-legacy-roles.py --apply
```

Expected local Keycloak realm roles include only Keycloak built-ins/service client roles; CAIPE admin access comes from OpenFGA organization tuples or `BOOTSTRAP_ADMIN_EMAILS` fallback.

## Self-Review

- Spec coverage: Covers identity-only Keycloak, bootstrap fallback, organization/team/resource ReBAC base relations, KB/agent/skill scenarios, admin skill crawl, Task Builder admin-only, bootstrap cleanup, local cleanup, docs, and tests.
- Placeholder scan: No placeholder instructions remain; commands and expected outputs are listed per task.
- Type consistency: Uses `owner`, `reader`, `ingestor`, `manager`, `auditor`, and `caller` as base relations; uses `can_*` only as derived check relations.
