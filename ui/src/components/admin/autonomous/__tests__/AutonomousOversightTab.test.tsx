/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/autonomous/oversight/OversightGrid", () => ({
  OversightGrid: () => <div data-testid="oversight-grid" />,
}));
jest.mock("@/components/autonomous/oversight/TeamTaskPanel", () => ({
  TeamTaskPanel: () => <div data-testid="team-panel" />,
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

it("fetches oversight data and renders the grid", async () => {
  render(<AutonomousOversightTab />);
  await waitFor(() => expect(screen.getByTestId("oversight-grid")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith("/api/autonomous/oversight");
});

it("shows a retry affordance when the fetch fails", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502 }) as never;
  render(<AutonomousOversightTab />);
  expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
});
