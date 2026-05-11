/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

import { LiveStatusIndicator } from "@/components/agentic-sdlc/LiveStatusIndicator";

describe("LiveStatusIndicator", () => {
  it("renders a subtle pulsing connected indicator", () => {
    render(<LiveStatusIndicator status="open" label="Repo live" />);

    const status = screen.getByRole("status", { name: /repo live: connected/i });
    expect(status).toBeInTheDocument();
    expect(status.querySelector("[data-live-dot]")).toHaveClass("motion-safe:animate-pulse");
    expect(status.querySelector("[data-live-halo]")).toHaveClass("motion-safe:animate-ping");
  });

  it("renders reconnecting state without claiming connected", () => {
    render(<LiveStatusIndicator status="reconnecting" label="Portfolio live" />);

    const status = screen.getByRole("status", {
      name: /portfolio live: reconnecting/i,
    });
    expect(status).toBeInTheDocument();
    expect(
      status.querySelector("[data-live-spinner]"),
    ).toHaveClass("motion-safe:animate-spin");
    expect(
      screen.getByRole("status", { name: /portfolio live: reconnecting/i }),
    ).toBeInTheDocument();
  });
});
