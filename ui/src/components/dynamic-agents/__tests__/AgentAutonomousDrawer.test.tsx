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
  // Wait for the async fetch to populate the filtered task list.
  await waitFor(() => expect(taskListProps?.tasks.length).toBe(1));
  expect(taskListProps!.tasks.map((t) => t.id)).toEqual(["t1"]);
});

it("opens the add form pre-seeded with this agent", async () => {
  const user = userEvent.setup();
  render(<AgentAutonomousDrawer agent={agent} open onOpenChange={() => {}} />);
  await waitFor(() => expect(taskListProps?.tasks.length).toBe(1));
  await user.click(screen.getByRole("button", { name: /add autonomous task/i }));
  expect(screen.getByTestId("task-form")).toHaveTextContent("agent-hello");
});
