# 098 Permission Matrix

**Version**: 1 (Draft)
**Spec**: [spec.md](./spec.md) — FR-008, FR-014
**PDP mapping**: Keycloak AuthZ (UI/Slack) | Agent Gateway (MCP/A2A/Agent)

## Matrix

| Component | Capability ID | Description | Required Role(s) | Channel / API | PDP | ASP Relationship |
|-----------|---------------|-------------|-------------------|---------------|-----|-----------------|
| `admin_ui` | `admin_ui#view` | View admin dashboard | `admin` | UI BFF | Keycloak | — |
| `admin_ui` | `admin_ui#configure` | Change platform settings | `admin` | UI BFF | Keycloak | — |
| `admin_ui` | `admin_ui#admin` | Full admin operations | `admin` | UI BFF | Keycloak | — |
| `admin_ui` | `admin_ui#audit.view` | View audit logs | `admin` | UI BFF | Keycloak | — |
| `slack` | `slack#view` | View Slack bot responses | `chat_user` | Slack Bolt | Keycloak | — |
| `slack` | `slack#invoke` | Issue Slack commands | `chat_user` | Slack Bolt | Keycloak | — |
| `slack` | `slack#admin` | Slack admin operations | `admin` | Slack Bolt | Keycloak | — |
| `supervisor` | `supervisor#invoke` | Invoke supervisor routing | `chat_user` | A2A / BFF | AG | Composable with ASP |
| `supervisor` | `supervisor#configure` | Configure supervisor | `admin` | UI BFF | Keycloak | — |
| `supervisor` | `supervisor#admin` | Full supervisor admin | `admin` | UI BFF / AG | Both | — |
| `rag` | `rag#query` | Query RAG / search KBs | `chat_user` | RAG API / BFF | Keycloak | — |
| `rag` | `rag#ingest` | Ingest data into KBs | `kb_admin` | RAG API / BFF | Keycloak | — |
| `rag` | `rag#admin` | Full RAG administration | `kb_admin` | RAG API / BFF | Keycloak | — |
| `rag` | `rag#tool.create` | Create team RAG tool | `team_member` | UI BFF | Keycloak | — |
| `rag` | `rag#tool.update` | Update team RAG tool | `team_member` | UI BFF | Keycloak | — |
| `rag` | `rag#tool.delete` | Delete team RAG tool | `team_member` | UI BFF | Keycloak | — |
| `rag` | `rag#tool.view` | View RAG tools | `chat_user` | UI BFF | Keycloak | — |
| `rag` | `rag#kb.admin` | Administer knowledge bases | `kb_admin` | RAG API / BFF | Keycloak | — |
| `rag` | `rag#kb.ingest` | Ingest into knowledge bases | `kb_admin` | RAG API / BFF | Keycloak | — |
| `rag` | `rag#kb.query` | Query knowledge bases | `chat_user` | RAG API / BFF | Keycloak | — |
| `rag` | `rag#kb.read:<kb-id>` | Read/query a specific KB | `kb_reader:<kb-id>` or team owner | RAG API | RAG server (JWT + MongoDB) | Per-KB scoped |
| `rag` | `rag#kb.ingest:<kb-id>` | Ingest into a specific KB | `kb_ingestor:<kb-id>` or `kb_admin` | RAG API | RAG server (JWT + MongoDB) | Per-KB scoped |
| `rag` | `rag#kb.admin:<kb-id>` | Administer a specific KB | `kb_admin:<kb-id>` or `admin` | RAG API | RAG server (JWT + MongoDB) | Per-KB scoped |
| `sub_agent` | `sub_agent#invoke` | Dispatch sub-agent | `chat_user` | AG proxy | AG | Composable with ASP |
| `sub_agent` | `sub_agent#configure` | Configure sub-agents | `admin` | UI BFF | Keycloak | — |
| `sub_agent` | `sub_agent#admin` | Full sub-agent admin | `admin` | UI BFF / AG | Both | — |
| `tool` | `tool#invoke` | Invoke agent/MCP tool | `chat_user` | AG proxy | AG | Deny-wins with ASP |
| `tool` | `tool#configure` | Configure tools | `admin` | UI BFF | Keycloak | — |
| `tool` | `tool#admin` | Full tool administration | `admin` | UI BFF | Keycloak | — |
| `skill` | `skill#invoke` | Execute a skill | `chat_user` | AG proxy | AG | Composable with ASP |
| `skill` | `skill#configure` | Configure skills | `admin` | UI BFF | Keycloak | — |
| `skill` | `skill#admin` | Full skill administration | `admin` | UI BFF | Keycloak | — |
| `a2a` | `a2a#create` | Create A2A task | `chat_user` | AG proxy | AG | — |
| `a2a` | `a2a#view` | View A2A tasks/artifacts | `chat_user` | AG proxy | AG | — |
| `a2a` | `a2a#admin` | Full A2A administration | `admin` | UI BFF / AG | Both | — |
| `mcp` | `mcp#invoke` | Invoke MCP tool | `chat_user` | AG proxy | AG | Deny-wins with ASP |
| `mcp` | `mcp#view` | List MCP tools | `chat_user` | AG proxy | AG | — |
| `mcp` | `mcp#admin` | Full MCP administration | `admin` | UI BFF / AG | Both | — |

## Per-KB Access Control (FR-027)

Per-KB capabilities (`rag#kb.read:<kb-id>`, `rag#kb.ingest:<kb-id>`, `rag#kb.admin:<kb-id>`) are enforced by the **RAG server** as a second layer after BFF coarse checks. Access is determined by the **union** of two sources:

