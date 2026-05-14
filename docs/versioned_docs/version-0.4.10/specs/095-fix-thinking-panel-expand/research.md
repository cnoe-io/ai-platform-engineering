# Research: Fix Thinking Panel Re-Expand on Conversation Switch

**Feature**: 095-fix-thinking-panel-expand  
**Date**: 2026-03-18

## Phase 0 Summary

No open "NEEDS CLARIFICATION" items. The spec and codebase are sufficient to implement. This document records the chosen approach and rationale.

---

## Decision 1: Where to derive initial state

**Decision**: Derive the initial value of the thinking-panel expanded state inside the component that owns it (ChatMessage), using a lazy `useState(initializer)` so the value is computed once per mount from current props.

**Rationale**: The bug is that on remount (e.g. after switching conversations), the component re-runs and previously used a constant initial value. Making the initializer depend on `message.isFinal` and the user default ensures that (1) final messages default to collapsed, and (2) streaming messages still use the user preference, without introducing global or cross-component state.

**Alternatives considered**:
- Persist expand/collapse per message ID in URL or store: Rejected for scope; spec explicitly leaves per-message persistence out. Can be a follow-up.
- Move state up to a parent and pass down: Rejected; state is local to each message and remount is the norm when switching conversations; the fix is to make the initial state correct on each mount.

---

## Decision 2: Lazy initializer vs useEffect

**Decision**: Use a lazy `useState(() => ...)` initializer, not a `useEffect` that sets state after mount.

**Rationale**: The correct initial paint is "collapsed" for final messages. A lazy initializer gives that on first render and avoids a flash of "expanded" then "collapsed". React docs recommend lazy initializers when the initial state depends on props.

**Alternatives considered**:
- useEffect to set collapsed when message becomes final: Would still show expanded on first paint after navigation; adds an extra render and possible flicker.

---

## Decision 3: Test strategy

**Decision**: Rely on existing ChatPanel Jest tests; add or extend a test that asserts for a **final** message the thinking section is collapsed by default (e.g. collapsed or not expanded when `message.isFinal === true`).

**Rationale**: Constitution requires test-first; the existing "Thinking section (showRawStream)" tests cover default expanded. Adding a scenario for final messages ensures the new behavior is locked in and prevents regression.

**Alternatives considered**:
- E2E only: Less precise and slower; unit test is sufficient for this state logic.
- No new test: Rejected; constitution gate VII requires acceptance criteria to become test scenarios.
