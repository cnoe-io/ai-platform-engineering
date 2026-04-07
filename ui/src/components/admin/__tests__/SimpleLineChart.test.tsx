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
import { render, screen, fireEvent } from "@testing-library/react";

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

  it("shows hover tooltip with label and value on mouse move", () => {
    const { container } = render(<SimpleLineChart data={sampleData} />);
    const svg = container.querySelector("svg")!;

    // getBoundingClientRect is not implemented in jsdom, mock it
    svg.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 200,
      width: 800, height: 200, x: 0, y: 0, toJSON: () => {},
    });

    // Move mouse to roughly the middle of the chart (should resolve to a data point)
    fireEvent.mouseMove(svg, { clientX: 400, clientY: 100 });

    // A tooltip text element should now be visible with one of the data labels
    const texts = container.querySelectorAll("tspan");
    const hasDataLabel = Array.from(texts).some(
      (t) => sampleData.some((d) => t.textContent?.includes(d.label))
    );
    expect(hasDataLabel).toBe(true);
  });

  it("renders drag selection with % change badge after drag across two points", () => {
    // Data: 10 → 20 = +100%
    const dragData = [
      { label: "A", value: 10 },
      { label: "B", value: 15 },
      { label: "C", value: 20 },
    ];
    const { container } = render(<SimpleLineChart data={dragData} />);
    const svg = container.querySelector("svg")!;

    svg.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 200,
      width: 800, height: 200, x: 0, y: 0, toJSON: () => {},
    });

    // Drag from left edge (point A, index 0) to right edge (point C, index 2)
    fireEvent.mouseDown(svg, { clientX: 50 });   // near left padding → index 0
    fireEvent.mouseMove(svg, { clientX: 750 });   // near right edge → index 2
    fireEvent.mouseUp(svg);

    // The % change badge should show +100.0%
    const allText = container.textContent || "";
    expect(allText).toContain("+100.0%");
    // And the range label "A → C"
    expect(allText).toContain("A");
    expect(allText).toContain("C");
  });
});