| Source | Storage | How It Works |
|--------|---------|--------------|
| **Keycloak per-KB roles** | JWT `roles` claim | Roles like `kb_reader:kb-team-a`, `kb_ingestor:kb-ops`, `kb_reader:*` (wildcard) grant scoped access to specific KBs |
| **Team ownership** | MongoDB `team_kb_ownership` | Teams own KBs; team members can access their team's KBs without explicit per-KB roles |

**Global overrides**: `admin` and `kb_admin` roles grant access to **all** KBs without per-KB roles.

**Query-time filtering**: The RAG server's `/v1/query` endpoint injects `datasource_id` filters to restrict results to authorized KBs (server-side enforced, transparent to caller).

## Roles Summary

| Role | Description | Typical IdP Group |
|------|-------------|-------------------|
| `admin` | Platform administrator — full access | `platform-admin` |
| `chat_user` | Standard user — can chat, invoke tools, query RAG | `backstage-access` |
| `team_member` | Team member — can CRUD team-scoped RAG tools | `team-{name}-eng` |
| `kb_admin` | KB administrator — can admin/ingest knowledge bases | `kb-admins` |
| `kb_reader:<kb-id>` | Per-KB reader — can query a specific KB | Admin-assigned per user/team |
| `kb_ingestor:<kb-id>` | Per-KB ingestor — can ingest into a specific KB | Admin-assigned per user/team |
| `kb_admin:<kb-id>` | Per-KB admin — full admin on a specific KB | Admin-assigned per user/team |

## Enforcement Points

| Path | PDP | Enforcement Mechanism |
|------|-----|----------------------|
| Admin UI (BFF API routes) | Keycloak AuthZ Services | `keycloak-authz.ts` → UMA ticket grant |
| Slack bot commands | Keycloak AuthZ Services | `keycloak_authz.py` → UMA ticket grant |
| MCP tool invocation | Agent Gateway | CEL policy + JWT validation |
| A2A inter-agent traffic | Agent Gateway | CEL policy + JWT validation |
| Agent/sub-agent dispatch | Agent Gateway | CEL policy + JWT validation |
| RAG server KB operations | RAG server (defense-in-depth) | JWT → Keycloak role mapper + per-KB access (FR-026, FR-027) |
| RAG server `/v1/query` | RAG server (query-time filter) | `inject_kb_filter()` restricts results to accessible KBs (FR-027) |

## Composition Rules (FR-012)

When multiple authorization layers apply (098 RBAC, ASP/tool policy, AG policy), effective access is the **intersection** — deny from any layer results in overall deny.

**Precedence**: deny wins. If 098 RBAC denies, the operation is denied regardless of ASP or AG policy. If ASP denies, the operation is denied regardless of 098 RBAC allowing it.

### Detailed Composition and Precedence (T052)

#### Layers evaluated (in order)

| # | Layer | Where | What it checks |
|---|-------|-------|----------------|
| 1 | **Agent Gateway CEL** | AG proxy | JWT `realm_access.roles` against tool-name / action patterns |
| 2 | **098 Keycloak AuthZ** | BFF / Slack middleware | UMA ticket grant for `resource#scope` per permission matrix |
| 3 | **ASP Tool Policy** | RAG server / supervisor | Application-specific tool allow/deny lists managed in MongoDB |
| 4 | **Team-scope check** | BFF (MongoDB) + RAG server | `team_id` ownership; `datasource_ids ⊆ allowed_datasource_ids` |

#### Deny-wins algorithm

```
effective_access = AG_allows
                 AND keycloak_allows
                 AND asp_allows
                 AND team_scope_allows
```

A **deny** at any layer results in an overall deny. Layers are independent — a later allow cannot override an earlier deny.

#### Examples

| Scenario | AG | Keycloak | ASP | Team | Result |
|----------|-----|----------|-----|------|--------|
| Admin invokes `admin_config` tool | allow | allow | — | — | **allow** |
| `chat_user` invokes `admin_config` tool | deny | — | — | — | **deny** (AG blocks) |
| `team_member(a)` creates tool in team-b | allow | allow | — | deny | **deny** (cross-team) |
| `team_member(a)` creates tool in team-a, but datasource not in allowed set | allow | allow | — | deny | **deny** (datasource binding) |
| `kb_admin` ingests to KB, ASP blocks tool | allow | allow | deny | — | **deny** (ASP overrides) |
| `chat_user` queries RAG | allow | allow | allow | — | **allow** |

#### Fail-closed behavior

If **any** PDP is unreachable (Keycloak down, AG misconfigured, MongoDB unavailable for team-scope):

- The system returns a **503** or **deny** — never an implicit allow.
- Audit log records reason code `DENY_PDP_UNAVAILABLE` or `DENY_SCOPE`.
- The BFF `requireRbacPermission` and RAG server `validate_datasource_binding` both enforce this.

## Test Personas (SC-003)

| Persona | Roles | Expected Access |
|---------|-------|-----------------|
| `admin-user` | `admin`, `chat_user` | Full access to all components |
| `standard-user` | `chat_user`, `team_member` | Chat, tools, team RAG CRUD; no admin |
| `kb-admin-user` | `chat_user`, `team_member`, `kb_admin` | Chat, tools, team RAG CRUD, KB admin/ingest |
| `denied-user` | (none) | No access to any protected capability |
| `org-b-user` | `chat_user` | Chat in org-b only; no access to org-a resources |
