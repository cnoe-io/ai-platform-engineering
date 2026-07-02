# Per-Agent Autonomous Task Drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agent-scoped, in-place drawer on `/dynamic-agents` for managing an agent's autonomous tasks (list → next run + run history → add/edit/delete/trigger), opened from a new `SquarePen` icon on the agent row.

**Architecture:** One new container component (`AgentAutonomousDrawer`) that reuses the existing `TaskList`, `RunHistory`, `TaskFormDialog`, `autonomousApi`, and `isTaskOwnedByAgent` — mirroring the `/autonomous` page's task-management wiring but filtered to a single agent. `DynamicAgentsTab` swaps its `+` row button for a `SquarePen` button that opens the drawer. No authz/API changes.

**Tech Stack:** Next.js/React client components, Radix `Dialog`, Jest + React Testing Library (jsdom).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-per-agent-autonomous-drawer-design.md`.
- Pure UI over existing `autonomousApi`; **no** authz, grant, or backend changes.
- Reuse (do not rebuild): `TaskList`, `RunHistory`, `TaskFormDialog`, `isTaskOwnedByAgent`, `autonomousApi`.
- Row trigger visibility unchanged: shown only when `agent.permissions.can_schedule === true`. The 🤖 Enable-autonomous toggle stays as-is.
- No `Sheet` primitive exists — use `Dialog` (`@/components/ui/dialog`) as the drawer shell.
- Toast hook: `useToast` from `@/components/ui/toast`.
- TS: `cd ui && npm run lint && npx tsc --noEmit`; tests `npm test -- <path>`.
- Conventional Commits + DCO. Do **not** add `Signed-off-by` unless the human provides it.

---

### Task 1: `AgentAutonomousDrawer` container

**Files:**
- Create: `ui/src/components/dynamic-agents/AgentAutonomousDrawer.tsx`
- Test: `ui/src/components/dynamic-agents/__tests__/AgentAutonomousDrawer.test.tsx`

**Interfaces:**
- Consumes: `autonomousApi` (`listTasks`, `createTask`, `updateTask`, `deleteTask`, `triggerTask`, `getTask`), `isTaskOwnedByAgent(task, agentId)`, `TaskList`, `RunHistory`, `TaskFormDialog`.
- Produces: `AgentAutonomousDrawer({ agent, open, onOpenChange })` where `agent: DynamicAgentConfigWithPermissions`, `open: boolean`, `onOpenChange: (open: boolean) => void`.

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/dynamic-agents/__tests__/AgentAutonomousDrawer.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockListTasks = jest.fn();
const mockCreateTask = jest.fn();

// Capture the props TaskList receives so we can assert the agent filter.
let taskListProps: { tasks: Array<{ id: string }> } | null = null;

jest.mock("@/components/autonomous/api", () => ({
  autonomousApi: {
    listTasks: (...a: unknown[]) => mockListTasks(...a),
    createTask: (...a: unknown[]) => mockCreateTask(...a),
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
    triggerTask: jest.fn(),
    getTask: jest.fn(),
  },
  AutonomousApiError: class extends Error {},
}));
jest.mock("@/components/autonomous/TaskList", () => ({
  TaskList: (props: { tasks: Array<{ id: string }> }) => {
    taskListProps = props;
    return <div data-testid="task-list">{props.tasks.length} tasks</div>;
  },
}));
jest.mock("@/components/autonomous/RunHistory", () => ({
  RunHistory: ({ taskId }: { taskId: string }) => <div data-testid="run-history">{taskId}</div>,
}));
jest.mock("@/components/autonomous/TaskFormDialog", () => ({
  TaskFormDialog: ({ open, initialAgentId }: { open: boolean; initialAgentId?: string }) =>
    open ? <div data-testid="task-form">{initialAgentId}</div> : null,
}));
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

import { AgentAutonomousDrawer } from "@/components/dynamic-agents/AgentAutonomousDrawer";

const agent = { _id: "agent-hello", name: "Hello Agent", permissions: { can_schedule: true } } as never;

beforeEach(() => {
  jest.clearAllMocks();
  taskListProps = null;
  mockListTasks.mockResolvedValue([
    { id: "t1", name: "mine", dynamic_agent_id: "agent-hello", trigger: { type: "cron" } },
    { id: "t2", name: "other", dynamic_agent_id: "agent-other", trigger: { type: "cron" } },
  ]);
});

it("lists only this agent's tasks", async () => {
  render(<AgentAutonomousDrawer agent={agent} open onOpenChange={() => {}} />);
  await waitFor(() => expect(taskListProps).not.toBeNull());
  expect(taskListProps!.tasks.map((t) => t.id)).toEqual(["t1"]);
});

it("opens the add form pre-seeded with this agent", async () => {
  const user = userEvent.setup();
  render(<AgentAutonomousDrawer agent={agent} open onOpenChange={() => {}} />);
  await waitFor(() => expect(taskListProps).not.toBeNull());
  await user.click(screen.getByRole("button", { name: /add autonomous task/i }));
  expect(screen.getByTestId("task-form")).toHaveTextContent("agent-hello");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npm test -- src/components/dynamic-agents/__tests__/AgentAutonomousDrawer.test.tsx`
