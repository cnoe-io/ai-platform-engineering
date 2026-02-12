/**
 * Unit tests for LoadingScreen component
 *
 * Tests:
 * - Renders app name, tagline, logo from config
 * - Renders default/custom message
 * - Shows spinner
 * - Cancel button visibility and onCancel
 * - Powered by footer
 * - Preview badge
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

let mockConfig: Record<string, unknown> = {
  appName: "Test App",
  tagline: "Test tagline",
  logoUrl: "/logo.svg",
  logoStyle: "default" as const,
  showPoweredBy: false,
  previewMode: false,
};

jest.mock("@/lib/config", () => ({
  get config() {
    return new Proxy(
      {},
      {
        get(_, prop: string) {
          return mockConfig[prop];
        },
      }
    );
  },
  getLogoFilterClass: jest.fn(() => ""),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { LoadingScreen } from "../loading-screen";

// ============================================================================
// Tests
// ============================================================================

describe("LoadingScreen", () => {
  beforeEach(() => {
    mockConfig = {
      appName: "Test App",
      tagline: "Test tagline",
      logoUrl: "/logo.svg",
      logoStyle: "default",
      showPoweredBy: false,
      previewMode: false,
    };
  });

  it("renders app name from config", () => {
    render(<LoadingScreen />);
    expect(screen.getByText("Test App")).toBeInTheDocument();
  });

  it("renders tagline from config", () => {
    render(<LoadingScreen />);
    expect(screen.getByText("Test tagline")).toBeInTheDocument();
  });

  it("renders logo image", () => {
    render(<LoadingScreen />);
    const img = screen.getByRole("img", { name: "Test App" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/logo.svg");
  });

  it("renders default loading message", () => {
    render(<LoadingScreen />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders custom message", () => {
    render(<LoadingScreen message="Please wait..." />);
    expect(screen.getByText("Please wait...")).toBeInTheDocument();
  });

  it("shows spinner", () => {
    const { container } = render(<LoadingScreen />);
    // Spinner is a div with border animation
    const spinner = container.querySelector(".rounded-full.border-2");
    expect(spinner).toBeInTheDocument();
  });

  it("hides cancel button by default", () => {
    render(<LoadingScreen />);
    expect(screen.queryByText("Clear Session & Retry")).not.toBeInTheDocument();
  });

  it("shows cancel button when showCancel=true", () => {
    render(<LoadingScreen showCancel onCancel={() => {}} />);
    expect(screen.getByText("Clear Session & Retry")).toBeInTheDocument();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = jest.fn();
    render(<LoadingScreen showCancel onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Clear Session & Retry"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows powered by footer when showPoweredBy=true", () => {
    mockConfig = { ...mockConfig, showPoweredBy: true };
    render(<LoadingScreen />);
    expect(screen.getByText(/Powered by OSS/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "caipe.io" })).toBeInTheDocument();
  });

  it("hides powered by footer when showPoweredBy=false", () => {
    mockConfig = { ...mockConfig, showPoweredBy: false };
    render(<LoadingScreen />);
    expect(screen.queryByText(/Powered by OSS/)).not.toBeInTheDocument();
  });

  it("shows preview badge when previewMode=true", () => {
    mockConfig = { ...mockConfig, previewMode: true };
    render(<LoadingScreen />);
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });
});
