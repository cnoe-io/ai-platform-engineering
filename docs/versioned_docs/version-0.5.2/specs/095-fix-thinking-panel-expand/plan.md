# Implementation Plan: Fix Thinking Panel Re-Expand on Conversation Switch

**Branch**: `095-fix-thinking-panel-expand` | **Date**: 2026-03-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/095-fix-thinking-panel-expand/spec.md`

## Summary

When a message has completed streaming, the thinking/plan panel must default to **collapsed** when the message is (re)displayed—e.g. when the user switches back to the conversation. Today, component remount on conversation switch re-initializes local state from a single default (expanded), causing the panel to re-expand every time. The fix is to derive the **initial** expand/collapse state from message completion status: if `message.isFinal` then default to collapsed; otherwise keep honoring the user's default (e.g. feature flag `showThinking`).

## Technical Context

**Language/Version**: TypeScript (UI), React 19  
**Primary Dependencies**: Next.js 16, React, Tailwind CSS, feature-flag store (e.g. Zustand)  
**Storage**: N/A (UI state only)  
**Testing**: Jest (UI), `make caipe-ui-tests`  
**Target Platform**: Web (browser)  
**Project Type**: Web application (Next.js frontend in `ui/`)  
**Performance Goals**: No regression; initial state is a single branch on mount  
**Constraints**: Single-file change in `ui/src/components/chat/ChatPanel.tsx`; no new dependencies  
**Scale/Scope**: One component (ChatMessage), one state initializer

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|--------|
| I. Specifications as source of truth | Pass | Spec defines FR-001–FR-004 and acceptance scenarios |
| II. Agent-first | Pass | No workflow change |
| III. MCP | N/A | UI-only change |
| IV. LangGraph | N/A | UI-only change |
| V. A2A | N/A | UI-only change |
| VI. Skills | N/A | No new skills |
| VII. Test-first | Pass | Existing ChatPanel tests; add/update test for final-message collapsed default |
| VIII. Documentation | Pass | Spec + plan in `docs/docs/specs/095-fix-thinking-panel-expand/` |
| IX. Security | Pass | No auth/sensitive data; no new inputs |
| X. Simplicity | Pass | Minimal change: initial state derived from `message.isFinal` + user default |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/095-fix-thinking-panel-expand/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (minimal UI contract)
└── tasks.md             # Created by /speckit.tasks
```

### Source Code (repository root)

```text
ui/
├── src/
│   └── components/
│       └── chat/
│           ├── ChatPanel.tsx       # ChatMessage: showRawStream initializer
│           └── __tests__/
│               └── ChatPanel.test.tsx
```

**Structure Decision**: Single-app layout; the change is confined to `ChatPanel.tsx` (ChatMessage) and its tests. No new modules or backend changes.

## Complexity Tracking

No constitution violations; this section is empty.
