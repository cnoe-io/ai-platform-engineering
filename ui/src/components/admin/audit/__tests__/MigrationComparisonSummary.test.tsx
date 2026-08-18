import { render, screen } from "@testing-library/react";
import { MigrationComparisonSummary } from "../MigrationComparisonSummary";

describe("MigrationComparisonSummary", () => {
  it("renders promotion evidence and the operational-gate disclaimer", () => {
    render(
      <MigrationComparisonSummary
        loading={false}
        summary={{
          comparison_count: 120,
          semantic_mismatch_count: 0,
          provider_error_count: 0,
          provider_error_rate: 0,
          latency_sample_count: 120,
          p99_authz_latency_ms: 18,
          latest_rollout_revision: "revision-1",
          truncated: false,
          evidence_ready: true,
          mismatch_counts: { NONE: 120 },
          authoritative_counts: { LEGACY: 120 },
          gates: [
            { id: "sample", label: "Comparison sample", passed: true, detail: "120 comparisons" },
          ],
        }}
      />,
    );

    expect(screen.getByText("Traffic evidence ready")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/Model descriptor, audit backlog, owner/)).toBeInTheDocument();
  });
});
