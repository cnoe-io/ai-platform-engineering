# Quickstart: Verify Thinking Panel Fix (095)

**Feature**: 095-fix-thinking-panel-expand  
**Date**: 2026-03-18

## Prerequisites

- Repo at root: `ui/` with Next.js app and chat UI.
- Backend or mock that can serve conversations and streaming/final messages.

## Implementation checklist

1. **Code change** (single location in `ui/src/components/chat/ChatPanel.tsx`):
   - In `ChatMessage`, ensure the state that controls the thinking panel (e.g. `showRawStream`) is initialized with a **lazy initializer** that:
     - Returns `false` when `message.isFinal === true`.
     - Returns the user default (e.g. `showThinkingDefault`) otherwise.
   - Example pattern:
     ```ts
     const [showRawStream, setShowRawStream] = useState(() => {
       if (message.isFinal) return false;
       return showThinkingDefault;
     });
     ```

2. **Tests**:
   - Run: `make caipe-ui-tests` (or `cd ui && npm test -- --testPathPattern=ChatPanel`).
   - Add or update a test that, for a message with `isFinal: true`, asserts the thinking section is collapsed by default (e.g. not expanded, or the toggle shows collapsed state).

3. **Manual smoke test**:
   - Open a conversation, wait for a response to finish (thinking panel collapses).
   - Switch to another conversation, then back to the first.
   - **Pass**: The thinking panel for the completed message stays collapsed.
   - **Regression**: Start a new stream; the thinking panel should still follow the user's default (e.g. expanded if `showThinking` is true).

## Commands

```bash
# From repo root
make caipe-ui-tests

# Or from ui/
cd ui && npm test -- --testPathPattern=ChatPanel
```

## Success

- All existing ChatPanel tests pass.
- New/updated test for final-message default collapsed passes.
- Manual check: no re-expand when returning to a conversation with a completed response.
