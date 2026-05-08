/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { render, screen } from "@testing-library/react";

import { FinOpsIntegratedApp } from "@/components/agentic-apps/FinOpsIntegratedApp";

describe("FinOpsIntegratedApp", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        monthToDateSpend: "$128.4K",
        forecast: "$173.8K",
        savingsOpportunity: "$31.2K",
        anomalyCount: 3,
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders FinOps inside a CAIPE-owned integrated app surface", () => {
    render(<FinOpsIntegratedApp />);

    expect(screen.getByRole("heading", { name: "FinOps Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/CAIPE shell remains in control/i)).toBeInTheDocument();
    expect(screen.getByText(/Cloud spend command center/i)).toBeInTheDocument();
    expect(screen.getByText("CopilotKit action panel")).toBeInTheDocument();
    expect(screen.getByText("App assistant")).toBeInTheDocument();
    expect(screen.getByText("Savings radar")).toBeInTheDocument();
  });
});
