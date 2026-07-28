/**
 * @jest-environment jsdom
 *
 * Tests for the user-facing autonomous page (spec 2026-07-28). Every user
 * sees their own tasks grouped by schedulable agent; the Automation tab is
 * team-admin only; admin oversight moved to Admin > Teams & Users.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/components/auth-guard", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuthGuard: ({ children }: any) => <div>{children}</div>,
}));
// Mutable so the feature-flag-off case can flip it. Using jest.resetModules()
// plus a dynamic import instead would load a SECOND React copy into the test,
// leaving the hook dispatcher null and crashing on the first useState.
let mockAutonomousEnabled = true;
jest.mock("@/lib/config", () => ({
  getConfig: (k: string) => (k === "autonomousAgentsEnabled" ? mockAutonomousEnabled : undefined),
}));
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test-user@example.com" } }, status: "authenticated" }),
}));
jest.mock("@/components/autonomous/MyTasksPanel", () => ({
  MyTasksPanel: ({ agents }: { agents: Array<{ id: string }> }) => (
    <div data-testid="my-tasks">{agents.map((a) => a.id).join(",")}</div>
  ),
}));
jest.mock("@/components/autonomous/AgentAutomationPanel", () => ({
  AgentAutomationPanel: () => <div data-testid="automation-panel" />,
}));

import Page from "../page";

const agentsResponse = {
  success: true,
  data: {
    schedulable: [{ id: "deploy-agent", name: "Deploy Agent", owner_team_slug: "primary" }],
    automatable: [],
    automatable_total: 0,
    eligible: true,
    can_manage_automation: false,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAutonomousEnabled = true;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => agentsResponse }) as never;
});

it("renders my tasks for a non-admin without redirecting", async () => {
  render(<Page />);
  expect(await screen.findByTestId("my-tasks")).toHaveTextContent("deploy-agent");
});

it("still renders for an eligible team member with no enabled agents", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      ...agentsResponse,
      data: { ...agentsResponse.data, schedulable: [], eligible: true },
    }),
  });

  render(<Page />);
  expect(await screen.findByTestId("my-tasks")).toHaveTextContent("");
});

it("hides the Configure tab for a user who administers no team", async () => {
  render(<Page />);
  await screen.findByTestId("my-tasks");
  expect(screen.queryByRole("tab", { name: /configure/i })).not.toBeInTheDocument();
});

it("shows the Configure tab and panel for a team admin", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      ...agentsResponse,
      data: { ...agentsResponse.data, can_manage_automation: true },
    }),
  });

  render(<Page />);
  const tab = await screen.findByRole("tab", { name: /configure/i });
  // Radix tab triggers switch on pointer events, which userEvent emits and a
  // bare fireEvent.click does not.
  await userEvent.click(tab);
  await waitFor(() => expect(screen.getByTestId("automation-panel")).toBeInTheDocument());
});

it("renders the disabled notice when the feature flag is off", async () => {
  mockAutonomousEnabled = false;
  render(<Page />);
  expect(await screen.findByText(/autonomous agents are disabled/i)).toBeInTheDocument();
});
