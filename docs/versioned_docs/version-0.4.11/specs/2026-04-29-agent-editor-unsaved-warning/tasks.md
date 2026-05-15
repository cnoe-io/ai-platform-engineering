---

description: "Task list — Warn user about losing unsaved changes in dynamic agent editor"
---

# Tasks: Warn User About Losing Unsaved Changes in Dynamic Agent Editor

**Input**: Design documents from `/docs/docs/specs/2026-04-29-agent-editor-unsaved-warning/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contracts.md, quickstart.md

**Tests**: Tests are included for the dirty-tracking hook and the back-button interception path because the spec's success criteria (SC-001 through SC-005) and edge cases (revert clears dirty, save success/failure, read-only, cloning) are non-trivial behaviors that warrant automated coverage. The page-tab and header-nav paths are verified via the quickstart (manual) — those are thin router glue and harder to fixture.

**Organization**: Tasks are grouped by user story (P1 back-button, P1 sub-tab, P2 header-nav). Each story is independently testable per the spec.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = back-button (P1), US2 = sub-tab switch (P1), US3 = header-nav (P2)
- All paths are absolute from the repo root.

## Path Conventions

- Frontend-only feature inside the `ui/` Next.js workspace.
- Source: `ui/src/...`
- Tests: co-located `*.test.ts(x)` next to the file under test (existing repo convention — see `ui/jest.config.js` for any deviations).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Sanity-check the dev environment before any code change. This feature adds no new dependencies, so setup is minimal.

- [X] T001 Verify the UI workspace builds and lints cleanly on the current branch by running `npm run lint` and `npm run build` in `ui/`. Capture baseline output so post-change runs can be compared.
- [X] T002 Verify Jest is configured for `ui/` and that an existing UI test runs (e.g., `npm test -- --listTests` or run any one suite). Confirms the test runner works before new tests are added.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Generalize the shared dialog and add the reusable dirty-tracking hook. Both are consumed by every user story below, so they must land first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Generalize `ui/src/components/task-builder/UnsavedChangesDialog.tsx` per `contracts/ui-contracts.md` Contract 1: add optional `title`, `description`, `discardLabel`, `cancelLabel` props with defaults that exactly preserve current Task Builder copy. Do not change layout, styles, animation, or default behavior. The existing `AppHeader` consumer must continue to work with no change.
- [X] T004 [P] Create `ui/src/hooks/use-editor-dirty-tracking.ts` implementing `useEditorDirtyTracking` per `contracts/ui-contracts.md` Contract 3 and `data-model.md` Entities 1, 3, 4. Behavior:
  - Snapshot `currentValues` on mount and whenever `snapshotKey` changes.
  - Compare current vs snapshot using a value-based comparator (default: canonical JSON of sorted top-level keys; allow caller-provided `equals`).
  - When `enabled=false`, hook is inert (never writes to the global store except the unmount cleanup).
  - On every render where computed `dirty` differs from the previously written value, call `useUnsavedChangesStore.getState().setUnsaved(dirty)` from a `useEffect`.
  - Provide `resetSnapshot()` that re-snapshots `currentValues` immediately and writes `setUnsaved(false)`.
  - Unmount cleanup always calls `setUnsaved(false)`.
- [X] T005 [US1][US2][US3] Add unit tests for the dirty hook in `ui/src/hooks/use-editor-dirty-tracking.test.ts` covering:
  - Mount with `enabled=false` → store flag stays false even when values change.
  - Mount with `enabled=true`, values unchanged → flag stays false.
  - Mutate one field → flag becomes true.
  - Revert that field to original value → flag becomes false (per spec FR-001 / SC-002 / Edge Case "field reverted to original value").
  - Object-shaped fields (`Record<string, string[]>`, optional `undefined` vs `{}`) treated as equal when semantically equal (per `data-model.md` validation rules).
  - `resetSnapshot()` clears dirty even after edits.
  - Unmount calls `setUnsaved(false)` even when dirty was true.

**Checkpoint**: Foundation ready — the dialog accepts custom copy without breaking Task Builder, and the dirty hook is tested. User stories can now proceed in parallel.

---

## Phase 3: User Story 1 — Warn when leaving editor via back button (Priority: P1) 🎯 MVP

**Goal**: Clicking the editor's back arrow with unsaved changes shows the in-app modal instead of silently discarding work. The MVP — fixing only this path already prevents the most common loss-of-work scenario.

**Independent Test**: Open the dynamic agent editor (create or edit), modify any field, click the back arrow → in-app modal appears. "Keep editing" preserves all edits; "Discard changes" returns to the agent list.

### Tests for User Story 1 ⚠️

> Write these tests FIRST and confirm they fail before implementation.

- [X] T006 [P] [US1] Component test in `ui/src/components/dynamic-agents/DynamicAgentEditor.unsaved.test.tsx` covering the back-button flow:
  - Render `<DynamicAgentEditor agent={fixture} />` with mocked `onCancel` and `onSave`.
  - Without changes, click the back arrow → `onCancel` invoked, no dialog rendered.
  - Mutate the name field, click back arrow → dialog renders, `onCancel` NOT invoked.
  - Click "Keep editing" → dialog removed, name field still has the edited value, `onCancel` NOT invoked.
  - Mutate again, click back arrow, click "Discard changes" → dialog removed, `onCancel` invoked once.
  - With `readOnly` prop true, mutate a field via direct state poke is impossible (fields disabled) — assert `useUnsavedChangesStore.getState().hasUnsavedChanges` stays false (FR-012).
  - Save flow: stub the network call to succeed, click Save → `setUnsaved(false)` is observed before `onSave` is invoked (FR-010); then clicking back must not show the dialog.
  - Save flow failure: stub the network to reject, click Save → flag remains true (FR-011); then clicking back shows the dialog.

### Implementation for User Story 1

- [X] T007 [US1] Wire `useEditorDirtyTracking` into `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx`:
  - Build a `currentValues` object aggregating all editable form fields per `data-model.md` Entity 2 (`name`, `description`, `systemPrompt`, `visibility`, `sharedWithTeams`, `allowedTools`, `builtinTools`, `subagents`, `skills`, `features`, `modelId`, `modelProvider`, `gradientTheme`).
  - Choose `snapshotKey` so it changes when the editor source identity changes AND once when the async model defaults are applied (per `data-model.md` "Special handling — model defaults"). A two-part key like `${agent?._id ?? cloneFrom?._id ?? "new"}|${modelsResolvedSentinel}` works.
  - Pass `enabled = !readOnly`.
- [X] T008 [US1] Intercept the back button in `DynamicAgentEditor.tsx`:
  - Add local state `pendingClose: boolean`.
  - Replace the inline `onClick={onCancel}` on the `ArrowLeft` `Button` with a wrapper: if `dirty` from the hook → `setPendingClose(true)`; else → call `onCancel()` directly.
  - Render `<UnsavedChangesDialog open={pendingClose} onCancel={() => setPendingClose(false)} onDiscard={() => { setPendingClose(false); setUnsaved(false); onCancel(); }} title="Unsaved changes" description="You have unsaved changes in the agent editor. They will be lost if you leave now." />`.
- [X] T009 [US1] Update `handleSubmit` in `DynamicAgentEditor.tsx` to clear the dirty flag on a successful save:
  - On success: call `resetSnapshot()` (from the hook) AND `useUnsavedChangesStore.getState().setUnsaved(false)` BEFORE invoking `onSave()`. This is belt-and-suspenders and matches `research.md` Decision 4.
  - On failure: do nothing extra — the dirty effect will keep the flag true on the next render because the snapshot is unchanged.
- [X] T010 [US1] Add a brief inline comment in `DynamicAgentEditor.tsx` at the dirty-tracking call site explaining *why* the snapshot key includes a "models resolved" sentinel (the async-loaded model defaults can otherwise appear as dirty against an empty snapshot — see `research.md` Decision 4 and `data-model.md` Validation rules). Per the constitution, comments explain *why*, not *what*.

**Checkpoint**: At this point, User Story 1 is fully functional. Run the relevant sections of `quickstart.md` ("P1 — Back button warns when dirty", "Negative — does not warn when not dirty", "Negative — does not warn for read-only / config-driven agents", "Negative — wizard step navigation does not warn", "Save flows — clears dirty correctly", "Edge — revert clears dirty", "Cloning — starts clean").

---

## Phase 4: User Story 2 — Warn when switching sub-tabs on the Agents page (Priority: P1)

**Goal**: While the editor is open with unsaved changes, clicking a sibling sub-tab (MCP Servers / LLM Models / Conversations) shows the in-app modal and the URL does not change until the user confirms discard.

**Independent Test**: Open the editor, modify any field, click MCP Servers (or any sibling sub-tab) → modal appears. "Keep editing" cancels the switch; "Discard changes" completes it.

### Implementation for User Story 2

- [X] T011 [US2] Modify `ui/src/app/(app)/dynamic-agents/page.tsx` to guard tab switches per `contracts/ui-contracts.md` Contract 6:
  - Add `pendingTab: string | null` local state.
  - Wrap `setActiveTab(tab)`: if `useUnsavedChangesStore.getState().hasUnsavedChanges` is true AND `tab !== activeTab`, call `setPendingTab(tab)` and return without modifying the URL. Otherwise, proceed with the existing `router.push` logic.
  - Render `<UnsavedChangesDialog open={pendingTab !== null} onCancel={() => setPendingTab(null)} onDiscard={() => { const t = pendingTab; setPendingTab(null); useUnsavedChangesStore.getState().setUnsaved(false); if (t) { /* original router.push from existing setActiveTab */ } }} title="Unsaved changes" description="You have unsaved changes in the agent editor. They will be lost if you switch tabs." />`.
  - Extract the inner "do the tab switch" body into a small private function so both the un-guarded path and the discard handler call the same code (Rule of Three not yet met for two call sites, but extraction here keeps them in sync — acceptable.)

**Checkpoint**: User Stories 1 and 2 both pass their quickstart sections. Run "P1 — Sub-tab switch warns when dirty" from `quickstart.md`.

---

## Phase 5: User Story 3 — Warn when leaving the page via top-level navigation (Priority: P2)

**Goal**: While the editor is open with unsaved changes, clicking any top-level header link (Home, Chat, Skills, Task Builder, Knowledge Bases, Admin, the logo) is intercepted with the same modal pattern that already exists for Task Builder.

**Independent Test**: Open the editor, modify any field, click a header link (e.g., Chat) → modal appears. "Keep editing" stays on the page; "Discard changes" navigates to the destination.

### Tests for User Story 3 ⚠️

- [X] T012 [US3] Component test in `ui/src/components/layout/AppHeader.unsaved-dynamic-agents.test.tsx` covering the predicate extension:
  - Mock `usePathname` to return `/dynamic-agents`. Mock the store with `hasUnsavedChanges: true`.
  - Render `<AppHeader />`. Click a `GuardedLink` (e.g., the Home link) → expect `requestNavigation(href)` to be called and the link's default navigation prevented.
  - With `hasUnsavedChanges: false` and same pathname → click → navigates normally (no `requestNavigation` call).
  - With `hasUnsavedChanges: true` but `pathname='/some-other-page'` → click → navigates normally (the predicate must match the current path family).
  - With `pathname='/task-builder'` and `hasUnsavedChanges: true` → behavior unchanged from today (regression check).

### Implementation for User Story 3

- [X] T013 [US3] In `ui/src/components/layout/AppHeader.tsx`, extend the `GuardedLink` predicate per `contracts/ui-contracts.md` Contract 4:
  - Replace `const isOnTaskBuilderEditor = pathname?.startsWith("/task-builder") && hasUnsavedChanges;` with `const shouldGuardNavigation = hasUnsavedChanges && (pathname?.startsWith("/task-builder") || pathname?.startsWith("/dynamic-agents"));`
  - Apply the same predicate to the `isOnTaskBuilderEditor` usage further down that controls dialog rendering (rename the variable in both places to `shouldGuardNavigation` for clarity).
- [X] T014 [US3] Switch the `AppHeader`-rendered `<UnsavedChangesDialog>` to generic copy per `contracts/ui-contracts.md` Contract 4:
  - `title="Unsaved changes"`, `description="You have unsaved changes. They will be lost if you leave now."` (covers both Task Builder and the agent editor without confusion).
  - Verify Task Builder regression: existing Task Builder UX still warns on header nav and the user can still discard/keep.

**Checkpoint**: All three user stories independently functional. Run "P2 — Top-level header navigation warns when dirty" from `quickstart.md`, plus the Task Builder regression check (open Task Builder, dirty it, click a header link → modal still appears).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification across all stories, plus a final lint/build/test gate per Constitution VI.

- [X] T015 Run the full `quickstart.md` end-to-end against a local dev server (`cd ui && npm run dev`). Each section must behave as described, including all negative cases (no false positives, native browser refresh is intentionally NOT blocked, wizard step navigation never warns).
- [X] T016 Run `cd ui && npm run lint` and resolve any new warnings introduced by this feature only. Pre-existing lints are out of scope.
- [X] T017 Run `cd ui && npm test` and confirm:
  - The new `use-editor-dirty-tracking.test.ts` passes.
  - The new `DynamicAgentEditor.unsaved.test.tsx` passes.
  - The new `AppHeader.unsaved-dynamic-agents.test.tsx` passes.
  - No previously-passing test regressed (especially Task Builder–related tests).
- [X] T018 Run `cd ui && npm run build` to confirm the production build succeeds with no new TypeScript errors.
- [X] T019 [P] Update `ui/src/components/dynamic-agents/ARCHITECTURE.md` (if present) with a one-paragraph note about the unsaved-changes warning behavior pointing to this spec at `docs/docs/specs/2026-04-29-agent-editor-unsaved-warning/`. Skip if the file does not exist — do NOT create new docs proactively.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories — both T003 (dialog) and T004 (hook) must land before any story implementation; T005 (hook tests) can run in parallel with story work but should land before merge.
- **User Story 1 (Phase 3)**: Depends on Foundational. T006 (test) before T007–T010 (implementation) per TDD note.
- **User Story 2 (Phase 4)**: Depends on Foundational. Independent of US1.
- **User Story 3 (Phase 5)**: Depends on Foundational. Independent of US1 and US2.
- **Polish (Phase 6)**: Depends on all desired user stories.

### User Story Dependencies

- **US1 (back button, P1)**: Needs T003 + T004. No dependency on US2 or US3.
- **US2 (sub-tab switch, P1)**: Needs T003 + T004 (consumes the same dirty flag US1 sets). Functionally depends on US1 having wired `setUnsaved` from inside the editor (T007), since without dirty wiring the tab guard would never fire — so in practice **US2 implementation should land after T007**, even though they touch different files. Marked here because it affects scheduling.
- **US3 (header nav, P2)**: Needs T003 + T004 + T007 (same reasoning — the editor must be writing the dirty flag for the header guard to have anything to react to).

### Within Each User Story

- US1: T006 (test) → T007 → T008 → T009 → T010.
- US2: T011 (single implementation task; manual verification via quickstart).
- US3: T012 (test) → T013 → T014.

### Parallel Opportunities

- **T003 and T004** are different files with no inter-dependency → run in parallel.
- **T005** (hook tests) is a different file from T003/T004's implementation → can be authored in parallel with US1 implementation, but should be reviewed/landed alongside Phase 2.
- **US2 and US3 implementation** are independent of each other once T007 is done → can be picked up by different developers.
- **T019** (optional doc note) is independent of all test/lint/build tasks in Polish.

---

## Parallel Example: After Foundational

```bash
# Two developers can split work after T007 lands:
Developer A: T011 (US2 — sub-tab guard in app/(app)/dynamic-agents/page.tsx)
Developer B: T012 → T013 → T014 (US3 — AppHeader predicate + test + dialog copy)
```

```bash
# Foundational tasks themselves can overlap:
Task: "T003 — generalize UnsavedChangesDialog props (task-builder/UnsavedChangesDialog.tsx)"
Task: "T004 — create useEditorDirtyTracking hook (hooks/use-editor-dirty-tracking.ts)"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup (T001–T002).
2. Complete Phase 2: Foundational (T003–T005). CRITICAL — blocks all stories.
3. Complete Phase 3: User Story 1 (T006–T010).
4. STOP and validate: run the back-button sections of `quickstart.md`. This alone delivers the largest fraction of the value (most users discard work via the back arrow, per the spec's prioritization).
5. Optional: ship the MVP at this point. The remaining stories add coverage for less common paths.

### Incremental Delivery

1. Setup + Foundational → ready.
2. Add US1 → validate back-button paths → ship as MVP.
3. Add US2 → validate sub-tab paths.
4. Add US3 → validate header-nav paths and Task Builder regression.
5. Polish (T015–T019) → final lint/build/test gate.

### Parallel Team Strategy

With two developers:

1. Both pair briefly on Phase 1 + Phase 2 to align on the hook contract.
2. Once T003 + T004 + T007 are merged:
   - Developer A: US2 (T011).
   - Developer B: US3 (T012 → T013 → T014).
3. Polish (Phase 6) is owned by whoever finishes their story first.

---

## Notes

- This is a frontend-only feature; no backend changes, no new dependencies, no schema changes.
- [P] tasks are in different files with no incomplete dependencies.
- All tasks follow `[checkbox] [TaskID] [P?] [Story?] description-with-path` per the format spec.
- Tests intentionally cover the value-bearing logic (dirty hook, back-button intercept, header predicate). Page-tab interception (T011) is deliberately verified manually — Next.js App Router page components are awkward to mount in Jest and the logic is a thin wrapper.
- Constitution checks: every task respects YAGNI (no speculative `beforeunload` handler, no per-field dirty tracking, no new abstraction beyond what two consumers need today). The new hook (T004) is the only new abstraction and it's introduced because two real consumers will share it.
- Commit after each task or each logical group, using Conventional Commits + DCO sign-off (`git commit -s -m "feat(ui): ..."`).
