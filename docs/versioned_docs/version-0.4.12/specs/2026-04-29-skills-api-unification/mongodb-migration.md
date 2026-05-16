# MongoDB: `agent_skills` — migration notes (Skills API unification)

**Spec**: [spec.md](./spec.md)  
**Collection**: `agent_skills`  
**Applies to**: CAIPE UI API routes, supervisor merge of persisted skills, optional template import rows.

---

## 1. This feature: collection rename **not** required

The Skills API unification changes **HTTP paths** and **application behavior** only. Per FR-003 and spec assumptions, the persisted store remains the existing collection:

| Item | Action for this release |
|------|-------------------------|
| Collection name | Keep **`agent_skills`** |
| `renameCollection` | **Not required** |
| Data copy to a new collection | **Not required** |
| Downtime for DB cutover | **None** (for collection rename) |

**Operational checklist**: No Mongo shell / Ops migration script is mandatory to ship URL unification + template import.

---

## 2. Schema evolution (additive, lazy)

New or updated documents may include optional metadata used for template import and deduplication:

| Field | Purpose |
|-------|---------|
| `metadata.template_source_id` | Logical key for a packaged template; used with `is_system` for idempotent import |
| `metadata.import_kind` | e.g. `helm_template_v1` — provenance for ops/debugging |

**Older documents** without these fields remain valid. Application code should treat missing `metadata.template_source_id` as “not imported from this mechanism” or legacy.

No one-time `$set` migration is **required** unless product policy demands backfilling provenance for audit; that would be a separate chore.

---

## 3. Indexes (optional, performance)

If query patterns add filters such as `{ is_system: true, "metadata.template_source_id": <id> }`, consider a compound index after observing slow queries:

```javascript
db.agent_skills.createIndex(
  { is_system: 1, "metadata.template_source_id": 1 },
  { name: "agent_skills_system_template_source", sparse: true }
);
```

`sparse: true` is optional and only helps if many documents omit `template_source_id`. Validate against your MongoDB version and existing indexes to avoid redundancy.

Existing indexes on `id` or `owner_id` (if any) stay as-is unless your DBA consolidation policy says otherwise.

---

## 4. Backup and safety

- Before any **bulk** update script (optional backfill, mass tag, or repair), take a **backup** or snapshot per org policy.
- Template import should use **upsert/skip** semantics, not blind `insertMany` without dedupe, to avoid duplicate business keys.

---

## 5. Future: renaming `agent_skills` (out of scope for this spec)

Renaming the collection is explicitly **out of scope** for [spec.md](./spec.md). If a later initiative renames it (e.g. to `skill_configs`), a typical **forward** sequence is:

1. Freeze writes or deploy dual-read (app reads both collections during transition — only if implemented in code).
2. `mongosh`: `db.agent_skills.renameCollection("skill_configs")` on the target DB (requires permissions; see [MongoDB renameCollection](https://www.mongodb.com/docs/manual/reference/command/renameCollection/)).
3. Update **every** consumer: UI `getCollection("...")`, supervisor, jobs, and any scripts.
4. Recreate **indexes** on the new namespace if they were dropped or not carried over.
5. Verify supervisor merged catalog and UI CRUD against staging.

**Rollback**: Rename back to `agent_skills` only if no application has written new data under the new name, or restore from backup.

This section is **reference only** — do not execute as part of the 2026-04-29 unification feature unless a separate ADR/spec authorizes collection rename.

---

## 6. Summary

| Question | Answer |
|----------|--------|
| Must we migrate data to a new collection for API unification? | **No** |
| Must we run a mandatory Mongo script on deploy? | **No** |
| What changes in the database? | **Optional** new fields on new/updated docs; optional indexes if needed |
| Where is the breaking change? | **HTTP API paths** (application/clients), not the collection name |
