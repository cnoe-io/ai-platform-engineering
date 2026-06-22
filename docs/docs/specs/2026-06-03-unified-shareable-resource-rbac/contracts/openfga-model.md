# Contract: OpenFGA Model Changes

Authored form: `deploy/openfga/model.fga`. Deployed form:
`charts/ai-platform-engineering/charts/openfga/authorization-model.json`. Both
MUST change together and remain in parity (FR-031; existing parity test).

## C1. `creator` relation on all shareable types

Add to each of `agent`, `knowledge_base`, `data_source`, `mcp_tool` (and the
canonical template for future types):

```
define creator: [user]
```

**Constraint**: `creator` MUST NOT appear in any `can_*` expression. The drift
check (contract C5) fails the build if it does.

JSON chart form (per type, in `metadata.relations` and `relations`):

```json
"creator": { "this": {} }
```
with `directly_related_user_types: [ { "type": "user" } ]` and no
`can_*.union` child referencing `creator`.

## C2. `data_source` parent_kb inheritance

Replace the current `data_source` permission block with:

```
type data_source
  relations
    define creator: [user]
    define parent_kb: [knowledge_base]
    define owner: [user, service_account]
    define reader: [user, service_account, team#member, team#admin, external_group#member]
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

JSON chart form for `parent_kb`: a relation with
`directly_related_user_types: [ { "type": "knowledge_base" } ]`, and each
inheriting permission gains a `tupleToUserset` child:

```json
{ "tupleToUserset": {
    "tupleset": { "relation": "parent_kb" },
    "computedUserset": { "relation": "can_read" } } }
```
(likewise `can_ingest`, `can_manage`).

**Verification**: `parent_kb` is the first tuple-to-userset in this model. A test
MUST confirm: (a) the parity check accepts the `from` form in both
representations, and (b) a `Check(user, can_read, data_source:X)` resolves `true`
when only `team:t#member reader knowledge_base:X` and
`data_source:X parent_kb knowledge_base:X` exist.

## C3. `user:*` public reader (carried from PR #1703)

`knowledge_base.reader` and `data_source.reader` include `user:*` so a public
datasource is readable by all authenticated users. If #1703 has merged, this is
already present; otherwise it is added here. Public read on `data_source`
continues to work directly on the data_source reader (independent of
`parent_kb`).

## C4. No change to `agent`, `tool`, `mcp_server`, `llm_model` permissions

Only the additive `creator` relation (C1) is added to `agent` and `mcp_tool`.
Their existing `can_*` expressions are unchanged. `tool`, `mcp_server`,
`llm_model` get `creator` only if they are declared "shareable" by the template;
otherwise unchanged. (Decision deferred to implementation per Rule-of-Three —
add `creator` to a type only when that type's creation path is updated to write
it; an unused `creator` relation on a type nobody writes adds no value.)

## C5. Shareable-type drift check

A test (or generator) that, for every type tagged "shareable", asserts:

1. `creator: [user]` is present.
2. `creator` is referenced by no `can_*`.
3. `can_manage` resolves through `manager` (team admin) and org-admin.
4. The authored and chart forms match for that type.

This is the FR-007 guard that stops a future type from silently diverging.
