# Plan: Merge Main into release/0.4.0 + Restore Supervisor A2A Streaming

**Date:** 2026-04-13
**Branch:** `prebuild/refactor/stream-encoder-abstraction-v2` (based on `release/0.4.0`)
**Goal:** Pull 60 new commits from `origin/main` into the release branch, and revert supervisor streaming from AG-UI back to A2A.

## Context

### Branch Topology

```
origin/main (1a1ec20a) ──── 60 commits ahead of merge base
     │
     ├── cf4c52b3 (merge base)
     │
release/0.4.0 (00338532) ──── 14 commits ahead of merge base
     │
our branch (39b131de + uncommitted Phase 4) ──── 9 commits on top of release/0.4.0
```

### Release Workflow

```
our branch → merges into → release/0.4.0 → PR to → main
```

### Protocol Decision

| Component | Protocol | Rationale |
|-----------|----------|-----------|
| **Dynamic agents** | AG-UI | New canonical protocol for 0.4.0 |
| **Supervisor** | A2A (unchanged from main) | Supervisor is deprecated in 0.5.0; not worth migrating to AG-UI |
| **Slack bot** | AG-UI (future work) | Will migrate from A2A to AG-UI in a separate effort |

### The Problem

`release/0.4.0` commit `93464540` ("unify streaming on AG-UI protocol") deleted all A2A client code from the UI and switched supervisor streaming to AG-UI via `@ag-ui/client` HttpAgent. However, the supervisor backend (single-node mode via `main_single.py`) only speaks A2A JSON-RPC and does not have a `/chat/stream` AG-UI endpoint. This means supervisor streaming has been broken since the 0.4.0 branch was created.

Main still has the working A2A client code. We need to merge main in and restore supervisor's A2A streaming path.

---

## Execution Plan

### Step 1: Commit Phase 4 on our branch

Commit the rename/reorganize changes that are currently uncommitted on `prebuild/refactor/stream-encoder-abstraction-v2`. This makes our branch clean before any merge operations.

**Commit message:** `refactor(ui): rename Dynamic* to canonical names, prefix Supervisor*, move lib/agui to lib/supervisor`

**Renames included:**
- `DynamicAgentChatPanel.tsx` → `ChatPanel.tsx` (canonical)
- `ChatPanel.tsx` → `SupervisorChatPanel.tsx` (deprecated)
- `DynamicAgentChatView.tsx` → `ChatView.tsx` (canonical)
- `PlatformEngineerChatView.tsx` → `SupervisorChatView.tsx` (deprecated)
- `DynamicAgentTimeline.tsx` → `AgentTimeline.tsx` (canonical)
- `AgentTimeline.tsx` → `SupervisorTimeline.tsx` (deprecated)
- `da-timeline-manager.ts` → `timeline-manager.ts` (canonical)
- `timeline-manager.ts` → `supervisor-timeline-manager.ts` (deprecated)
- `timeline-parsers.ts` → `supervisor-timeline-parsers.ts`
- `types/dynamic-agent-timeline.ts` → `types/timeline.ts` (canonical)
- `lib/agui/` → `lib/supervisor/`
- All `DA*` type prefixes stripped; old supervisor types prefixed with `Supervisor*`

---

### Step 2: Merge `origin/main` into `release/0.4.0`

Switch to `release/0.4.0`, run `git merge origin/main`. Expected: ~425 conflict markers.

#### Conflict Resolution Cheat Sheet

##### Backend — `ai_platform_engineering/multi_agents/`

**Strategy: Take main's version entirely.**

```bash
git checkout origin/main -- ai_platform_engineering/multi_agents/
```

5 conflicting files:
- `prompts.py` — take main
- `agent_executor.py` — take main
- `main.py` — take main
- `pyproject.toml` — take main
- `uv.lock` — take main

