/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

let taskListProps: { tasks: Array<{ id: string }>; onTrigger: (t: { id: string }) => void } | null = null;
const mockTrigger = jest.fn();

jest.mock("@/components/autonomous/TaskList", () => ({
  TaskList: (p: { tasks: Array<{ id: string }>; onTrigger: (t: { id: string }) => void }) => {
    taskListProps = p;
    return <div data-testid="task-list">{p.tasks.length}</div>;
  },
}));
jest.mock("@/components/autonomous/RunHistory", () => ({ RunHistory: ({ taskId }: { taskId: string }) => <div>{taskId}</div> }));
jest.mock("@/components/autonomous/api", () => ({
  autonomousApi: { triggerTask: (...a: unknown[]) => mockTrigger(...a), deleteTask: jest.fn(), updateTask: jest.fn(), getTask: jest.fn() },
  AutonomousApiError: class extends Error {},
}));
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

import { TeamTaskPanel } from "@/components/autonomous/oversight/TeamTaskPanel";

const members = [
  { email: "a@x", tasks: [{ id: "t1", name: "t1", enabled: true, owner_id: "a@x", trigger: { type: "cron" } }] as never },
];

beforeEach(() => { jest.clearAllMocks(); taskListProps = null; });

it("renders a section per person with their task list", () => {
  render(<TeamTaskPanel title="Eng" members={members} onBack={() => {}} onChanged={() => {}} />);
  expect(screen.getByText("a@x")).toBeInTheDocument();
  expect(taskListProps!.tasks.map((t) => t.id)).toEqual(["t1"]);
});

it("triggers a task and refreshes", async () => {
  mockTrigger.mockResolvedValue({});
  const onChanged = jest.fn();
  render(<TeamTaskPanel title="Eng" members={members} onBack={() => {}} onChanged={onChanged} />);
  await taskListProps!.onTrigger({ id: "t1" });
  expect(mockTrigger).toHaveBeenCalledWith("t1");
});
