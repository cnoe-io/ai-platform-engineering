/**
 * @jest-environment jsdom
 *
 * Tests for the autonomous page under the admin-only oversight model
 * (spec 2026-07-06). Non-admins are redirected to /dynamic-agents; admins
 * see the team-box oversight grid fetched from /api/autonomous/oversight.
 */
import { render, screen, waitFor } from "@testing-library/react";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));
jest.mock("@/components/auth-guard", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuthGuard: ({ children }: any) => <div>{children}</div>,
}));
jest.mock("@/lib/config", () => ({
  getConfig: (k: string) => (k === "autonomousAgentsEnabled" ? true : undefined),
}));
const mockUseAdminRole = jest.fn();
jest.mock("@/hooks/use-admin-role", () => ({ useAdminRole: () => mockUseAdminRole() }));
jest.mock("@/components/autonomous/oversight/OversightGrid", () => ({
  OversightGrid: () => <div data-testid="oversight-grid" />,
}));
jest.mock("@/components/autonomous/oversight/TeamTaskPanel", () => ({
  TeamTaskPanel: () => <div data-testid="team-panel" />,
}));

import Page from "../page";

const okOversight = { teams: [], no_team: { counts: { total: 0, paused: 0, ack_failed: 0 }, members: [] } };

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ data: okOversight }) }) as never;
});

it("redirects a non-admin to /dynamic-agents", async () => {
  mockUseAdminRole.mockReturnValue({ isAdmin: false, loading: false });
  render(<Page />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dynamic-agents"));
});

it("renders the oversight grid for an admin", async () => {
  mockUseAdminRole.mockReturnValue({ isAdmin: true, loading: false });
  render(<Page />);
  await waitFor(() => expect(screen.getByTestId("oversight-grid")).toBeInTheDocument());
  expect(mockReplace).not.toHaveBeenCalled();
});

it("does not redirect or fetch while the role is still loading", async () => {
  mockUseAdminRole.mockReturnValue({ isAdmin: false, loading: true });
  render(<Page />);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