6 files added by release/0.4.0 that get **dropped**:
- `agui_persistence.py` — AG-UI event persistence (supervisor doesn't need it)
- `persisted_stream.py` — streaming persistence helper
- `turns_routes.py` — REST API for persisted turns
- `protocol_bindings/sse/__init__.py` — legacy SSE binding
- `protocol_bindings/sse/main.py` — legacy SSE binding
- `protocol_bindings/sse/stream_handler.py` — legacy SSE binding

Main's important supervisor fixes that come in:
- `085218af` — fix: replace RemoveMessage with synthetic ToolMessage for orphaned tool calls
- `cc3acf32` — fix: exclude format_markdown tool in structured response mode
- `9d2cdcd6` — fix: unify single/distributed binding, streaming conformance, RAG caps
- `bfcf105b` — fix: OIDC group display, task builder tools, supervisor response format

##### Backend — `ai_platform_engineering/utils/agui/` (4 files)

**Strategy: Drop.** Only consumer (`sse/stream_handler.py`) is being dropped.

```bash
git rm -r ai_platform_engineering/utils/agui/
```

##### Backend — `ai_platform_engineering/utils/persistence/` (2 files)

**Strategy: Drop.** All consumers are being dropped (`agui_persistence.py`, `persisted_stream.py`, `turns_routes.py`, `sse/stream_handler.py`).

```bash
git rm -r ai_platform_engineering/utils/persistence/
```

##### Backend — `ai_platform_engineering/integrations/slack_bot/`

**Strategy: Take main's version.** Restores `a2a_client.py` that release/0.4.0 deleted. Slack bot stays on A2A for now (AG-UI migration is future work).

##### Backend — `ai_platform_engineering/dynamic_agents/`

**No conflicts expected.** Main doesn't touch this directory. Our encoder abstraction, stream helpers, and routes stay intact.

##### UI — `ChatPanel.tsx`

**Strategy: Take main's version.**

Main's `ChatPanel.tsx` (2659 lines) has:
- A2A streaming via `A2ASDKClient` for supervisor
- `DynamicAgentClient` for dynamic agents
- Full timeline, HITL forms, recovery logic

Release/0.4.0's `ChatPanel.tsx` (1589 lines) was rewritten for AG-UI only. Take main's working version.

```bash
git checkout origin/main -- ui/src/components/chat/ChatPanel.tsx
```

##### UI — `chat-store.ts`

**Strategy: Take main's version.**

Main's version uses `A2AClient` for `sendMessage` (supervisor path). Release/0.4.0's version uses `streamAGUIEvents` from `lib/agui/hooks.ts` which doesn't work.

```bash
git checkout origin/main -- ui/src/store/chat-store.ts
```

##### UI — `types/a2a.ts`

**Strategy: Take main's version.** Full A2A types needed for supervisor.

```bash
git checkout origin/main -- ui/src/types/a2a.ts
```

##### UI — `lib/agui/` (4 files)

**Strategy: Drop.** With `chat-store.ts` reverted to main's A2A version, these files are unused.

```bash
git rm -r ui/src/lib/agui/
```

##### UI — A2A Files (16 files restored automatically by merge)

These were deleted by release/0.4.0 but exist on main. The merge will add them back:
- `components/a2a/A2AStreamPanel.tsx`
- `components/a2a/A2ATimelineModal.tsx`
- `components/a2a/A2UIRenderer.tsx`
- `components/a2a/ContextPanel.tsx`
- `components/a2a/__tests__/*` (2 files)
- `components/a2a/widgets/index.tsx`
- `components/chat/SubAgentCard.tsx` + test
- `hooks/use-a2a-streaming.ts` + test
- `lib/a2a-client.ts` + test
- `lib/a2a-sdk-client.ts` + tests (2 files)

##### UI — `app/api/chat/stream/route.ts`

**Strategy: Keep.** Added by release/0.4.0 as the AG-UI proxy route. May be useful for distributed-mode supervisor or future use. No conflict (main doesn't have it).

##### UI — `package.json` / `package-lock.json`

**Strategy: Merge both sides.** Main has dep upgrades + security fixes. Release/0.4.0 has `@ag-ui/client`. Regenerate lock file after merge.

```bash
# After resolving package.json conflicts:
npm install
```

##### UI — Other Conflicting Files

| File | Strategy |
|------|----------|
| `next.config.ts` | Take main + re-apply any 0.4.0-specific additions |
| `postcss.config.mjs` | Take main |
| `globals.css` | Take main (Tailwind v4 changes) |
| `tailwind.config.ts` | Take main |
| `PrometheusCharts.tsx` | Take main |
| `AppHeader.tsx` | Take main + re-apply 0.4.0 additions if any |
| `SkillsBuilderEditor.tsx` | Take main |
| `icons.tsx` | Merge (both sides added content) |
| `types/mongodb.ts` | Merge (0.4.0 added `Participant`, `client_type`, `ui_version`) |
| `nps-campaigns.test.ts` | Take main |

##### Lock Files

Regenerate after merge:
```bash
# Python
cd ai_platform_engineering/multi_agents && uv lock
# UI
cd ui && npm install
```

#### Post-merge Verification (release/0.4.0)

```bash
# UI build
cd ui && npx tsc --noEmit && npx next build

# Rebuild supervisor container
docker compose -f docker-compose.dev.yaml --profile caipe-supervisor-all-in-one up --build

# Test supervisor A2A streaming
curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","params":{"message":{"role":"user","parts":[{"type":"text","text":"hello"}]},"configuration":{"threadId":"test"}},"id":1}'
```

---

### Step 3: Merge updated `release/0.4.0` into our branch

After `release/0.4.0` has main merged in, merge it into our branch (`prebuild/refactor/stream-encoder-abstraction-v2`).

#### Revised Strategy: Revert-Merge-Rename

To avoid complex rename-vs-modify conflicts, we **revert Phase 4 renames first** so file names match between both branches, making the merge purely about content. Then re-apply renames afterward.

```
Step 3a: git revert 89489bae   (undo Phase 4 renames — file names match release/0.4.0)
Step 3b: git merge release/0.4.0  (content-only conflicts, same file names both sides)
Step 3c: Resolve content conflicts
Step 3d: Re-apply Phase 4 renames as a new commit
```

#### Step 3b Conflict Resolution

With file names aligned, conflicts are purely content-based:

| File | Conflict | Resolution |
|------|----------|-----------|
| `ChatPanel.tsx` | release/0.4.0 has main's A2A+DynAgent version; our branch has AG-UI-only version | Take release/0.4.0 (main's version) — this becomes `SupervisorChatPanel` in Step 3d |
| `DynamicAgentChatPanel.tsx` | Our dynamic agents panel with streaming adapters | Keep ours — this becomes canonical `ChatPanel` in Step 3d |
| `chat-store.ts` | release/0.4.0 has main's A2A imports; ours has `lib/agui/` imports | Take release/0.4.0 (main's version with A2A) |
| `types/a2a.ts` | release/0.4.0 has main's full A2A types; ours has stripped types | Take release/0.4.0 |
| `lib/agui/` | release/0.4.0 deleted it (Step 2); our branch has it | Accept deletion — dead code |
| A2A files (16 files) | release/0.4.0 has them (restored in Step 2); our branch deleted them | Accept addition — needed for supervisor |
| `DynamicAgentClient` | release/0.4.0 has it (from main); our branch deleted it | Accept addition for now, delete in Step 4 (replaced by streaming adapters) |
| `lib/streaming/` | Only on our branch | Keep — no conflict |
| `app/api/chat/conversations/[id]/stream/` | Only on our branch | Keep — no conflict |
| `app/api/chat/conversations/[id]/turns/` | Only on our branch | Keep — no conflict |