Expected: FAIL — module `AgentAutonomousDrawer` does not exist.

- [ ] **Step 3: Write the component**

Create `ui/src/components/dynamic-agents/AgentAutonomousDrawer.tsx`:

```tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { TaskList } from "@/components/autonomous/TaskList";
import { RunHistory } from "@/components/autonomous/RunHistory";
import { TaskFormDialog } from "@/components/autonomous/TaskFormDialog";
import { autonomousApi, AutonomousApiError } from "@/components/autonomous/api";
import type { AutonomousTask } from "@/components/autonomous/types";
import type { DynamicAgentConfigWithPermissions } from "@/types/dynamic-agent";

import { isTaskOwnedByAgent } from "./taskOwnership";

interface AgentAutonomousDrawerProps {
  agent: DynamicAgentConfigWithPermissions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Agent-scoped autonomous-task manager (spec 2026-07-02). Mirrors the
 * /autonomous page's task wiring but filtered to a single agent's tasks.
 * Reuses TaskList / RunHistory / TaskFormDialog; no authz or API changes.
 */
export function AgentAutonomousDrawer({ agent, open, onOpenChange }: AgentAutonomousDrawerProps) {
  const { toast } = useToast();
  const agentId = agent._id;

  const [tasks, setTasks] = useState<AutonomousTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AutonomousTask | null>(null);
  const [runHistoryRefreshKey, setRunHistoryRefreshKey] = useState(0);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const all = await autonomousApi.listTasks();
      const mine = all.filter((t) => isTaskOwnedByAgent(t, agentId));
      setTasks(mine);
      setLoadError(null);
      setSelectedId((current) => {
        if (current && mine.some((t) => t.id === current)) return current;
        return mine[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError(
        err instanceof AutonomousApiError ? err.message : "Failed to load autonomous tasks.",
      );
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (open) fetchTasks();
  }, [open, fetchTasks]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  const markBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCreate = () => {
    setEditingTask(null);
    setDialogOpen(true);
  };
  const handleEdit = (task: AutonomousTask) => {
    setEditingTask(task);
    setDialogOpen(true);
  };

  const handleSubmitTask = async (task: AutonomousTask) => {
    if (editingTask) {
      const updated = await autonomousApi.updateTask(editingTask.id, task);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSelectedId(updated.id);
      toast(`Task "${updated.name}" updated.`, "success");
    } else {
      const created = await autonomousApi.createTask(task);
      setTasks((prev) => [...prev, created]);
      setSelectedId(created.id);
      toast(`Task "${created.name}" created.`, "success");
    }
  };

  const handleDelete = async (task: AutonomousTask) => {
    if (!window.confirm(`Delete task "${task.name}"? This cannot be undone.`)) return;
    markBusy(task.id, true);
    try {
      await autonomousApi.deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (selectedId === task.id) setSelectedId(null);
      toast(`Task "${task.name}" deleted.`, "success");
    } catch (err) {
      toast(err instanceof AutonomousApiError ? err.message : "Failed to delete task", "error");
    } finally {
      markBusy(task.id, false);
    }
  };

  const handleTrigger = async (task: AutonomousTask) => {
    markBusy(task.id, true);
    try {
      await autonomousApi.triggerTask(task.id);
      toast(`Triggered "${task.name}". Run history will update shortly.`, "success");
      setRunHistoryRefreshKey((n) => n + 1);
      try {
        const refreshed = await autonomousApi.getTask(task.id);
        setTasks((prev) => prev.map((t) => (t.id === refreshed.id ? refreshed : t)));
      } catch {
        // Non-fatal; the next reload will catch the updated next_run.
      }
    } catch (err) {
      toast(err instanceof AutonomousApiError ? err.message : "Failed to trigger task", "error");
    } finally {
      markBusy(task.id, false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Autonomous · {agent.name}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            className="text-xs px-2 py-1 rounded border hover:bg-muted"
          >
            + Add autonomous task
          </button>
        </div>

        {loadError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>{loadError}</span>
            <button type="button" onClick={fetchTasks} className="underline">
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <TaskList
              tasks={tasks}
              selectedTaskId={selectedId}
              onSelect={(t) => setSelectedId(t.id)}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onTrigger={handleTrigger}
              busyIds={busyIds}
            />
            <div>
              {selectedTask ? (
                <>
                  <div className="mb-2 text-xs text-muted-foreground">
                    Next run: {selectedTask.next_run ?? "—"}
                  </div>
                  <RunHistory taskId={selectedTask.id} refreshKey={runHistoryRefreshKey} />
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No autonomous tasks for this agent yet."}
                </div>
              )}
            </div>
          </div>
        )}

        <TaskFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          task={editingTask}
          initialAgentId={agentId}
          onSubmit={handleSubmitTask}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npm test -- src/components/dynamic-agents/__tests__/AgentAutonomousDrawer.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Lint + typecheck**

Run: `cd ui && npx eslint src/components/dynamic-agents/AgentAutonomousDrawer.tsx && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/dynamic-agents/AgentAutonomousDrawer.tsx ui/src/components/dynamic-agents/__tests__/AgentAutonomousDrawer.test.tsx
git commit -m "feat(ui): agent-scoped autonomous task drawer"
```

---

### Task 2: Wire the `SquarePen` trigger + drawer into `DynamicAgentsTab`

**Files:**
- Modify: `ui/src/components/dynamic-agents/DynamicAgentsTab.tsx`

**Interfaces:**
- Consumes: `AgentAutonomousDrawer` (Task 1).
- Produces: the agent row's `+` action is replaced by a `SquarePen` button that opens the drawer for that agent.

- [ ] **Step 1: Replace the `+` action with a `SquarePen` button**

In `DynamicAgentsTab.tsx`, add `SquarePen` to the existing `lucide-react` import (which already imports `Bot`, `Plus`, etc.), and add drawer state next to the other `useState` hooks:

```tsx
const [drawerAgent, setDrawerAgent] = React.useState<DynamicAgentConfigWithPermissions | null>(null);
```

Add the import near the other component imports:

```tsx
import { AgentAutonomousDrawer } from "./AgentAutonomousDrawer";
```

Replace the current "Add autonomous task" `Plus` button block (the `{agent.permissions.can_schedule && ( ... <Plus ... /> ... )}` block added in the prior UI work) with:

```tsx
{agent.permissions.can_schedule && (
  <Button
    variant="ghost"
    size="icon"
    className="h-8 w-8"
    onClick={() => setDrawerAgent(agent)}
    title="Manage autonomous tasks"
    aria-label="Manage autonomous tasks"
  >
    <SquarePen className="h-4 w-4" />
  </Button>
)}
```

- [ ] **Step 2: Mount the drawer once, below the rows**

Immediately before the closing `</CardContent>` (the same place the reused task dialog would mount), add:

```tsx
{drawerAgent && (
  <AgentAutonomousDrawer
    agent={drawerAgent}
    open={!!drawerAgent}
    onOpenChange={(open) => {
      if (!open) setDrawerAgent(null);
    }}
  />
)}
```

Remove any now-unused `Plus` import if it is no longer referenced elsewhere in the file (check with the lint step below; keep it if other buttons still use it).

- [ ] **Step 3: Lint + typecheck**

Run: `cd ui && npx eslint src/components/dynamic-agents/DynamicAgentsTab.tsx && npx tsc --noEmit`
Expected: no errors (fix an unused `Plus` import if flagged).

- [ ] **Step 4: Verify (build + manual matrix)**

Run: `cd ui && npm run build`
Manual:
- Agent with `can_schedule === false` → no `SquarePen` button (unchanged gating).
- Agent with `can_schedule === true` → `SquarePen` button appears; click opens the drawer titled `Autonomous · <name>`.
- Drawer lists only that agent's tasks; selecting one shows its **Next run** + run history; **+ Add autonomous task** opens the form pre-seeded with the agent; create/edit/delete/trigger work; closing the drawer returns to the agents list.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/dynamic-agents/DynamicAgentsTab.tsx
git commit -m "feat(ui): open per-agent autonomous drawer from a SquarePen row action"
```

