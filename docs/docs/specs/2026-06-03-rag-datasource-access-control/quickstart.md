# Quickstart: verify `data_source → knowledge_base` inheritance

Local verification that (a) inheritance confers searchable access from a KB-only grant, (b) component-only ingest still works, (c) public-via-KB works, and (d) the backfill is non-disruptive. Uses the local Docker Compose OpenFGA (`OPENFGA_HTTP`, store `caipe-openfga`) which mounts the same chart JSON model as Helm.

> Replace `$FGA`/`$STORE` with your local OpenFGA base URL and store id. `team:platform`, `kb-demo`, and `user:alice` are placeholders.

## 0. Preconditions

- New model version (with `data_source.parent_kb` + inherited `can_*`) published to the store. Confirm `make`/compose brought up OpenFGA with the updated `authorization-model.json`.
- Model-parity test green: `.venv/bin/python -m pytest deploy/openfga/bridge/tests/test_helm_values.py -k "model or openfga"`.

## 1. Wire a datasource to its KB (the one structural tuple)

```bash
curl -s -X POST "$FGA/stores/$STORE/write" -H 'Content-Type: application/json' -d '{
  "writes": { "tuple_keys": [
    { "user": "knowledge_base:kb-demo", "relation": "parent_kb", "object": "data_source:kb-demo" }
  ]}}'
```

## 2. Story 1 — KB-only grant ⇒ datasource is searchable

Grant read on the KB **only** (the shape the Access Manager writes):

```bash
curl -s -X POST "$FGA/stores/$STORE/write" -H 'Content-Type: application/json' -d '{
  "writes": { "tuple_keys": [
    { "user": "team:platform#member", "relation": "reader", "object": "knowledge_base:kb-demo" }
  ]}}'
```

Assert inheritance (expect `allowed: true`) — note: **no `data_source` access tuple was written**:

```bash
curl -s -X POST "$FGA/stores/$STORE/check" -H 'Content-Type: application/json' -d '{
  "tuple_key": { "user": "user:alice", "relation": "can_read", "object": "data_source:kb-demo" }
}'   # given user:alice is team:platform#member  → { "allowed": true }
```

`ListObjects` includes it:

```bash
curl -s -X POST "$FGA/stores/$STORE/list-objects" -H 'Content-Type: application/json' -d '{
  "user": "user:alice", "relation": "can_read", "type": "data_source"
}'   # → objects includes "data_source:kb-demo"
```

End-to-end: as a `team:platform` member, run a RAG search and confirm non-empty results scoped to `kb-demo` (SC-001).

## 3. Revoke flows through inheritance (FR-008)

```bash
curl -s -X POST "$FGA/stores/$STORE/write" -H 'Content-Type: application/json' -d '{
  "deletes": { "tuple_keys": [
    { "user": "team:platform#member", "relation": "reader", "object": "knowledge_base:kb-demo" }
  ]}}'
# re-run the check from step 2 → { "allowed": false }   (no data_source delete needed)
```

## 4. Story 3 — component-only ingest still works

```bash
curl -s -X POST "$FGA/stores/$STORE/write" -H 'Content-Type: application/json' -d '{
  "writes": { "tuple_keys": [
    { "user": "team:platform#member", "relation": "ingestor", "object": "data_source:kb-demo" }
  ]}}'
# can_ingest → true ; can_read → false (no KB read grant)
curl -s -X POST "$FGA/stores/$STORE/check" -d '{"tuple_key":{"user":"user:alice","relation":"can_ingest","object":"data_source:kb-demo"}}'  # true
curl -s -X POST "$FGA/stores/$STORE/check" -d '{"tuple_key":{"user":"user:alice","relation":"can_read","object":"data_source:kb-demo"}}'    # false
```

## 5. Public via KB (R4 — verify wildcard through userset)

```bash
curl -s -X POST "$FGA/stores/$STORE/write" -H 'Content-Type: application/json' -d '{
  "writes": { "tuple_keys": [
    { "user": "user:*", "relation": "reader", "object": "knowledge_base:kb-demo" }
  ]}}'
# any authenticated user inherits read on the datasource:
curl -s -X POST "$FGA/stores/$STORE/check" -d '{"tuple_key":{"user":"user:bob","relation":"can_read","object":"data_source:kb-demo"}}'  # expect true
```

If this returns `false`, the typed-wildcard-through-tuple-to-userset edge case applies → fall back to also writing `user:* reader data_source:kb-demo` (documented R4 exception) and note it for the PR 4 author.

## 6. Backfill is non-disruptive (US2 / SC-002)

- Capture `ListObjects(user, can_read, data_source)` for a representative user set **before** running `data_source_parent_kb_backfill_v1`.
- Run the backfill (idempotent). Re-run the same `ListObjects`.
- Assert the after-set ⊇ before-set (no access lost), and a second backfill run reports 0 writes.

## 7. Quality gates

```bash
# UI/BFF
cd ui && npx jest src/lib/rbac src/app/api/rag src/app/api/admin/rag src/components/admin/rebac
# model parity + RBAC matrix
cd .. && .venv/bin/python -m pytest deploy/openfga/bridge/tests/test_helm_values.py -k "model or openfga"
PYTHONPATH=. .venv/bin/python scripts/validate-rbac-matrix.py
```