#### Step 3d: Re-apply Phase 4 Renames

See **Phase 4 Rename Reference** section below for the complete rename map.

#### Post-merge Verification (our branch)

```bash
cd ui && npx tsc --noEmit && npx next build

# Verify dynamic agent streaming
# Verify supervisor A2A streaming
```

---

### Step 4: Post-merge Cleanup on Our Branch

- [ ] Remove `lib/supervisor/` if still present (dead code — supervisor uses A2A, not AG-UI hooks)
- [ ] Remove `DynamicAgentClient` if restored by merge (replaced by `lib/streaming/` adapters)
- [ ] Verify all imports compile: `npx tsc --noEmit`
- [ ] Verify build: `npx next build`
- [ ] Rebuild supervisor container, verify A2A streaming works
- [ ] Verify dynamic agent streaming still works with adapters
- [ ] Commit cleanup as a separate commit

---

## Work Preservation Confirmation

All dynamic agents + AG-UI + streaming adapter work is preserved through this process.
The revert + re-apply is purely cosmetic (file/type names). Actual code logic lives in
commits that are NOT being reverted:

| Work | Commits | Location | Survives? |
|------|---------|----------|-----------|
| Backend encoder abstraction (`StreamEncoder` ABC, Custom/AGUI encoders, `LangGraphStreamHelper`) | `da72dea4`, `530498b0`, `f4306855`, `60de03ef` | `dynamic_agents/services/encoders/` | Yes |
| UI streaming adapter layer (`StreamAdapter`, `StreamCallbacks`, `CustomAdapter`, `AGUIAdapter`, `parse-sse.ts`) | `042e2449` | `lib/streaming/` | Yes |
| Turns collection (API route, decoupled from messages) | `e5b27e7e` | `app/api/chat/conversations/[id]/turns/` | Yes |
| Unified gateway routes (`start`, `resume`, `cancel`, `_helpers.ts`) | `da6cb164` | `app/api/chat/conversations/[id]/stream/` | Yes |
| Participants migration + API consistency | `da6cb164` | `types/mongodb.ts`, dynamic agents routes | Yes |
| Metadata cleanup (`client_type`, `ui_version`) | `39b131de` | `dynamic_agents/routes/conversations.py` | Yes |
| MarkdownRenderer component | `b6724dfb` | `components/shared/timeline/` | Yes |
| DynamicAgentChatPanel (streaming logic, timeline rendering) | `b6724dfb`, `042e2449` | `components/chat/` | Yes (renamed in Step 3d) |
| AgentTimeline / useAgentTimeline (dynamic agents timeline) | `b6724dfb` | `components/chat/`, `hooks/` | Yes (renamed in Step 3d) |
| DATimelineManager (dynamic agents timeline manager) | `b6724dfb` | `lib/` | Yes (renamed in Step 3d) |

