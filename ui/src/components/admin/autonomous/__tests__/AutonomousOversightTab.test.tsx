/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/components/autonomous/oversight/OversightGrid", () => ({
  OversightGrid: () => <div data-testid="oversight-grid" />,
}));
jest.mock("@/components/autonomous/oversight/TeamTaskPanel", () => ({
  TeamTaskPanel: () => <div data-testid="team-panel" />,
}));
jest.mock("@/components/admin/autonomous/AutonomousTeamAccessPanel", () => ({
  AutonomousTeamAccessPanel: () => <div data-testid="team-access-panel" />,
}));

import { AutonomousOversightTab } from "@/components/admin/autonomous/AutonomousOversightTab";

const okOversight = {
  teams: [],
  no_team: { counts: { total: 0, paused: 0, ack_failed: 0 }, members: [] },
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ data: okOversight }) }) as never;
});

it("shows team access by default", async () => {
  render(<AutonomousOversightTab />);
  expect(screen.getByTestId("team-access-panel")).toBeInTheDocument();
});

it("fetches oversight data from the task oversight tab", async () => {
  render(<AutonomousOversightTab />);
  await userEvent.click(screen.getByRole("tab", { name: /task oversight/i }));
  await waitFor(() => expect(screen.getByTestId("oversight-grid")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith("/api/autonomous/oversight");
});

it("shows a retry affordance when the fetch fails", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502 }) as never;
  render(<AutonomousOversightTab />);
  await userEvent.click(screen.getByRole("tab", { name: /task oversight/i }));
  expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
});
