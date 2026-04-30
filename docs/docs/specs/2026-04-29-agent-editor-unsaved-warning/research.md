# Phase 0 Research: Agent Editor Unsaved Changes Warning

All open questions from the spec's Technical Context were resolved by inspecting the existing codebase rather than external research; this is an integration with established in-repo patterns. No `NEEDS CLARIFICATION` markers remain.

## Decision 1: Reuse `useUnsavedChangesStore` instead of building a new state mechanism

- **Decision**: Reuse the existing Zustand store at `ui/src/store/unsaved-changes-store.ts` (`hasUnsavedChanges`, `pendingNavigationHref`, `setUnsaved`, `requestNavigation`, `cancelNavigation`, `confirmNavigation`).
- **Rationale**: The store already implements exactly the API the agent editor needs — a single boolean dirty flag and a pending-href slot for intercepted navigation. It is already wired into `AppHeader.GuardedLink`, so extending header-nav guarding to `/dynamic-agents` is a one-line predicate change. Adding a second consumer also keeps the store at "two real users", which by the Rule of Three does not yet justify a more general API.
- **Alternatives considered**:
  - *New per-feature Zustand slice* — rejected: doubles the store surface and forces `AppHeader` to read two stores.
  - *React Context provider in the editor* — rejected: the warning needs to be visible to `AppHeader` (rendered above the editor in the tree), so a context inside the editor cannot reach it.
  - *Generalize the store now (e.g., a registry of dirty editors)* — rejected per YAGNI and Rule of Three; only two consumers exist.

## Decision 2: Reuse `UnsavedChangesDialog`, parameterize copy via optional props

- **Decision**: Add optional `title`, `description`, `discardLabel`, `cancelLabel` props to `ui/src/components/task-builder/UnsavedChangesDialog.tsx`, defaulting to today's Task Builder copy. The agent editor passes its own description ("You have unsaved changes in the agent editor…").
- **Rationale**: Keeps visual parity (FR-014) with zero new components. The default props preserve current Task Builder behavior with no caller changes.
- **Alternatives considered**:
  - *Two separate dialog files* — rejected: pure duplication for one string.
  - *Move dialog into a shared `ui/components/ui/` location* — rejected as a follow-up cleanup; current path works fine and moving it is out of scope for this feature.

## Decision 3: Value-snapshot dirty detection (not event-based)

- **Decision**: On editor open, snapshot the initial form values into a ref. On every render, compute `dirty = !shallowEqualForm(snapshot, current)` and call `setUnsaved(dirty)` from an effect when it changes.
- **Rationale**: Matches the spec's edge case "field reverted to original value clears dirty" (Edge Cases, FR-001, SC-002). Event-based dirty (any `onChange` flips dirty true) would produce false positives.
- **Comparison strategy**: A small dedicated comparator that handles the editor's known field set:
  - Strings: strict equality.
  - String arrays (e.g., `sharedWithTeams`, `skills`): same length and same elements in order.
  - Objects (`allowedTools: Record<string, string[]>`, `builtinTools`, `features`, `model`): canonical-JSON compare (`JSON.stringify` after sorting top-level keys). The payload is tiny (≤ a few KB), so this is well under the 1ms budget.
  - `subagents`: array of `SubAgentRef` objects → canonical-JSON compare.
- **Alternatives considered**:
  - *Per-field `onChange` flips dirty* — rejected (false positives on revert).
  - *`react-hook-form` integration* — rejected as a much larger refactor for one feature.
  - *Deep-equal lib (e.g., `fast-deep-equal`)* — acceptable but adds a dep; the hand-rolled comparator on a known shape is simpler and avoids a new dependency.

## Decision 4: Where to call `setUnsaved`

- **Decision**: Inside the editor, in a single `useEffect` that depends on the comparator output. Call `setUnsaved(false)` in the editor's unmount cleanup so a stale dirty flag never leaks to other pages.
- **Rationale**: Single source of truth; avoids scattering `setUnsaved` calls across every input. Cleanup ensures that closing the editor (via discard or successful save) resets the global flag.
- **Save-flow handling**:
  - On **successful save**: call `setUnsaved(false)` *before* `onSave()` so the parent's unmount of the editor does not race the dirty flag.
  - On **failed save**: do nothing — the dirty effect will keep the flag true on the next render because the snapshot is unchanged.
- **Read-only mode**: skip the dirty effect entirely (early return) so config-driven agents never set the flag (FR-012).
- **Cloning**: snapshot is taken *after* the " (New)" suffix is applied to the name, so the form starts clean (Edge Cases).

