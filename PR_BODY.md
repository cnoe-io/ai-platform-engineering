# Description

Comprehensive UI and backend improvements for the 0.4.0 release, spanning client context support, streaming performance, auth centralization, and dead code cleanup.

**Related spec:** `docs/docs/specs/100-slack-agui-migration/plan.md` (Phase 8 + future work items)

## Changes

### Client Context & System Prompt Rendering
- Web chat sends `client_context` (`{ source: "webui", chat_sharing }`) with streaming requests
- `user_info` tool now exposes `client_context` to agents at runtime
- `_render_system_prompt()` accepts `user` context for Jinja2 templates (e.g. `{% if user.is_admin %}`)
- Jinja2 syntax highlighting in the system prompt editor (CodeMirror ViewPlugin)

### Streaming Markdown Performance & UX
- **Dual Marked instances**: fast synchronous parser (no shiki) during streaming (~2ms/token), full shiki highlighting on finalize (~80-400ms, runs once)
- **rAF throttle**: DOM patches coalesced to once per animation frame via `requestAnimationFrame`
- **Block fade-in animations**: `onNodeAdded` detects new block elements, `onBeforeElUpdated` preserves animation class across morphdom patches, `animationend` cleans up
- **Blinking cursor**: CSS `::after` pseudo-element visible during streaming
- **Smooth streaming→final transition**: skip `animate-reveal-ltr` when transitioning from streaming (only animate historical messages)
- **Fixed progressive text rendering**: `getGroupedData()` no longer overwrites `finalAnswerParts` with empty flushed segments in the no-tools path
- **Fixed missing `isStreaming` prop** on the has-tools timeline rendering path

### Centralized DA Proxy Auth & Dead Code Removal
- New `ui/src/lib/da-proxy.ts` — centralized auth, config, headers, and proxy helpers for all DA backend routes
- All conversation proxy routes (files, content, interrupt-state, clear) rewritten to use `da-proxy.ts` with proper `X-User-Context` header injection
- **Removed dead unified gateway routes**: `/api/chat/conversations/[id]/stream/` (start, resume, cancel + `_helpers.ts`) and `/api/chat/conversations/[id]/invoke/` — unused by the UI
- **Removed `/api/dynamic-agents/conversations/[id]/todos/` API** — todos now parsed directly from stream args
- Default agent protocol changed from `custom` to `agui`

### Todo Parsing from Stream
- Todos parsed from `write_todos` tool args in both custom (`onToolStart`) and AG-UI (`onToolEnd` with accumulated args) protocols
- Removed backend `/todos` endpoint and frontend API proxy route

### Spec Updates
- Phase 8 (ClientContext + Jinja2) marked complete
- Config Centralization deferred to future release
- Text rendering between tool calls marked as resolved

## Type of Change

- [x] Bugfix
- [x] New Feature
- [x] Refactor
- [x] Documentation

## Stats

- **29 files changed**, 658 insertions, 1,309 deletions (net -651 lines)

## Checklist

- [x] I have read the [contributing guidelines](CONTRIBUTING.md)
- [x] I have verified this change is not present in other open pull requests
- [x] Functionality is documented
- [x] All code style checks pass
- [x] New code contribution is covered by automated tests
- [x] All new and existing tests pass
