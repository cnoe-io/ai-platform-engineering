# Phase 1 Data Model: Agent Editor Unsaved Changes Warning

This feature is UI-only — there is no persistent storage, no database table, and no server-side state. The "data model" here is the **in-memory state shape** that drives the warning behavior.

## Entity 1: Editor Form Snapshot

The set of values the editor was opened with, captured once at mount (or whenever the editor's `agent`/`cloneFrom` source identity changes).

| Field | Type | Source on open |
|-------|------|----------------|
| `name` | `string` | `agent.name`, or `cloneFrom.name + " (New)"`, or `""` |
| `description` | `string` | `source.description ?? ""` |
| `systemPrompt` | `string` | `source.system_prompt ?? ""` |
| `visibility` | `"private" \| "team" \| "global"` | `source.visibility ?? "private"` |
| `sharedWithTeams` | `string[]` | `source.shared_with_teams ?? []` |
| `allowedTools` | `Record<string, string[]>` | `source.allowed_tools ?? {}` |
| `builtinTools` | `BuiltinToolsConfig \| undefined` | `source.builtin_tools` |
| `subagents` | `SubAgentRef[]` | `source.subagents ?? []` |
| `skills` | `string[]` | `source.skills ?? []` |
| `features` | `FeaturesConfig \| undefined` | `source.features` |
| `modelId` | `string` | `source.model?.id ?? ""` (may be replaced by default after `/api/dynamic-agents/models` resolves) |
| `modelProvider` | `string` | `source.model?.provider ?? ""` (same caveat) |
| `gradientTheme` | `string` | `source.ui?.gradient_theme ?? "default"` |

**Lifecycle**: created on editor mount or when source identity changes; immutable thereafter for that editor session.

**Special handling — model defaults**: `modelId` and `modelProvider` may be filled in asynchronously by the models API after the snapshot is taken. The snapshot is **re-taken once** when the model API resolves and applies a default to a previously empty model field. After that, the snapshot is locked. This prevents the "models loaded → form differs from empty snapshot → false dirty" bug.

## Entity 2: Editor Form Current Values

The same shape as the snapshot, but reactive React state inside `DynamicAgentEditor`. These already exist today as individual `useState` hooks (see `DynamicAgentEditor.tsx` lines ~165–193). No structural change to current state — only a new derived computation reads them.

## Entity 3: Dirty Flag (per-editor, derived)

| Field | Type | Notes |
|-------|------|-------|
| `dirty` | `boolean` | `true` iff any field in **Current Values** differs from the same field in **Snapshot**, per the comparator below. |

**Derivation rules**:
- Strings: `a === b`.
- String arrays: same length and `a[i] === b[i]` for all `i` (order matters for `sharedWithTeams`, `skills`).
- Plain objects (`allowedTools`, `builtinTools`, `features`, `model`): canonical JSON equality (sort top-level keys, then `JSON.stringify`-compare).
- `subagents`: canonical JSON equality of the full array.
- If the editor is in **read-only mode** (`readOnly === true`), `dirty` is forced to `false` regardless of values (FR-012).

## Entity 4: Global Unsaved-Changes State (Zustand store, unchanged)

Already exists in `ui/src/store/unsaved-changes-store.ts`. Schema is **not changed** by this feature; only a new consumer (`DynamicAgentEditor`) writes to it.

| Field | Type | Owner / writer |
|-------|------|----------------|
| `hasUnsavedChanges` | `boolean` | Currently: Task Builder editor. After this feature: also `DynamicAgentEditor`. |
| `pendingNavigationHref` | `string \| null` | `AppHeader.GuardedLink` writes via `requestNavigation`. |

**State transitions (writer side, agent editor)**:

```
initial mount → setUnsaved(false)
form value changes such that dirty becomes true → setUnsaved(true)
form value changes such that dirty becomes false (revert) → setUnsaved(false)
successful save → setUnsaved(false), then onSave()
failed save → no change (dirty stays true)
discard via dialog → setUnsaved(false), then onCancel() / proceed
unmount → setUnsaved(false) (cleanup)
```

## Entity 5: Pending Local Navigation Intent

Local component state inside the editor and inside the dynamic-agents page; **not** in the global store.

| Where | Field | Type | Purpose |
|-------|-------|------|---------|
| `DynamicAgentEditor` | `pendingClose` | `boolean` | True when the back button was clicked while dirty; drives the in-editor dialog. |
| `DynamicAgentsPageContent` | `pendingTab` | `string \| null` | Tab id the user requested while dirty; drives the in-page dialog. |

The header-nav path uses the existing global `pendingNavigationHref` slot already owned by `AppHeader`; no new field needed.

## Validation rules

- The dirty comparator MUST treat `undefined` and `null` for object-shaped fields (`builtinTools`, `features`) as equal to a missing source value, to avoid false dirty on first render before optional fields are populated.
- Empty array `[]` and missing array (`undefined`) are equivalent for `sharedWithTeams`, `subagents`, `skills` for the same reason.
- The snapshot MUST be taken after the " (New)" suffix is appended to the cloned name (for cloning flow). The snapshot taken at the wrong time is the source of the most likely bug class for this feature; it deserves a dedicated test.

## What this feature does NOT model

- No persistence layer (the dirty flag never hits MongoDB or local storage).
- No server-side validation state — server save responses simply leave or clear the dirty flag depending on success.
- No undo/redo stack. "Discard changes" throws away all in-progress edits; it does not put them on a stack to recover.
- No multi-editor scenario (only one `DynamicAgentEditor` is mounted at a time today).
