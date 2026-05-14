# Data Model: Fix Thinking Panel Re-Expand (095)

**Feature**: 095-fix-thinking-panel-expand  
**Date**: 2026-03-18

This feature is UI-only. No persistence or API changes. The following describes the state and inputs that drive the thinking panel behavior.

---

## Entities (logical)

### Message (existing)

- **Completion status**: Whether the message is final (streaming complete). Exposed as e.g. `message.isFinal` (boolean).
- When `true`, the response is complete and the thinking panel should default to collapsed when the message is displayed.

### Thinking panel state (local UI state)

- **Expanded / collapsed**: Boolean (e.g. `showRawStream`).
- **Initial value** (per mount):
  - If `message.isFinal === true` → initial value is **collapsed** (false).
  - Else → initial value is the **user default** (e.g. from feature flag `showThinking`).
- **After mount**: User can toggle; state is local to the component instance and resets on remount (e.g. when switching conversations).

### User preference (existing)

- **Default for streaming**: e.g. feature flag `showThinking` (boolean, default true). Used only when the message is not final.

---

## State transitions

- **On mount**: `showRawStream` is set once via `useState(initializer)` from `message.isFinal` and user default.
- **On user toggle**: `setShowRawStream` updates local state; no persistence.
- **On unmount/remount**: New instance; initial state is recomputed from current `message.isFinal` and user default.

No new entities or storage; only the rule for the initial value of existing local state is changed.