**What intentionally goes away:**
- `lib/agui/` (and its Phase 4 rename `lib/supervisor/`) — dead code since supervisor uses A2A

---

## Phase 4 Rename Reference

Complete rename map from commit `89489bae`. Use this to recover/re-apply renames in Step 3d.

### File Renames

| Original (release/0.4.0 / main name) | Phase 4 Name (canonical) | Direction |
|---|---|---|
| `ui/src/components/chat/ChatPanel.tsx` | `ui/src/components/chat/SupervisorChatPanel.tsx` | old canonical → deprecated |
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | `ui/src/components/chat/ChatPanel.tsx` | dynamic → new canonical |
| `ui/src/components/dynamic-agents/DynamicAgentChatView.tsx` | `ui/src/components/chat/ChatView.tsx` | moved + renamed |
| `ui/src/components/chat/PlatformEngineerChatView.tsx` | `ui/src/components/chat/SupervisorChatView.tsx` | renamed |
| `ui/src/components/chat/DynamicAgentTimeline.tsx` | `ui/src/components/chat/AgentTimeline.tsx` | dynamic → new canonical |
| `ui/src/components/chat/AgentTimeline.tsx` | `ui/src/components/chat/SupervisorTimeline.tsx` | old canonical → deprecated |
| `ui/src/hooks/useDynamicAgentTimeline.ts` | `ui/src/hooks/useAgentTimeline.ts` | renamed |
| `ui/src/lib/da-timeline-manager.ts` | `ui/src/lib/timeline-manager.ts` | dynamic → new canonical |
| `ui/src/lib/timeline-manager.ts` | `ui/src/lib/supervisor-timeline-manager.ts` | old canonical → deprecated |
| `ui/src/lib/timeline-parsers.ts` | `ui/src/lib/supervisor-timeline-parsers.ts` | renamed |
| `ui/src/lib/agui/client.ts` | `ui/src/lib/supervisor/client.ts` | directory move |
| `ui/src/lib/agui/hooks.ts` | `ui/src/lib/supervisor/hooks.ts` | directory move |
| `ui/src/lib/agui/types.ts` | `ui/src/lib/supervisor/types.ts` | directory move |
| `ui/src/lib/agui/index.ts` | `ui/src/lib/supervisor/index.ts` | deleted + recreated |
| `ui/src/types/dynamic-agent-timeline.ts` | `ui/src/types/timeline.ts` | renamed |