---

## Self-Review

**Spec coverage:** §3 entry point (`SquarePen` replaces `+`, `can_schedule`-gated) → Task 2. §4 master–detail layout (`TaskList` + next-run + `RunHistory`) → Task 1 Step 3. §4 "Add autonomous task" → `TaskFormDialog` with `initialAgentId` → Task 1. §5 components (only `AgentAutonomousDrawer` new; `DynamicAgentsTab` modified) → Tasks 1–2. §6 data flow (filter via `isTaskOwnedByAgent`, select→RunHistory, add→createTask+refresh) → Task 1. §7 error handling (list error + Retry) → Task 1 Step 3. §8 testing → Task 1 tests + Task 2 manual matrix. §2 non-goals (no authz/API changes) → honored; drawer is pure UI over `autonomousApi`.

**Placeholder scan:** No TBD/TODO. All code shown in full. The only judgment call ("remove `Plus` if now unused") is gated behind a concrete lint step, not a vague instruction.

**Type consistency:** `AgentAutonomousDrawer({ agent, open, onOpenChange })` signature matches its Task 2 call site; `agent: DynamicAgentConfigWithPermissions` matches the row type used in `DynamicAgentsTab`; `TaskList` props (`selectedTaskId`, `onSelect`, `onEdit`, `onDelete`, `onTrigger`, `busyIds`) match the reused component; `RunHistory` (`taskId`, `refreshKey`) and `TaskFormDialog` (`open`, `onOpenChange`, `task`, `initialAgentId`, `onSubmit`) match their real signatures.

**Nested-dialog note:** `TaskFormDialog` (Radix `Dialog`) opens on top of the drawer's `Dialog`. Radix supports stacked/portaled dialogs; both portal to `body`, so the form isn't DOM-nested under the drawer content. If focus-return misbehaves in manual testing, mount `TaskFormDialog` as a sibling of the drawer in `DynamicAgentsTab` instead and lift the "add/edit" intent up — behavior identical, only the mount point moves.
