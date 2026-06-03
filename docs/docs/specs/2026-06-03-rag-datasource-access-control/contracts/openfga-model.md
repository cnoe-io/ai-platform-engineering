# Contract: OpenFGA model change for `data_source` inheritance

The authorization model is the contract between the grant-writing surfaces (BFF/UI) and the enforcement points (BFF filter + RAG server). This file specifies the exact before/after for both artifacts, which **must stay in sync** (`deploy/openfga/bridge/tests/test_helm_values.py` parity test).

Artifacts:
- `deploy/openfga/model.fga` (DSL source)
- `charts/ai-platform-engineering/charts/openfga/authorization-model.json` (compiled JSON, loaded at deploy + mounted in local Compose)

## DSL: `deploy/openfga/model.fga`

### Before (current, post-mirror)

```fga
type data_source
  relations
    define owner: [user, service_account]
    define reader: [user, user:*, service_account, team#member, team#admin, external_group#member]
    define ingestor: [user, service_account, team#member, team#admin, external_group#member]
    define manager: [user, service_account, team#admin, organization#admin]
    define auditor: [user, service_account, team#admin]
    define can_discover: can_read
    define can_read: reader or can_manage or owner
    define can_use: can_read
    define can_write: can_ingest
    define can_ingest: ingestor or can_manage or owner
    define can_delete: can_manage
    define can_manage: manager or owner
    define can_audit: auditor or can_manage
```

### After (proposed)

```fga
type data_source
  relations
    define parent_kb: [knowledge_base]
    define owner: [user, service_account]
    define reader: [user, user:*, service_account, team#member, team#admin, external_group#member]
    define ingestor: [user, service_account, team#member, team#admin, external_group#member]
    define manager: [user, service_account, team#admin, organization#admin]
    define auditor: [user, service_account, team#admin]
    define can_discover: can_read
    define can_read: reader or can_manage or owner or can_read from parent_kb
    define can_use: can_read
    define can_write: can_ingest
    define can_ingest: ingestor or can_manage or owner or can_ingest from parent_kb
    define can_delete: can_manage
    define can_manage: manager or owner or can_manage from parent_kb
    define can_audit: auditor or can_manage
```

**Diff**: + `define parent_kb: [knowledge_base]`; append `or can_read from parent_kb` / `or can_ingest from parent_kb` / `or can_manage from parent_kb` to the three derivations. `knowledge_base` is unchanged.

## JSON: `authorization-model.json`

Add to the `data_source` type definition:

- **`relations.parent_kb`**: `{ "this": {} }`
- **`metadata.relations.parent_kb`**: `{ "directly_related_user_types": [ { "type": "knowledge_base" } ] }`
- **`relations.can_read`**: union child adding a `tupleToUserset` →
  ```json
  { "tupleToUserset": { "tupleset": { "relation": "parent_kb" }, "computedUserset": { "relation": "can_read" } } }
  ```
- **`relations.can_ingest`**: same `tupleToUserset` with `computedUserset.relation = "can_ingest"`.
- **`relations.can_manage`**: same `tupleToUserset` with `computedUserset.relation = "can_manage"`.

The DSL is the source of truth; regenerate/hand-edit the JSON to match and run the parity test.

## Behavioral contract (Check / ListObjects)

| Query | Before | After |
|-------|--------|-------|
| `Check(team-member, can_read, data_source:X)` where only `team#member reader knowledge_base:X` exists | `false` (bug — mirror required a `data_source` tuple) | `true` (inherited via `parent_kb`) |
| `Check(...)` written via Access Manager (KB only) | `false` (Access Manager can't write `data_source`) | `true` |
| `ListObjects(user, can_read, data_source)` | returns datasources with direct/mirrored tuples | returns datasources whose `parent_kb` KB is readable ∪ direct |
| `Check(member-with-component-ingest-only, can_read, data_source:X)` | `false` | `false` (direct ingest doesn't grant read; Story 3 preserved) |
| `Check(user:*, can_read, data_source:X)` via `user:* reader knowledge_base:X` | n/a (public written on both) | `true` (inherited) — **verify wildcard-through-userset in quickstart** |

## Consumers that must NOT need changes

- `ai_platform_engineering/.../server/src/server/rbac.py` — still calls `can_read`/list on `data_source`; only the derivation changes.
- BFF `ui/src/app/api/rag/[...path]/route.ts` filter/`constrainSearchBody` — still filters by `data_source#read`.
- Org-admin `bypassForOrgAdmin` + `RAG_ADMIN_BYPASS_DISABLED` — unchanged semantics.

## Consumers that DO change

- `ui/src/lib/rbac/openfga-owned-resources.ts` — delete `mirrorKnowledgeBaseDiffToDataSource`; create path writes the `parent_kb` edge instead of mirrored access tuples.
- `ui/src/app/api/rag/kbs/[id]/sharing/route.ts`, `ui/src/app/api/admin/teams/[id]/kb-assignments/route.ts` — drop the mirror call (KB-only writes again).
- `ui/src/app/api/admin/rag/public-datasources/route.ts` — write/delete `user:* reader knowledge_base:<id>` only (per R4).
- `ui/src/lib/rbac/migrations/registry.ts` — add `parent_kb` backfill; retire the `data_source_grants_backfill_v1` mirror.