### Type Renames

| Original | Phase 4 Name | File |
|---|---|---|
| `DATimelineSegment` | `TimelineSegment` | `types/timeline.ts` |
| `DATimelineSegmentType` | `TimelineSegmentType` | `types/timeline.ts` |
| `DAToolInfo` | `ToolInfo` | `types/timeline.ts` |
| `DASubagentInfo` | `SubagentInfo` | `types/timeline.ts` |
| `DAPlanStep` | `PlanStep` | `types/timeline.ts` |
| `DATimelineManager` | `TimelineManager` | `lib/timeline-manager.ts` |
| `TimelineSegment` (old supervisor) | `SupervisorTimelineSegment` | `types/a2a.ts` |
| `TimelineSegmentType` (old supervisor) | `SupervisorTimelineSegmentType` | `types/a2a.ts` |
| `TimelineManager` (old supervisor) | `SupervisorTimelineManager` | `lib/supervisor-timeline-manager.ts` |
| `DynamicAgentChatPanel` (export) | `ChatPanel` | component export |
| `ChatPanel` (old export) | `SupervisorChatPanel` | component export |
| `DynamicAgentTimeline` (export) | `AgentTimeline` | component export |
| `AgentTimeline` (old export) | `SupervisorTimeline` | component export |

### Import Path Changes

| Old Import | New Import |
|---|---|
| `@/lib/agui/hooks` | `@/lib/supervisor/hooks` |
| `@/lib/agui/types` | `@/lib/supervisor/types` |
| `@/lib/agui` | `@/lib/supervisor` |
| `@/lib/da-timeline-manager` | `@/lib/timeline-manager` |
| `@/lib/timeline-manager` | `@/lib/supervisor-timeline-manager` |
| `@/lib/timeline-parsers` | `@/lib/supervisor-timeline-parsers` |
| `@/types/dynamic-agent-timeline` | `@/types/timeline` |
| `@/hooks/useDynamicAgentTimeline` | `@/hooks/useAgentTimeline` |
| `@/components/dynamic-agents/DynamicAgentChatView` | `@/components/chat/ChatView` |

### Files That Also Need Import Updates (Step 3d)

These files import from renamed files and need their `import` statements updated:

- `ui/src/components/chat/ChatContainer.tsx` — imports ChatView + SupervisorChatView
- `ui/src/components/chat/SupervisorChatPanel.tsx` — imports SupervisorTimeline, SupervisorTimelineManager
- `ui/src/components/chat/ChatPanel.tsx` — imports AgentTimeline, useAgentTimeline, types/timeline
- `ui/src/hooks/useAgentTimeline.ts` — imports TimelineManager, types/timeline
- `ui/src/lib/timeline-manager.ts` — imports types/timeline
- `ui/src/lib/supervisor-timeline-manager.ts` — imports SupervisorTimelineSegment from a2a.ts
- `ui/src/lib/supervisor-timeline-parsers.ts` — imports from a2a.ts
- `ui/src/store/chat-store.ts` — imports SupervisorTimelineManager, supervisor-timeline-parsers
- `ui/src/components/dynamic-agents/index.ts` — remove DynamicAgentChatView re-export
- `ui/src/app/(app)/chat/[uuid]/__tests__/page.test.tsx` — mock paths
- `ui/src/components/chat/__tests__/ChatPanel.test.tsx` — import SupervisorChatPanel
- `ui/src/components/chat/__tests__/ChatPanel.messagewindow.test.tsx` — import SupervisorChatPanel
- `ui/src/components/chat/__tests__/AgentTimeline.test.tsx` — import SupervisorTimeline
- `ui/src/lib/__tests__/timeline-manager.test.ts` — import SupervisorTimelineManager
- `ui/src/store/__tests__/chat-store.test.ts` — mock paths
- `ui/src/app/api/chat/stream/route.ts` — deprecation comment

