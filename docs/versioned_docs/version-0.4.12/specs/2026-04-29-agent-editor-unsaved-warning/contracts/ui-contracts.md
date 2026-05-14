# UI Contracts: Agent Editor Unsaved Changes Warning

This feature has no API or external interface. Its contracts are React component / hook signatures consumed elsewhere in the UI. They are documented here so future changes have a clear stable surface to honor or evolve.

## Contract 1: `UnsavedChangesDialog` (modified, additive)

**File**: `ui/src/components/task-builder/UnsavedChangesDialog.tsx`

**Change**: add optional copy props with defaults that preserve today's Task Builder behavior.

```ts
interface UnsavedChangesDialogProps {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;

  // NEW — all optional, defaulted to current Task Builder copy
  title?: string;          // default: "Unsaved changes"
  description?: string;    // default: "You have unsaved changes in the Task Builder. They will be lost if you leave now."
  discardLabel?: string;   // default: "Discard changes"
  cancelLabel?: string;    // default: "Keep editing"
}
```

**Backward compatibility**: existing callers (`AppHeader`) continue to work unchanged. New callers (the agent editor and the agents-page tab guard) pass agent-editor-specific copy.

**Behavioral contract**:
- `open=false` renders nothing.
- Clicking the backdrop calls `onCancel` (preserves current behavior).
- The dialog never closes itself — the caller controls `open` via `onDiscard`/`onCancel`.

## Contract 2: `useUnsavedChangesStore` (unchanged)

**File**: `ui/src/store/unsaved-changes-store.ts`

**No schema or signature changes.** The store remains:

```ts
interface UnsavedChangesState {
  hasUnsavedChanges: boolean;
  pendingNavigationHref: string | null;

  setUnsaved: (dirty: boolean) => void;
  requestNavigation: (href: string) => void;
  cancelNavigation: () => void;
  confirmNavigation: () => string | null;
}
```

**New consumer obligations** (for the agent editor, by convention — not enforced by types):
- Call `setUnsaved(true|false)` only when the dirty value changes.
- Always call `setUnsaved(false)` on unmount cleanup.
- On successful save, call `setUnsaved(false)` *before* invoking the parent's `onSave` so the editor's unmount sequence sees a clean flag.

## Contract 3: `useEditorDirtyTracking` (new hook)

**File**: `ui/src/hooks/use-editor-dirty-tracking.ts`

A small reusable hook that captures a snapshot, compares against current values, and writes the dirty flag to `useUnsavedChangesStore`. Designed to be reusable by future editors (Rule of Three: this is the second editor needing dirty tracking; if a third arrives, this hook absorbs the duplication.)

```ts
/**
 * Tracks whether `currentValues` differs from a snapshot taken on mount,
 * and mirrors the result into the global useUnsavedChangesStore.
 *
 * - When `enabled` is false (e.g. read-only mode), the hook is inert and
 *   never writes to the store.
 * - The snapshot is taken once on mount, and re-taken when `snapshotKey`
 *   changes (use this to handle async-loaded defaults; pass a stable key
 *   like the source agent id, plus a sentinel that flips when defaults
 *   are applied).
 * - On unmount, always clears the global flag (`setUnsaved(false)`).
 */
export function useEditorDirtyTracking<T extends object>(args: {
  enabled: boolean;
  currentValues: T;
  snapshotKey: string;
  /** Optional custom equality (defaults to canonical-JSON of sorted top-level keys). */
  equals?: (a: T, b: T) => boolean;
}): { dirty: boolean; resetSnapshot: () => void };
```

**Return**:
- `dirty` — current computed dirty status (also written to the store).
- `resetSnapshot` — re-snapshot now using the latest `currentValues` (the editor calls this immediately before invoking `onSave` after a successful save, so any race in unmount ordering is harmless).

**Invariants**:
- When `enabled=false`, `dirty` is always `false` and the store is never written to (other than the unmount-time `setUnsaved(false)`).
- The hook owns the store's flag while mounted with `enabled=true`. It does not coordinate with other editors that may be mounted simultaneously — by design, only one editor is mounted at a time today (see data-model "What this feature does NOT model").

## Contract 4: `AppHeader.GuardedLink` (modified predicate)

**File**: `ui/src/components/layout/AppHeader.tsx`

**Change**: extend the predicate that decides whether to intercept clicks.

Before:

```ts
const isOnTaskBuilderEditor =
  pathname?.startsWith("/task-builder") && hasUnsavedChanges;
```

After:

```ts
const shouldGuardNavigation =
  hasUnsavedChanges &&
  (pathname?.startsWith("/task-builder") ||
   pathname?.startsWith("/dynamic-agents"));
```

The same predicate also gates rendering of the dialog at the bottom of `AppHeader`. The dialog rendered from the header uses **generic copy** (no Task-Builder-specific wording) so it serves both pages without confusion:

```text
title:       "Unsaved changes"
description: "You have unsaved changes. They will be lost if you leave now."
```

(Page-local dialogs — the back-button and tab-switch dialogs — use more specific copy because they know the context.)

## Contract 5: `DynamicAgentEditor` (modified internals)

**File**: `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx`

External props (`agent`, `cloneFrom`, `readOnly`, `onSave`, `onCancel`) are **unchanged**. Internal additions:

- A `useEditorDirtyTracking` call wired to all editable form fields, with `enabled = !readOnly`.
- A wrapper around the back-button click that, when `dirty` is true, sets a local `pendingClose` state and renders an `<UnsavedChangesDialog>` with agent-specific copy. Otherwise, the click flows directly to `onCancel` as today.
- Inside `handleSubmit`, on successful save: call `resetSnapshot()` then `setUnsaved(false)` then `onSave()`. (Both calls are belt-and-suspenders; either alone would work.)

## Contract 6: `DynamicAgentsPageContent` (modified `setActiveTab`)

**File**: `ui/src/app/(app)/dynamic-agents/page.tsx`

External behavior (URL `?tab=` query param) is unchanged. Internal addition:

- A new local `pendingTab: string | null` state.
- `setActiveTab(tab)` now reads `useUnsavedChangesStore`. If `hasUnsavedChanges` is true AND `tab !== activeTab`, it sets `pendingTab` and renders `<UnsavedChangesDialog>` instead of immediately pushing the new URL.
- "Discard changes" calls `setUnsaved(false)` and then performs the original `router.push`.
- "Keep editing" clears `pendingTab` and leaves the URL alone.

## Out-of-scope contracts

- **No new HTTP endpoints.** This feature touches no `/api/*` route.
- **No new MongoDB collections / fields.** Dirty state is ephemeral per editor session.
- **No telemetry/event contracts** in this feature; if telemetry on "discard vs keep" is wanted later, it's a follow-up.
