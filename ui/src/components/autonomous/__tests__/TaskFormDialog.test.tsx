/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

import { TaskFormDialog } from "@/components/autonomous/TaskFormDialog";
import type { AutonomousTask } from "@/components/autonomous/types";

function existingTask(): AutonomousTask {
  return {
    id: "daily-report-a3f9",
    name: "Daily report",
    enabled: true,
    dynamic_agent_id: "agent-x",
    prompt: "summarise",
    trigger: { type: "cron", schedule: "0 9 * * *" },
  } as AutonomousTask;
}

const noop = async () => {};

it("renders no ID input in create mode", () => {
  render(
    <TaskFormDialog open onOpenChange={() => {}} initialAgentId="agent-x" onSubmit={noop} />,
  );
  expect(screen.queryByLabelText(/^ID$/i)).not.toBeInTheDocument();
});

it("shows the id as read-only text in edit mode", () => {
  render(
    <TaskFormDialog open onOpenChange={() => {}} task={existingTask()} onSubmit={noop} />,
  );
  expect(screen.getByTestId("task-id-readonly")).toHaveTextContent("daily-report-a3f9");
  expect(screen.queryByRole("textbox", { name: /^ID$/i })).not.toBeInTheDocument();
});

it("warns but does not block when the name duplicates another task", () => {
  render(
    <TaskFormDialog
      open
      onOpenChange={() => {}}
      initialAgentId="agent-x"
      existingNames={["Daily report"]}
      onSubmit={noop}
    />,
  );

  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "daily REPORT" } });

  expect(screen.getByTestId("duplicate-name-warning")).toBeInTheDocument();
  // Non-blocking: the submit control stays enabled.
  expect(screen.getByRole("button", { name: /create task/i })).toBeEnabled();
});

it("does not warn for a name that is unique", () => {
  render(
    <TaskFormDialog
      open
      onOpenChange={() => {}}
      initialAgentId="agent-x"
      existingNames={["Something else"]}
      onSubmit={noop}
    />,
  );

  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Daily report" } });

  expect(screen.queryByTestId("duplicate-name-warning")).not.toBeInTheDocument();
});