---

## Files Summary

### Files DROPPED from release/0.4.0 in Step 2

Backend:
- `ai_platform_engineering/multi_agents/platform_engineer/agui_persistence.py`
- `ai_platform_engineering/multi_agents/platform_engineer/persisted_stream.py`
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/turns_routes.py`
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/sse/` (3 files)
- `ai_platform_engineering/utils/persistence/` (2 files)
- `ai_platform_engineering/utils/tests/test_turn_persistence.py`

UI:
- `ui/src/lib/agui/` (4 files — dead code, supervisor uses A2A not AG-UI hooks)

**Note:** `ai_platform_engineering/utils/agui/` was initially dropped but then RESTORED because
`dynamic_agents/routes/chat.py` and `dynamic_agents/services/stream_events.py` import from it.
This is the dynamic agents service dependency, NOT the supervisor.

### Files RESTORED from main in Step 2 (needed for supervisor A2A)

UI (16+ files):
- `ui/src/components/a2a/` (7 files — A2AStreamPanel, A2ATimelineModal, A2UIRenderer, ContextPanel, widgets, tests)
- `ui/src/components/chat/SubAgentCard.tsx` + test
- `ui/src/hooks/use-a2a-streaming.ts` + test
- `ui/src/lib/a2a-client.ts` + test
- `ui/src/lib/a2a-sdk-client.ts` + 2 tests
- `ui/src/lib/dynamic-agent-client.ts`
- `ui/src/lib/streaming-polyfill.ts`

Backend:
- `ai_platform_engineering/integrations/slack_bot/a2a_client.py` + tests (2 files)

### Files KEPT from release/0.4.0

UI:
- `ui/src/app/api/chat/stream/route.ts` (AG-UI proxy, may be useful for distributed supervisor)
- `ui/src/lib/sse-streaming-client.ts`

Backend:
- `ai_platform_engineering/dynamic_agents/` (encoder abstraction — untouched by main)
- `ai_platform_engineering/utils/agui/` (used by dynamic_agents service)

### Files KEPT from our branch (9 commits)

UI:
- `ui/src/lib/streaming/` (protocol-agnostic adapter layer)
- `ui/src/app/api/chat/conversations/[id]/stream/` (unified gateway routes)
- `ui/src/app/api/chat/conversations/[id]/turns/` (turns collection)
- `ui/src/components/shared/timeline/MarkdownRenderer.tsx`
- `ui/src/components/chat/DynamicAgentChatPanel.tsx` (dynamic agents panel with streaming adapters)
- `ui/src/components/chat/DynamicAgentTimeline.tsx` + `useDynamicAgentTimeline.ts`
- `ui/src/lib/da-timeline-manager.ts` (dynamic agents timeline manager)
- `ui/src/types/dynamic-agent-timeline.ts` (dynamic agents timeline types)
- Phase 4 renames applied in Step 3d

---

## Execution Status

| Step | Description | Status |
|------|-------------|--------|
| Step 1 | Commit Phase 4 renames on our branch | DONE (`89489bae`) |
| Step 2 | Merge origin/main into release/0.4.0 | DONE (`70d8241f`) |
| Step 3a | Revert Phase 4 renames on our branch | Pending |
| Step 3b | Merge release/0.4.0 into our branch | Pending |
| Step 3c | Resolve content conflicts | Pending |
| Step 3d | Re-apply Phase 4 renames | Pending |
| Step 4 | Post-merge cleanup | Pending |

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| ~425 conflict markers in Step 2 merge | RESOLVED — systematic "take main" strategy worked |
| `package-lock.json` merge hell | RESOLVED — regenerated via `npm install` |
| Phase 4 renames interact badly with Step 3 merge | MITIGATED — revert renames first (Step 3a), merge with matching names, re-apply after |
| Supervisor streaming still broken after merge | Verify with docker rebuild + curl test after Step 3 |
| Dynamic agent streaming regressed | Verify adapter layer still compiles and streams correctly after Step 3 |
| Revert loses Phase 4 work | MITIGATED — full rename reference documented above for recovery |
