/** @jest-environment jsdom */

import { render,screen } from "@testing-library/react";

const mockUseVersion = jest.fn();
jest.mock("@/hooks/use-version",() => ({ useVersion: () => mockUseVersion() }));

import { ApplicationVersion } from "@/components/layout/ApplicationVersion";

it("shows the deployed version with a healthy status in the expanded sidebar",() => {
  mockUseVersion.mockReturnValue({
    isLoading: false,
    versionInfo: { version: "0.5.67",gitCommit: "abc123",buildDate: "2026-08-20" },
  });

  render(<ApplicationVersion />);

  expect(screen.getByText("v0.5.67")).toBeInTheDocument();
  expect(screen.getByLabelText("CAIPE v0.5.67")).toBeInTheDocument();
});

it("keeps the collapsed footer accessible without showing version text",() => {
  mockUseVersion.mockReturnValue({
    isLoading: false,
    versionInfo: { version: "0.5.67" },
  });

  render(<ApplicationVersion collapsed />);

  expect(screen.getByLabelText("CAIPE v0.5.67")).toBeInTheDocument();
  expect(screen.queryByText("v0.5.67")).not.toBeInTheDocument();
});
