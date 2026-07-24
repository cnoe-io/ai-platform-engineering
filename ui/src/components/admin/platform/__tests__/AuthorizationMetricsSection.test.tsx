import { render, screen, within } from "@testing-library/react";
import type {
  AuthorizationStatsResponse,
  UseAuthorizationMetricsReturn,
} from "@/hooks/use-authorization-metrics";
import { AuthorizationMetricsSection } from "../AuthorizationMetricsSection";

const DATA: AuthorizationStatsResponse = {
  decisions: {
    allow: 7,
    byReason: [
      { reason: "OK", count: 7 },
      { reason: "NO_CAPABILITY", count: 2 },
      { reason: "AUTHZ_UNAVAILABLE", count: 1 },
    ],
    deny: 3,
    denyRate: 0.3,
    policyDeny: 2,
    policyDenyRate: 0.2,
    topDenied: [{ resource: "resource:primary", count: 2 }],
    total: 10,
    truncated: false,
    unavailable: 1,
    unavailableRate: 0.1,
  },
  persistence: true,
  window: "86400s",
};

function state(overrides: Partial<UseAuthorizationMetricsReturn> = {}): UseAuthorizationMetricsReturn {
  return {
    data: DATA,
    error: null,
    lastUpdatedAt: 1,
    loading: false,
    refetch: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe("AuthorizationMetricsSection", () => {
  it("separates expected policy denials from operational unavailability", () => {
    render(<AuthorizationMetricsSection rangeLabel="24 hours" state={state()} />);

    expect(screen.getByText("Centralized Authorization Service")).toBeInTheDocument();
    expect(screen.getByText(/Policy denials are expected outcomes/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("authorization-policy-denied-card")).getByText("20.00%")).toBeInTheDocument();
    expect(within(screen.getByTestId("authorization-unavailable-card")).getByText("10.00%")).toBeInTheDocument();
    expect(screen.getByText("AUTHZ_UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("resource:primary")).toBeInTheDocument();
  });

  it("shows loading placeholders before the first response", () => {
    render(
      <AuthorizationMetricsSection
        rangeLabel="24 hours"
        state={state({ data: null, loading: true })}
      />,
    );

    expect(screen.getAllByLabelText("Loading card").length).toBeGreaterThan(0);
  });

  it("keeps existing values visible beneath the refresh overlay", () => {
    render(<AuthorizationMetricsSection rangeLabel="24 hours" state={state({ loading: true })} />);

    expect(within(screen.getByTestId("authorization-decisions-card")).getByText("10")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Loading card").length).toBeGreaterThan(0);
  });

  it("warns when detailed breakdowns reach the audit query limit", () => {
    render(
      <AuthorizationMetricsSection
        rangeLabel="90 days"
        state={state({
          data: {
            ...DATA,
            decisions: DATA.decisions ? { ...DATA.decisions, total: 10_000, truncated: true } : null,
          },
        })}
      />,
    );

    expect(screen.getByText(/breakdowns are limited to the first 10,000 events/i)).toBeInTheDocument();
  });
});
