/**
 * Unit tests for SimpleLineChart component
 *
 * Tests:
 * - Renders SVG chart
 * - Shows data points
 * - Handles empty data
 * - Renders with correct dimensions
 * - Shows labels if provided
 * - Title when provided
 * - Show grid option
 */

import React from "react";
import { render, screen } from "@testing-library/react";

// ============================================================================
// Imports — no mocks needed for SimpleLineChart
// ============================================================================

import { SimpleLineChart } from "../SimpleLineChart";

// ============================================================================
// Tests
// ============================================================================

describe("SimpleLineChart", () => {
  const sampleData = [
    { label: "Jan", value: 10 },
    { label: "Feb", value: 25 },
    { label: "Mar", value: 15 },
    { label: "Apr", value: 40 },
    { label: "May", value: 30 },
  ];

  it("renders SVG chart", () => {
    const { container } = render(<SimpleLineChart data={sampleData} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("shows data points", () => {
    const { container } = render(<SimpleLineChart data={sampleData} />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(sampleData.length);
  });

  it("handles empty data", () => {
    render(<SimpleLineChart data={[]} />);
    expect(screen.getByText("No data available")).toBeInTheDocument();
  });

  it("renders with correct dimensions", () => {
    const { container } = render(
      <SimpleLineChart data={sampleData} height={300} />
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("height", "300");
  });

  it("shows labels if provided", () => {
    const { container } = render(<SimpleLineChart data={sampleData} />);
    expect(container.textContent).toContain("Jan");
    expect(container.textContent).toContain("Feb");
    expect(container.textContent).toContain("May");
  });

  it("shows title when provided", () => {
    render(<SimpleLineChart data={sampleData} title="Monthly Stats" />);
    expect(screen.getByText("Monthly Stats")).toBeInTheDocument();
  });

  it("hides title when not provided", () => {
    render(<SimpleLineChart data={sampleData} />);
    expect(screen.queryByRole("heading", { level: 4 })).not.toBeInTheDocument();
  });

  it("renders with custom color", () => {
    const { container } = render(
      <SimpleLineChart data={sampleData} color="rgb(255, 0, 0)" />
    );
    const path = container.querySelector("path[stroke]");
    expect(path).toHaveAttribute("stroke", "rgb(255, 0, 0)");
  });
});
