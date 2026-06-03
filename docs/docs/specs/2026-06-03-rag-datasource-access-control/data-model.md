# Phase 1 Data Model: `data_source → knowledge_base` inheritance

The "data model" here is the OpenFGA authorization model (object types, relations, derived permissions, and the tuples that wire them). No application database schema changes.

## Object types & relations

### `knowledge_base` (parent — unchanged)

| Relation | Type | Meaning |
|----------|------|---------|
| `owner` | direct: `user`, `service_account` | Creator/owner of the KB. |
| `reader` | direct: `user`, `user:*`, `service_account`, `team#member`, `team#admin`, `external_group#member`, `slack_channel`, `webex_space` | Can read/search. `user:*` = public. |
| `ingestor` | direct: `user`, `service_account`, `team#member`, `team#admin`, `external_group#member` | Can ingest/update content. |
| `manager` | direct: `user`, `service_account`, `team#admin`, `organization#admin` | Can administer/delete. |
| `auditor` | direct: `user`, `service_account`, `team#admin` | Read audit. |
| `can_read` | `reader or can_ingest or can_manage or owner` | Derived. |
| `can_ingest` | `ingestor or can_manage or owner` | Derived. |
| `can_manage` | `manager or owner` | Derived. |

**Grants are written here.** This is the single source of truth for who-can-do-what on a datasource.

### `data_source` (component — CHANGED)

| Relation | Type | Meaning |
|----------|------|---------|
| **`parent_kb`** *(new)* | direct: `knowledge_base` | Wires this datasource to its KB for inheritance. Exactly one per datasource (1:1 today). |
| `owner` | direct: `user`, `service_account` | Direct component owner (rare). |
| `reader` | direct: `user`, `user:*`, `service_account`, `team#member`, `team#admin`, `external_group#member` | Direct component read (rare; usually inherited). |
| `ingestor` | direct: `user`, `service_account`, `team#member`, `team#admin`, `external_group#member` | **Component-only ingest** (the reason the type exists — Story 3). |
| `manager` | direct: `user`, `service_account`, `team#admin`, `organization#admin` | Direct component manage (rare). |
| `auditor` | direct: `user`, `service_account`, `team#admin` | Read audit. |
| `can_read` | `reader or can_manage or owner or **can_read from parent_kb**` | Derived; **inherits KB read**. |
| `can_ingest` | `ingestor or can_manage or owner or **can_ingest from parent_kb**` | Derived; inherits KB ingest. |
| `can_delete` | `can_manage` | Derived (unchanged). |
| `can_manage` | `manager or owner or **can_manage from parent_kb**` | Derived; inherits KB manage. |
| `can_discover`, `can_use`, `can_write`, `can_audit` | unchanged derivations | — |

> Only the three `can_*` derivations gain a `... from parent_kb` branch and the new `parent_kb` relation is added. Direct relations are retained verbatim so component-only grants and any non-KB-backed datasource still work.

## Relationships

```
user / team#member / team#admin / external_group#member / user:*
        │  (reader | ingestor | manager | owner)   ← grants written HERE
        ▼
   knowledge_base:<id>
        ▲
        │  parent_kb            ← one structural tuple per datasource
   data_source:<id>
        │  can_read / can_ingest / can_manage  = direct ∪ (inherited from parent_kb)
        ▼
   enforced by: BFF data_source#read filter + RAG server inject_kb_filter
```

## Tuples

**Structural (new, one per datasource):**
```
data_source:<id>  parent_kb  knowledge_base:<id>
```

**Access (written on the KB — unchanged shapes):**
```
team:<slug>#member  reader     knowledge_base:<id>
team:<slug>#member  ingestor   knowledge_base:<id>
team:<slug>#admin   manager    knowledge_base:<id>
user:<sub>          owner      knowledge_base:<id>
user:*              reader     knowledge_base:<id>      # public (inherited by the datasource)
```

**Component-only (optional, direct on data_source — Story 3):**
```
team:<slug>#member  ingestor   data_source:<id>          # ingest without KB read
```

## Validation / invariants

- **INV-1**: Each `data_source:<id>` has exactly one `parent_kb` edge (1:1 with its KB) after backfill. Datasources with no KB (none today) simply have no edge and rely on direct tuples.
- **INV-2**: `data_source:<id>#can_read` ⊇ `knowledge_base:<id>#can_read` (inheritance never narrows KB access).
- **INV-3**: A direct `ingestor` on `data_source:<id>` with no KB read grant yields `can_ingest = true`, `can_read = false` (component-only ingest is expressible — Story 3).
- **INV-4**: Removing a KB-level grant removes the inherited datasource permission with no separate `data_source` delete (FR-008).
- **INV-5**: Backfill is additive + idempotent; running it twice changes nothing (US2).

## State transitions

| Event | Tuple effect |
|-------|--------------|
| Datasource created | Write `data_source:<id> parent_kb knowledge_base:<id>` (replaces the old access dual-write). |
| Team granted KB read/ingest/admin | Write KB grant only; datasource access follows by inheritance. |
| Team grant revoked | Delete KB grant only; inherited datasource access disappears. |
| Datasource made public | Write `user:* reader knowledge_base:<id>` (inherited). |
| Datasource un-published | Delete `user:* reader knowledge_base:<id>`. |
| Datasource deleted | Delete `parent_kb` edge + any direct `data_source` tuples (FR-010). |
