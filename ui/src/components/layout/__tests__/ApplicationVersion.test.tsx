/** @jest-environment jsdom */

import { render,screen } from "@testing-library/react";

const mockUseVersion = jest.fn();
jest.mock("@/hooks/use-version",() => ({ useVersion: () => mockUseVersion() }));
const mockUseAdminRole = jest.fn();
jest.mock("@/hooks/use-admin-role",() => ({ useAdminRole: () => mockUseAdminRole() }));
const mockUsePlatformHealthProbes = jest.fn();
jest.mock("@/hooks/use-platform-health-probes",() => ({
  usePlatformHealthProbes: () => mockUsePlatformHealthProbes(),
}));

import { ApplicationVersion } from "@/components/layout/ApplicationVersion";

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAdminRole.mockReturnValue({ isAdmin: true,loading: false });
  mockUsePlatformHealthProbes.mockReturnValue({ status: "healthy" });
});

it("shows the deployed version with live health in the expanded sidebar",() => {
  mockUseVersion.mockReturnValue({
    isLoading: false,
    versionInfo: { version: "0.5.67",gitCommit: "abc123",buildDate: "2026-08-20" },
  });

  render(<ApplicationVersion />);

  expect(screen.getByText("v0.5.67")).toBeInTheDocument();
  const link = screen.getByLabelText("CAIPE v0.5.67, platform health healthy. Open Admin Health.");
  expect(link).toHaveAttribute("href","/admin/operations/health");
});

it("keeps the collapsed footer accessible without showing version text",() => {
  mockUseVersion.mockReturnValue({
    isLoading: false,
    versionInfo: { version: "0.5.67" },
  });

  render(<ApplicationVersion collapsed />);

  expect(screen.getByLabelText("CAIPE v0.5.67, platform health healthy. Open Admin Health.")).toHaveAttribute("href","/admin/operations/health");
  expect(screen.queryByText("v0.5.67")).not.toBeInTheDocument();
});

it("shows a red status indicator when aggregate platform health is down",() => {
  mockUseVersion.mockReturnValue({
    isLoading: false,
    versionInfo: { version: "0.5.67" },
  });
  mockUsePlatformHealthProbes.mockReturnValue({ status: "down" });

  render(<ApplicationVersion />);

  const link = screen.getByLabelText("CAIPE v0.5.67, platform health down. Open Admin Health.");
  expect(link.querySelector("span[aria-hidden='true']")).toHaveClass("bg-red-500");
});

it("uses the commit SHA instead of prefixing a non-semantic version",() => {
  mockUseVersion.mockReturnValue({
    isLoading: false,
    versionInfo: { version: "preview",packageVersion: "0.2.0",gitCommit: "6c5c6617a" },
  });

  render(<ApplicationVersion />);

  expect(screen.getByText("6c5c661")).toBeInTheDocument();
  expect(screen.queryByText("vpreview")).not.toBeInTheDocument();
  expect(
    screen.getByLabelText("CAIPE 6c5c661, platform health healthy. Open Admin Health."),
  ).toHaveAttribute("href","/admin/operations/health");
});

it("hides health and build information from non-admin users",() => {
  mockUseAdminRole.mockReturnValue({ isAdmin: false,loading: false });

  render(<ApplicationVersion />);

  expect(screen.queryByTestId("application-version")).not.toBeInTheDocument();
  expect(mockUseVersion).not.toHaveBeenCalled();
  expect(mockUsePlatformHealthProbes).not.toHaveBeenCalled();
});