## Decision 5: How to intercept the editor's back button

- **Decision**: Wrap the existing `onCancel` prop. If `hasUnsavedChanges` is true, set local `pendingClose: true` and render `<UnsavedChangesDialog>` inline within the editor. "Discard changes" calls `setUnsaved(false)` then `onCancel()`. "Keep editing" clears `pendingClose`.
- **Rationale**: `onCancel` is provided by `DynamicAgentsTab` and only flips local React state — there is no router involvement, so we don't need the store's `pendingNavigationHref` slot for this path. Keeping it local also means the parent (`DynamicAgentsTab`) needs no changes.
- **Alternatives considered**:
  - *Route the back action through `useUnsavedChangesStore.requestNavigation`* — rejected: the store's `pendingNavigationHref` is for hrefs; reusing it for "close editor" couples unrelated semantics.

## Decision 6: How to intercept Agents-page sub-tab clicks

- **Decision**: In `ui/src/app/(app)/dynamic-agents/page.tsx`, wrap `setActiveTab` so that when `hasUnsavedChanges` is true and the editor is mounted on the `agents` tab, it stores the requested tab id locally and renders `<UnsavedChangesDialog>`. "Discard changes" calls `setUnsaved(false)` then proceeds with the original `router.push`.
- **Rationale**: The tab switch is purely client-side router state (a query param). Local state inside the page component is sufficient and avoids extending the store with a "pending tab" concept.
- **Alternatives considered**:
  - *Use `requestNavigation` with a synthetic href* — rejected: the page already has its own `setActiveTab`; using it directly is clearer.

## Decision 7: How to intercept top-level header navigation

- **Decision**: In `ui/src/components/layout/AppHeader.tsx`, extend the existing `GuardedLink` predicate from
  `pathname?.startsWith("/task-builder") && hasUnsavedChanges`
  to also include
  `pathname?.startsWith("/dynamic-agents") && hasUnsavedChanges`.
  And extend the modal-render guard at the bottom of `AppHeader` the same way.
- **Rationale**: Minimal change; reuses the entire existing Task Builder mechanism. The dialog rendered by `AppHeader` continues to use Task Builder default copy *or* — if we want feature-perfect copy on the header path — the dialog renders generic copy ("You have unsaved changes. They will be lost if you leave now.") to cover both Task Builder and the agent editor. We choose the **generic copy** approach to keep one dialog instance in the header.
- **Alternatives considered**:
  - *Render a separate dialog instance per source* — rejected: two stacked dialogs is worse UX than one neutral message.
  - *Have each editor mount its own header-nav guard* — rejected: that's exactly what `useUnsavedChangesStore` exists to centralize.

## Decision 8: Out-of-scope navigation paths (browser refresh / tab close / browser back)

- **Decision**: Explicitly do not add a `beforeunload` listener or any other native browser interception.
- **Rationale**: The user request explicitly excludes "annoying browser pop-up". Spec FR-009 codifies this. Native browser back/refresh are listed in Assumptions as out of scope.

## Decision 9: Testing approach

- **Decision**:
  - Unit-test the dirty-tracking hook with synthetic before/after value pairs (revert-to-original returns false; any real change returns true; read-only mode never reports true).
  - Component-test `DynamicAgentEditor` for the back-button path: render, mutate a field, click back, assert dialog appears, click "Keep editing" → dialog gone & state intact, click "Discard changes" → `onCancel` invoked.
  - Component-test `AppHeader` `GuardedLink` for the `/dynamic-agents` predicate: with `hasUnsavedChanges=true` and `pathname="/dynamic-agents"`, clicking a link calls `requestNavigation` and prevents default.
  - Defer the page-tab interception test to the quickstart (manual) — Next.js App Router tabs are awkward to mount in Jest and the logic is a small wrapper.
- **Rationale**: Aligns with existing repo testing patterns (Jest + RTL for UI). Keeps automated tests focused on the value-bearing logic; uses manual verification for thin router glue.

## References (existing code reused)

- `ui/src/store/unsaved-changes-store.ts` — Zustand store (unchanged schema).
- `ui/src/components/task-builder/UnsavedChangesDialog.tsx` — dialog component (small additive props change).
- `ui/src/components/layout/AppHeader.tsx` — `GuardedLink` and modal mount (predicate extension).
- `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx` — adds dirty tracking + back-button guard.
- `ui/src/app/(app)/dynamic-agents/page.tsx` — adds sub-tab guard.
