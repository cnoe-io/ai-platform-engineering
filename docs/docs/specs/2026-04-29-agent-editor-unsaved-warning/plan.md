# Implementation Plan: Warn User About Losing Unsaved Changes in Dynamic Agent Editor

**Branch**: `2026-04-29-agent-editor-unsaved-warning` | **Date**: 2026-04-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/docs/docs/specs/2026-04-29-agent-editor-unsaved-warning/spec.md`

## Summary

Prevent silent loss of in-progress work in the dynamic agent editor by warning the user with an in-app modal whenever they try to leave the editor with unsaved changes. The warning fires on three navigation paths: the editor's back button (P1), sibling sub-tab clicks on the Agents page (P1), and top-level header navigation links (P2). No native browser dialogs.

Technical approach: extend the existing global `useUnsavedChangesStore` (already used by Task Builder) so the dynamic agent editor can register dirty state. Reuse the existing `UnsavedChangesDialog` component, lightly generalized to accept custom title/description copy. Add navigation guards in three places: (1) the editor's `onCancel` handler, (2) the Agents page tab switcher, and (3) the `AppHeader` `GuardedLink` component (extend its current `pathname.startsWith("/task-builder")` check to also cover `/dynamic-agents` when the store reports unsaved changes).

Dirty-state detection is value-based: snapshot the editor's initial form values on open, compare current values to the snapshot on every render. This avoids false positives when a user types and then reverts.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Next.js 16 (App Router)
**Primary Dependencies**: Zustand (state store, already in repo), existing `@/components/ui/*` primitives, `lucide-react` icons
**Storage**: N/A — UI state only, lives in memory (`useUnsavedChangesStore` Zustand instance) for the editor session
**Testing**: Jest + React Testing Library (UI tests). Manual verification via the quickstart for the three navigation paths.
**Target Platform**: Browser (modern evergreen — same as the rest of the CAIPE UI)
**Project Type**: Web application — frontend changes only (`ui/` workspace)
**Performance Goals**: Dirty-state comparison runs on every render of the editor; must remain O(fields) and complete in <1ms for the realistic agent-config payload (≤50 fields, ≤a few KB total). No noticeable input lag on form changes.
**Constraints**:
- No native browser dialogs (no `window.confirm`, no `beforeunload` hooks).
- Must reuse the existing `UnsavedChangesDialog` to keep visual parity with the Task Builder warning.
- Must not regress the existing Task Builder unsaved-changes behavior.
- Read-only / config-driven agents must never trigger the warning.
- Wizard step navigation inside the editor preserves state and must never warn.
**Scale/Scope**: Single editor (one mounted `DynamicAgentEditor` at a time), at most one active warning modal at a time, three navigation interception sites. Roughly 4–6 files touched in `ui/src/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Worse is Better | PASS | Reuses the existing Zustand store and dialog instead of inventing a new abstraction. The dirty check is a straightforward value comparison; no React Context, no provider tree, no router middleware. |
| II. YAGNI | PASS | Implements only the three navigation paths in the spec. Does NOT add browser-back/refresh interception, debounced dirty checks, or per-field dirty tracking — none are required by the spec. |
| III. Rule of Three | PASS | This is the second consumer of `useUnsavedChangesStore` (Task Builder is the first). The store remains a single boolean + pending-href; no premature generalization. The dialog gains optional copy props (a minor parameterization) only because two consumers now need different wording. |
| IV. Composition over Inheritance | PASS | All new behavior is composed from a hook (`useEditorDirtyTracking`), the existing store, and the existing dialog component. No class hierarchy. |
| V. Specs as Source of Truth | PASS | Spec at `docs/docs/specs/2026-04-29-agent-editor-unsaved-warning/spec.md` drives this plan; this plan does not introduce requirements absent from the spec. |
| VI. CI Gates Are Non-Negotiable | PASS | All changes pass `npm run lint` and `npm run build` in `ui/`; new Jest tests for dirty-state hook and dialog interception are included in tasks. |
| VII. Security by Default | PASS | Pure UI behavior, no secrets, no external inputs, no new network calls, no prompt injection surface. |

**Coding Practices**:
- TypeScript types for all new props/hooks. PASS (planned).
- Imports at top, organized. PASS (planned).
- No `console.log`/`print` in production paths. PASS (planned — only existing diagnostic logs, none added).
- Comments explain *why*, not *what*. PASS (planned).

**Result**: All gates pass. No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-04-29-agent-editor-unsaved-warning/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (UI state model, not a DB model)
├── quickstart.md        # Phase 1 output (manual verification recipe)
├── contracts/
│   └── ui-contracts.md  # Component/hook contracts (this is a UI feature, not an API)
├── checklists/
│   └── requirements.md  # From /speckit.specify
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

This is a frontend-only change inside the existing Next.js `ui/` workspace. No backend code is touched.

```text
ui/
├── src/
│   ├── components/
│   │   ├── dynamic-agents/
│   │   │   ├── DynamicAgentEditor.tsx        # MODIFIED — dirty tracking, guarded onCancel
│   │   │   └── DynamicAgentsTab.tsx          # (no changes; receives onSave/onCancel as today)
│   │   ├── layout/
│   │   │   └── AppHeader.tsx                 # MODIFIED — extend GuardedLink to /dynamic-agents
│   │   └── task-builder/
│   │       └── UnsavedChangesDialog.tsx      # MODIFIED — optional title/description/labels props
│   ├── app/(app)/dynamic-agents/
│   │   └── page.tsx                          # MODIFIED — guard tab switcher
│   ├── hooks/
│   │   └── use-editor-dirty-tracking.ts      # NEW — value-snapshot dirty hook + store wiring
│   └── store/
│       └── unsaved-changes-store.ts          # (no schema change; new consumer)
└── tests/                                    # (or co-located *.test.tsx — follow existing repo convention)
    └── dynamic-agents/
        ├── use-editor-dirty-tracking.test.ts
        └── DynamicAgentEditor.unsaved.test.tsx
```

**Structure Decision**: Frontend-only change inside `ui/`. Edits cluster around three existing files and add one small hook. The Zustand store schema is unchanged — only a new consumer is added — which is intentional (Rule of Three: two consumers do not yet justify generalizing the store further).

## Complexity Tracking

> No constitution violations. This section intentionally empty.
