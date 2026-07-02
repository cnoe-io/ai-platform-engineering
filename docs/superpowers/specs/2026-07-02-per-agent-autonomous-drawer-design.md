# Per-Agent Autonomous Task Drawer — Design

**Status:** Draft for review
**Date:** 2026-07-02
**Scope:** A per-agent, in-place drawer on `/dynamic-agents` for managing an
agent's autonomous tasks (list → run history + next run → add), reachable from a
new **`SquarePen`** (writing/edit) icon on the agent row. Pure UI over existing
autonomous APIs — no authz/grant changes.

---

## 1. Problem

After an agent is autonomous-enabled (org admin Layer 1 + manager Layer 2), the
current affordance is a single **+** icon on the agent row that jumps straight
into the create-task form ([DynamicAgentsTab.tsx](../../../ui/src/components/dynamic-agents/DynamicAgentsTab.tsx)).
There is no place, from the agent, to **see that agent's existing autonomous
tasks**, their **past runs**, or their **next run** before adding another. The
only task-management surface is the standalone `/autonomous` page, which is not
agent-scoped.

## 2. Goals / Non-Goals

**Goals**
- From an agent row, open an **agent-scoped** view of *the caller's* autonomous
  tasks for that agent.
- Click a task → see its **next run** + **past runs**.
- **"Add autonomous task"** in the same view → the existing create form,
  pre-seeded with this agent.
- Replace the **+** icon with a **`SquarePen`** (writing/edit) icon — a
  trigger-agnostic "manage tasks" affordance (covers cron, interval, and
  webhook triggers).
- **Reuse** `TaskList`, `RunHistory`, `TaskFormDialog` — do not rebuild them.

**Non-Goals**
- No change to authz, grants, `can_schedule`, or any API.
- **Not** the `/autonomous` → admin-only refactor (that's a separate follow-up
  spec — "Piece 2").
- No new backend endpoints; the drawer uses existing `autonomousApi`.

## 3. Entry Point & Trigger

- On each agent row in `DynamicAgentsTab`, the current **+** button
  ([DynamicAgentsTab.tsx:448](../../../ui/src/components/dynamic-agents/DynamicAgentsTab.tsx#L448))
  is replaced by a **`SquarePen`** (writing/edit) icon button.
- Visibility unchanged: shown only when `agent.permissions.can_schedule === true`
  (Layer 1 + Layer 2 grants exist). The 🤖 **Enable autonomous** toggle
  (manager-only) stays exactly as-is.
- Click → opens the drawer for that agent.

## 4. Layout — master–detail drawer

A slide-over panel (Sheet if the UI kit has one, else the existing `Dialog`
primitive `TaskFormDialog` already uses), titled `Autonomous · <agent name>`:

```
┌─ Autonomous · agent-hello ───────────────────────────┐
│ [+ Add autonomous task]                              │
│ ┌───────────────┐  ┌──────────────────────────────┐ │
│ │ daily-report  │  │ pr-triage                     │ │
│ │ pr-triage  ◄──│  │ Next run: 2026-07-02 14:00    │ │
│ │ cleanup       │  │ Past runs:                    │ │
│ │               │  │   ✓ 13:00  (SUCCESS)          │ │
│ │               │  │   ✗ 12:00  (FAILED)           │ │
│ └───────────────┘  └──────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

- **Left — task list:** the existing `TaskList` (`showOwner={false}`, since it's
  the caller's own tasks), fed the agent-scoped task set.
- **Right — detail panel:** on `TaskList.onSelect(task)`, render the task's
  **next run** (`task.next_run`) + the existing `<RunHistory taskId={task.id} />`.
- **Top — "Add autonomous task"** button → opens `TaskFormDialog` with
  `initialAgentId={agent._id}`; on submit calls `autonomousApi.createTask`, then
  refreshes the list (bump a `refreshKey`).
- Empty state: "No autonomous tasks for this agent yet."

## 5. Components

| Unit | New/Reused | Responsibility |
|---|---|---|
| `AgentAutonomousDrawer` | **New** | Container: fetch + filter tasks for one agent, master–detail layout, own the selected-task + add-dialog + refresh state. |
| `TaskList` | Reused | Render the scoped task rows; `onSelect` drives the detail panel. |
| `RunHistory` | Reused | Past runs for the selected `taskId` (already self-fetches via `autonomousApi.listRuns`). |
| `TaskFormDialog` | Reused | Create form, `initialAgentId` pre-seeded (added in prior work). |
| `DynamicAgentsTab` | Modified | Swap **+** → **`SquarePen`**; hold `drawerAgent` state; render `<AgentAutonomousDrawer>`. |

`AgentAutonomousDrawer` is the only new file; everything else is composition.

## 6. Data Flow

1. Zap click → `DynamicAgentsTab` sets `drawerAgent = agent` → drawer opens.
2. Drawer fetches `autonomousApi.listTasks()` and filters with the existing
   `isTaskOwnedByAgent(task, agent._id)` helper
   ([taskOwnership.ts](../../../ui/src/components/dynamic-agents/taskOwnership.ts)).
   - Non-admin callers are already owner-scoped server-side, so the result is
     "my tasks for this agent." (Admins see all owners' tasks for the agent —
     acceptable; finer admin scoping is Piece 2.)
3. `TaskList` renders the filtered set; `onSelect` sets `selectedTask`.
4. Detail panel shows `selectedTask.next_run` + `<RunHistory taskId={selectedTask.id} refreshKey={runsRefresh} />`.
5. "Add autonomous task" → `TaskFormDialog` → `createTask` → on success, refetch
   the task list and clear the dialog.

## 7. Error Handling

- **Task list fetch fails** → inline error inside the drawer with a Retry
  action (mirror the `/autonomous` page's list error pattern). Drawer stays open.
- **Create fails** → surfaced by `TaskFormDialog` (unchanged).
- **Run history fails** → handled inside `RunHistory` (unchanged).
- Drawer never blocks the underlying agents list; closing it resets
  `selectedTask` and dialog state.

## 8. Testing

- **Filter logic:** `AgentAutonomousDrawer` shows only tasks where
  `isTaskOwnedByAgent(task, agentId)`; unrelated-agent tasks are excluded.
- **Selection:** selecting a task renders `RunHistory` with that `taskId` and the
  task's `next_run`.
- **Add flow:** the add button opens `TaskFormDialog` with `initialAgentId` set;
  a successful submit triggers a task-list refetch.
- **Row trigger:** the `SquarePen` button renders only when `can_schedule` is
  true and opens the drawer for the correct agent.
- Mirror the existing `autonomous/__tests__/page.test.tsx` pattern (mock
  `TaskList` / `RunHistory` / `TaskFormDialog`, assert wiring) so we test the
  container's composition, not the reused children's internals.

## 9. Open Items / Follow-ups

- **Piece 2 (separate spec):** refactor `/autonomous` into an admin-only
  all-tasks oversight view once this drawer is the primary user surface.
- Confirm whether the UI kit has a `Sheet`/drawer primitive; if not, use the
  existing `Dialog` (wider variant) — decided at plan time.
- Optional later: an agent-scoped list endpoint (`?agent=<id>`) if client-side
  filtering of `listTasks()` becomes heavy at scale. Not needed now.
