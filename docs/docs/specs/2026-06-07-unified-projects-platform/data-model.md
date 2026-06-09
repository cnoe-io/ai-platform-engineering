# Data Model: Project Labels

Extends `ProjectDocument` (collection `projects`).

## New field: `labels`

| Field | Type | Notes |
|---|---|---|
| `labels.domain` | `string?` | Denormalized from the structural domain (`spec.domain` / catalog). Mirrors the existing top-level `domain`. Single-value. |
| `labels.initiatives` | `string[]` | BHAG / Initiative. Free-form, multi-value. |
| `labels.swimlanes` | `string[]` | Swim Lane. Free-form, multi-value. |

All optional; absent ⇒ treated as empty. The existing top-level `domain: string` stays for back-compat; `labels.domain` is kept in sync on write.

## Grouping / dedup

`normLabel(s) = s.trim().toLowerCase()`. Faceting + dashboard rollups group by `normLabel`; the **display value** is the first non-empty original seen. Filtering matches on `normLabel` too (case/whitespace-insensitive).

## Validation

- Trim; drop empties; dedup within a dimension by `normLabel`.
- No controlled vocabulary (FR-009 free-form).

## Indexes (non-unique)

- `{ "labels.domain": 1 }`
- `{ "labels.initiatives": 1 }` (multikey)
- `{ "labels.swimlanes": 1 }` (multikey)

## Relationships

- `labels.domain` ↔ a `catalog` entity of kind `domain` (by slug) when present; not enforced (free-form domains allowed).
